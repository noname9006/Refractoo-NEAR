// Dashboard view-model. Turns raw public data + enrichment + prices into the
// shape the Quiet dashboard renders: USD total, 24h delta, per-holding values,
// DeFi positions, approvals and the public/DeFi/shielded split.
//
// Every USD figure here is balance × price where price came from the feed — no
// fabricated numbers. Holdings without a price show amount only (usd = null).

import { CHAIN_SLUG, NATIVE_LLAMA_KEY, llamaKey, nativeFor } from '../data/tokens.js';
import { stakingPositionsFromHoldings } from '../data/defi.js';
import { guardString } from '../prompts/untrusted.js';

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

// clusterData: { address: publicData } (raw, has chains[].nativeBalance + txs)
// enriched:    { address: [{ chainId, balances[], aave, approvals[] }] }
// prices:      Map(priceKey → { price, change24h })
// shielded:    ShieldedToken[] from data/shielded.js — confidential-token holdings
//              across Zama / CoFHE / Inco. Each is 'encrypted' (amount unknown)
//              or 'revealed' (amount decrypted in memory this session only).
// near: [{ accountId, holdings }] from near/nearAccount.js — rows already carry
// their own price object (priced by that module), chainId 'near'.
export function buildPortfolio({ clusterData = {}, enriched = {}, prices = new Map(), shielded = [], near = [] } = {}) {
  const addresses = Object.keys(clusterData);
  const holdingsMap = new Map(); // key: chainId:symbol(:address) → aggregated holding
  const defiPositions = [];
  const approvals = [];

  const priceFor = (key) => prices.get(key) || null;

  for (const address of addresses) {
    const pub = clusterData[address];
    const enr = enriched[address] || [];
    const enrByChain = new Map(enr.map((e) => [e.chainId, e]));

    for (const chain of pub?.chains || []) {
      if (chain.error) continue;

      // native balance (per-chain: ETH on most chains, POL on Polygon)
      const nativeAmt = num(Number(chain.nativeBalance));
      if (nativeAmt > 0) {
        const nat = nativeFor(chain.chainId);
        addHolding(holdingsMap, {
          chainId: chain.chainId,
          chainName: chain.chainName,
          address: null,
          symbol: chain.nativeSymbol || nat.symbol,
          name: nat.name,
          amount: nativeAmt,
          glyph: nat.glyph,
          color: nat.color,
          kind: 'eth',
          price: priceFor(nat.key),
        });
      }

      // ERC-20 balances from enrichment
      const e = enrByChain.get(chain.chainId);
      for (const b of e?.balances || []) {
        addHolding(holdingsMap, {
          chainId: b.chainId,
          chainName: chain.chainName,
          address: b.address,
          symbol: b.symbol,
          name: b.name,
          amount: b.amount,
          glyph: b.glyph,
          color: b.color,
          kind: b.kind,
          protocol: b.protocol,
          label: b.label,
          price: priceFor(llamaKey(b.chainId, b.address)),
        });
      }

      // Aave position (already USD-denominated)
      if (e?.aave) defiPositions.push({ ...e.aave, chainName: chain.chainName });

      // approvals
      for (const a of e?.approvals || []) approvals.push(a);
    }
  }

  // NEAR accounts (read-only by name): native, FTs, staking, Intents rows.
  for (const acct of near) {
    for (const h of acct?.holdings || []) addHolding(holdingsMap, h);
    // Protocol positions (Rhea Lend): value held in the protocol, not the
    // wallet, so it adds to the total like Aave does.
    for (const p of acct?.positions || []) defiPositions.push(p);
  }

  // finalize holdings: compute usd + change
  const holdings =[...holdingsMap.values()].map(finalizeHolding).sort((a, b) => num(b.usd) - num(a.usd));

  // staking positions are derived from the priced holdings
  // Dust (priced below a cent, e.g. 1e-24 stNEAR left after a swap) stays in
  // holdings but doesn't get a position row; unpriced rows are kept.
  const staking = stakingPositionsFromHoldings(holdings.filter((h) => h.protocol && h.label === 'Staking' && !(h.usd != null && h.usd < 0.01)));
  const positions = [...defiPositions, ...staking].sort((a, b) => num(b.usd) - num(a.usd));

  // sums
  const holdingsUsd = holdings.reduce((s, h) => s + num(h.usd), 0);
  const aaveUsd = defiPositions.reduce((s, p) => s + num(p.usd), 0);
  const stakingUsd = staking.reduce((s, p) => s + num(p.usd), 0);
  const defiUsd = aaveUsd + stakingUsd; // informational view (staking overlaps holdings)

  // Confidential holdings. A wrapper has no price of its own — its value comes
  // from the ERC-20 it wraps — so revealed entries are priced through
  // `underlying`. Encrypted entries get NO value at all: the amount is genuinely
  // unknown until decrypted, and estimating it would be fabrication.
  const shieldedPriced = shielded.map((t) => finalizeShielded(t, priceFor));
  const shieldedUsd = shieldedPriced.reduce((s, t) => s + num(t.usd), 0);
  const shieldedEncrypted = shieldedPriced.filter((t) => t.state === 'encrypted').length;

  // Revealed shielded value counts toward the total; encrypted value cannot.
  const total = holdingsUsd + aaveUsd + shieldedUsd;

  // 24h delta. Public holdings and revealed shielded holdings both have a real
  // change from the price feed; Aave (already USD-denominated, no feed) is
  // treated as flat by carrying it into `prev` unchanged.
  let prev = aaveUsd;
  for (const h of holdings) {
    const chg = h.change24h;
    prev += chg != null && isFinite(chg) ? num(h.usd) / (1 + chg / 100) : num(h.usd);
  }
  for (const t of shieldedPriced) {
    const chg = t.change24h;
    prev += chg != null && isFinite(chg) ? num(t.usd) / (1 + chg / 100) : num(t.usd);
  }
  const deltaUsd = total - prev;
  const deltaPct = prev > 0 ? (deltaUsd / prev) * 100 : 0;

  return {
    walletCount: addresses.length + near.length,
    chains: [...new Set(holdings.map((h) => h.chainId))],
    priced: prices.size > 0,
    holdings,
    positions,
    approvals,
    shielded: shieldedPriced,
    total,
    publicUsd: holdingsUsd,
    defiUsd,
    shieldedUsd,
    shieldedEncrypted,
    change24h: { usd: deltaUsd, pct: deltaPct },
  };
}

// Value a confidential holding from its underlying ERC-20's price. Only revealed
// entries get a number; encrypted ones keep usd === null so nothing downstream
// can mistake "hidden" for "zero".
function finalizeShielded(t, priceFor) {
  if (t.state !== 'revealed' || t.amount == null) {
    return { ...t, usd: null, price: null, change24h: null };
  }
  // NEAR Confidential Intents rows arrive with a USD price from the Intents
  // API's own token list (src/near/confidentialIntents.js); no 24h change.
  if (t.priceUsd != null) {
    return { ...t, price: t.priceUsd, usd: t.amount * t.priceUsd, change24h: null };
  }
  const p = t.underlying ? priceFor(llamaKey(t.chainId, t.underlying)) : null;
  const price = p?.price ?? null;
  return {
    ...t,
    price,
    usd: price != null ? t.amount * price : null,
    change24h: p?.change24h ?? null,
  };
}

function addHolding(map, h) {
  const key = `${h.chainId}:${h.symbol}:${h.address || 'native'}`;
  const cur = map.get(key);
  if (cur) {
    cur.amount += num(h.amount);
  } else {
    map.set(key, { ...h, amount: num(h.amount) });
  }
}

function finalizeHolding(h) {
  const p = h.price;
  const price = p?.price ?? null;
  const usd = price != null ? h.amount * price : null;
  // Prefer the CoinGecko symbol returned by DefiLlama over the local metadata;
  // falls back to local for tokens the price API doesn't cover.
  const symbol = p?.symbol || h.symbol;
  return {
    chainId: h.chainId,
    chainName: h.chainName,
    address: h.address,
    symbol,
    name: h.name,
    amount: h.amount,
    price,
    usd,
    change24h: p?.change24h ?? null,
    glyph: h.glyph || symbol?.[0] || '•',
    color: h.color,
    kind: h.kind,
    protocol: h.protocol || null,
    label: h.label || null,
  };
}

// Narrows a built portfolio to a set of chain ids (null/empty ⇒ all), recomputing
// the totals and 24h delta from the filtered holdings, positions and shielded
// entries. Confidential holdings DO carry a chain (the wrapper's), so unlike the
// old single-value sealed balance they honour the chain filter like everything
// else.
export function filterPortfolioView(p, chainIds) {
  if (!p) return p;
  // null ⇒ no filter (show everything). An empty set ⇒ nothing selected, which
  // must filter down to empty (not fall through to "show all").
  if (!chainIds) return p;

  const holdings = p.holdings.filter((h) => chainIds.has(h.chainId));
  const positions = p.positions.filter((d) => chainIds.has(d.chainId));
  const approvals = p.approvals.filter((a) => chainIds.has(a.chainId));
  const shielded = (p.shielded || []).filter((t) => chainIds.has(t.chainId));

  const holdingsUsd = holdings.reduce((s, h) => s + num(h.usd), 0);
  const aaveUsd = positions.filter((d) => d.kind === 'Lending').reduce((s, d) => s + num(d.usd), 0);
  const defiUsd = positions.reduce((s, d) => s + num(d.usd), 0);
  const shieldedUsd = shielded.reduce((s, t) => s + num(t.usd), 0);
  const total = holdingsUsd + aaveUsd + shieldedUsd;

  let prev = aaveUsd;
  for (const h of holdings) {
    const chg = h.change24h;
    prev += chg != null && isFinite(chg) ? num(h.usd) / (1 + chg / 100) : num(h.usd);
  }
  for (const t of shielded) {
    const chg = t.change24h;
    prev += chg != null && isFinite(chg) ? num(t.usd) / (1 + chg / 100) : num(t.usd);
  }
  const deltaUsd = total - prev;
  return {
    ...p,
    holdings,
    positions,
    approvals,
    shielded,
    total,
    publicUsd: holdingsUsd,
    defiUsd,
    shieldedUsd,
    shieldedEncrypted: shielded.filter((t) => t.state === 'encrypted').length,
    chains: [...new Set(holdings.map((h) => h.chainId))],
    change24h: { usd: deltaUsd, pct: prev > 0 ? (deltaUsd / prev) * 100 : 0 },
  };
}

// All distinct {chainId,address} holding keys (for the price feed). Includes
// native ETH once. Used by the flow to know what to price.
//
// `shielded` contributes its entries' UNDERLYING ERC-20s: a confidential wrapper
// has no price of its own, and the underlying is what values it once revealed.
// Encrypted entries are included too — pricing the underlying leaks nothing (it
// is a public token price) and means a reveal renders with a value immediately
// instead of waiting for the next price cycle.
export function holdingPriceTargets(clusterData = {}, enriched = {}, shielded = []) {
  const targets = new Map();
  targets.set(NATIVE_LLAMA_KEY, { address: null });
  // Native price key for every chain present (Polygon's POL differs from ETH).
  for (const pub of Object.values(clusterData || {})) {
    for (const chain of pub?.chains || []) {
      if (chain.error) continue;
      targets.set(nativeFor(chain.chainId).key, { chainId: chain.chainId, address: null });
    }
  }
  for (const address of Object.keys(enriched)) {
    for (const e of enriched[address] || []) {
      for (const b of e.balances || []) {
        // llamaKey is null for a token the active profile can't price (a testnet
        // token with no declared mainnet twin). Skip it rather than sending
        // "null" to the price API — the holding just shows its amount.
        const key = llamaKey(b.chainId, b.address);
        if (key) targets.set(key, { chainId: b.chainId, address: b.address });
      }
    }
  }
  for (const t of shielded) {
    if (!t.underlying) continue;
    const key = llamaKey(t.chainId, t.underlying);
    if (key) targets.set(key, { chainId: t.chainId, address: t.underlying });
  }
  return [...targets.keys()].filter(Boolean);
}

// Compact, USD-aware summary handed to the on-device LLM so it can cite dollar
// figures it would otherwise not have (facts.js stays price-free on its own).
// Preserves precision to avoid rounding errors; LLM is instructed to round display values.
export function portfolioFacts(p) {
  if (!p) return null;
  const money = (v) => {
    if (v == null) return null;
    // For small values, keep 2 decimals; for large values, round to nearest 10
    if (Math.abs(v) < 1000) return Number(v.toFixed(2));
    if (Math.abs(v) < 1000000) return Math.round(v / 10) * 10;
    return Math.round(v / 100) * 100;
  };
  // Confidential holdings, stated so the model CANNOT invent a hidden amount.
  // Encrypted entries deliberately carry no number at all — not 0, not an
  // estimate — and say so in words, because a null in a JSON blob is exactly the
  // kind of gap an LLM fills in helpfully and wrongly.
  const shielded = p.shielded || [];
  const revealed = shielded.filter((t) => t.state === 'revealed');
  const stillEncrypted = shielded.filter((t) => t.state === 'encrypted');

  return {
    totalUsd: money(p.total),
    change24hUsd: money(p.change24h.usd),
    change24hPct: Number(p.change24h.pct.toFixed(2)),
    publicUsd: money(p.publicUsd),
    defiUsd: money(p.defiUsd),
    confidentialHoldings: {
      note:
        'Confidential (shielded) token balances are encrypted on-chain. Only the ' +
        'entries listed as revealed have a known amount — they were decrypted in ' +
        'this browser at the user\'s request. For encrypted entries the amount is ' +
        'UNKNOWN and MUST NOT be guessed, estimated, or treated as zero. ' +
        'totalUsd includes revealed amounts only. Entries with stack "near-intents" ' +
        'are balances on NEAR\'s private shard (Confidential Intents), read with the ' +
        'user\'s signature; they are invisible to block explorers.',
      revealedUsd: revealed.length ? money(p.shieldedUsd) : null,
      encryptedCount: stillEncrypted.length,
      revealed: revealed.map((t) => ({
        asset: t.symbol,
        stack: t.stack,
        chain: CHAIN_SLUG[t.chainId] || t.chainName,
        amount: t.amount != null ? Number(t.amount.toPrecision(6)) : null,
        usd: money(t.usd),
        ...(t.demo ? { sampleData: 'DEMO SAMPLE — illustrative, not a real balance; say so if you cite it' } : {}),
      })),
      encrypted: stillEncrypted.map((t) => ({
        asset: t.symbol,
        stack: t.stack,
        chain: CHAIN_SLUG[t.chainId] || t.chainName,
        amount: 'ENCRYPTED — amount unknown',
        usd: 'ENCRYPTED — value unknown',
      })),
    },
    holdings: p.holdings.slice(0, 16).map((h) => ({
      // Symbols are set by token deployers — untrusted text in an LLM prompt
      // (spam like "visit-xyz.com" or injected instructions). Keep it to a
      // short ticker-shaped string.
      asset: guardString(h.symbol, 'symbol').value, // detect on raw text, then shorten
      chain: CHAIN_SLUG[h.chainId] || h.chainName,
      amount: Number(h.amount.toPrecision(6)),
      price: h.price != null ? Number(h.price.toPrecision(8)) : null,
      usd: money(h.usd),
      change24hPct: h.change24h != null ? Number(h.change24h.toFixed(2)) : null,
      // Staked rows (e.g. NEAR in a staking pool) must not read as liquid balance.
      ...(h.label === 'Staking' ? { staked: true, stakedIn: h.protocol } : {}),
      ...(h.label === 'Intents' ? { heldIn: 'NEAR Intents (public balance)' } : {}),
    })),
    defiPositions: p.positions.map((d) => ({
      protocol: d.protocol,
      chain: d.chainName,
      kind: d.kind,
      usd: money(d.usd),
      healthFactor: d.healthFactor ?? null,
    })),
    riskyApprovals: p.approvals
      .filter((a) => a.unlimited)
      .map((a) => ({ token: a.tokenSymbol, chain: a.chainName, spender: a.spender, cap: 'unlimited' })),
  };
}
