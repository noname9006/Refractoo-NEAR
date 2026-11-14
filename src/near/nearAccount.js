import { guardString } from '../prompts/untrusted.js';
import { rpcView, rpcAccount, pool, fromBaseUnits } from './rpc.js';
import { lstProtocol, fetchLstUnstakes } from './defi/lst.js';
import { fetchIntentsBalances } from './defi/intents.js';
import { fetchRheaLend, rheaLendTokens, rheaLendPosition } from './defi/rheaLend.js';
// Public NEAR account, read-only by account name — no wallet, no signature.
//
//   balances + FT list + staking pools   FastNEAR  api.fastnear.com/v1/account/{id}/full
//   staked amount per pool               NEAR RPC  get_account_total_balance (view call)
//   FT decimals/symbol (unpriced only)   NEAR RPC  ft_metadata (view call)
//   USD prices + 24h change              DefiLlama coingecko:near, near:<contract>
//   DeFi positions (src/near/defi/)      NEAR RPC  view calls on the protocol contracts:
//     liquid staking unstakes            meta-pool.near, linear-protocol.near, lst.rhealab.near
//     public NEAR Intents balances       intents.near (NEP-245)
//     Rhea Lend supplied/borrowed/HF     contract.main.burrow.near
//
// All are public, CORS-enabled endpoints called from the browser. They
// see the account name you look up — the same exposure as the EVM explorers,
// stated in the "who sees what" panel. RPC reads fall back to the official NEAR
// RPC when FastNEAR throttles (src/near/rpc.js). Nothing here is cached to disk.
//
// Output rows use chainId 'near' and the same shape buildPortfolio() expects,
// so NEAR holdings, staking and totals flow through the existing dashboard.

// prices.js pulls in the Vite network config; load it lazily so this module
// stays importable in Node tests (which inject their own price function).
const fetchPrices = async (keys) => (await import('../data/prices.js')).fetchPrices(keys);

export const NEAR_CHAIN_ID = 'near';
export const NEAR_CHAIN_NAME = 'NEAR';
export const NEAR_PRICE_KEY = 'coingecko:near';
const FASTNEAR = 'https://api.fastnear.com/v1/account';
const YOCTO = 24;
const MAX_TOKENS = 40; // FT lists can be long with airdrop spam
const MAX_POOLS = 10;
const MAX_METADATA = 25;

// Named accounts (alice.near, app.alice.near, x.tg) or 64-hex implicit accounts.
// Bare top-level names ("near") and 0x-style eth-implicit accounts are excluded
// so an EVM address is never mistaken for a NEAR account.
const NAMED = /^(?=.{2,64}$)(?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)+$/;
const IMPLICIT = /^[a-f\d]{64}$/;
export function isNearAccountId(s) {
  const v = String(s || '').trim().toLowerCase();
  return NAMED.test(v) || IMPLICIT.test(v);
}
export const normalizeAccountId = (s) => String(s || '').trim().toLowerCase();

export { fromBaseUnits };

// → { accountId, exists, nativeYocto, tokens: [{contract, raw}], pools: [{pool, yocto}],
//     unstakes: [{contract, protocol, yocto, withdrawable}], intents: {tokens, otherCount}, rheaLend }
// Each DeFi read is independent: one failing protocol leaves its field empty
// (and its name in `defiErrors`), never the whole account.
export async function fetchNearAccountRaw(accountId, { fetchImpl = (...a) => fetch(...a) } = {}) {
  const id = normalizeAccountId(accountId);
  if (!isNearAccountId(id)) throw new Error(`"${accountId}" is not a NEAR account id`);
  // The index (FT list + staking pools) has no second source. If it stays
  // throttled after its retries, the account is still read over RPC: NEAR balance
  // and DeFi positions, marked `partial` so a caller holding a full earlier read
  // can keep that instead.
  let full = null;
  let indexError = null;
  try {
    full = await fetchIndex(fetchImpl, id);
  } catch (e) {
    indexError = e;
    console.warn(`[near] index read failed for ${id}:`, e?.message || e);
  }
  // FastNEAR's index sometimes has no `state` for an account that exists on
  // chain (seen on contract sub-accounts); confirm with RPC before saying "not found".
  let state = full?.state || null;
  if (!state) {
    let acc;
    try {
      acc = await rpcAccount(fetchImpl, id);
    } catch (e) {
      if (indexError) throw indexError; // nothing could be read at all
      acc = null;
    }
    if (!acc) return { accountId: id, exists: false, nativeYocto: '0', tokens: [], pools: [] };
    state = { balance: acc.amount, locked: acc.locked };
  }

  // Spendable = balance; `locked` is validator stake of this account itself.
  const tokens = (full?.tokens || [])
    .filter((t) => t?.contract_id && /^\d+$/.test(String(t.balance || '')) && BigInt(t.balance) > 0n)
    .slice(0, MAX_TOKENS)
    .map((t) => ({ contract: t.contract_id, raw: String(t.balance) }));

  const defiErrors = indexError ? ['Tokens and staking pools (FastNEAR index)'] : [];
  const guard =(name, p) => p.catch((e) => { defiErrors.push(name); console.warn(`[near] ${name} read failed:`, e?.message || e); return null; });
  const poolIds = (full?.pools || []).map((p) => p?.pool_id).filter(Boolean).slice(0, MAX_POOLS);
  const [staked, unstakes, intents, rheaLend] = await Promise.all([
    pool(poolIds, 4, (p) => rpcView(fetchImpl, p, 'get_account_total_balance', { account_id: id })),
    guard('Liquid staking', fetchLstUnstakes(id, { fetchImpl })),
    guard('NEAR Intents', fetchIntentsBalances(id, { fetchImpl })),
    guard('Rhea Lend', fetchRheaLend(id, { fetchImpl })),
  ]);
  const pools = poolIds
    .map((p, i) => ({ pool: p, yocto: typeof staked[i] === 'string' ? staked[i] : null }))
    .filter((p) => p.yocto && BigInt(p.yocto) > 0n);

  return {
    accountId: id,
    exists: true,
    nativeYocto: String(state.balance || '0'),
    lockedYocto: String(state.locked || '0'),
    tokens,
    pools,
    unstakes: unstakes || [],
    intents: intents || { tokens: [], otherCount: 0 },
    rheaLend: rheaLend || null,
    defiErrors,
    ...(indexError ? { partial: true } : {}),
  };
}

// FastNEAR account index, retried on 429/5xx before giving up.
const INDEX_RETRY_MS = [1000, 2500];
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function fetchIndex(fetchImpl, id) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetchImpl(`${FASTNEAR}/${encodeURIComponent(id)}/full`);
    if (r.ok) return r.json();
    const retryable = r.status === 429 || r.status >= 500;
    if (!retryable || attempt >= INDEX_RETRY_MS.length) throw new Error(`FastNEAR ${r.status}`);
    await sleep(INDEX_RETRY_MS[attempt]);
  }
}

// ft_metadata never changes for a contract, and the same token turns up in many
// accounts and on every refresh, so each contract is read once per session.
// Failed reads are not remembered and get retried next time.
const ftMetaCache = new Map();
function ftMetadata(fetchImpl, contract) {
  if (!ftMetaCache.has(contract)) {
    const p = rpcView(fetchImpl, contract, 'ft_metadata');
    ftMetaCache.set(contract, p);
    p.catch(() => ftMetaCache.delete(contract));
  }
  return ftMetaCache.get(contract);
}

// Raw account → priced holdings in buildPortfolio()'s shape, plus DeFi
// positions (Rhea Lend) in data/defi.js's position shape.
export async function priceNearAccount(raw, { fetchImpl = (...a) => fetch(...a), fetchPricesImpl = fetchPrices } = {}) {
  const intentTokens = raw.intents?.tokens || [];
  const lendTokens = rheaLendTokens(raw.rheaLend);
  const contracts = [...new Set([...raw.tokens.map((t) => t.contract), ...intentTokens.map((t) => t.contract), ...lendTokens])];
  const prices = await fetchPricesImpl([NEAR_PRICE_KEY, ...contracts.map((c) => `near:${c}`)]).catch(() => new Map());
  const nearPrice = prices.get(NEAR_PRICE_KEY) || null;

  // Decimals: DefiLlama has them for priced tokens; ask the contract otherwise.
  const missing = contracts.filter((c) => !Number.isInteger(prices.get(`near:${c}`)?.decimals)).slice(0, MAX_METADATA);
  const metas = await pool(missing, 4, (c) => ftMetadata(fetchImpl, c));
  const metaBy = new Map(missing.map((c, i) => [c, metas[i]]));

  // contract → { decimals, price, symbol, name } | null (can't size it)
  const sizeOf = (c) => {
    const p = prices.get(`near:${c}`) || null;
    const meta = metaBy.get(c);
    const decimals = Number.isInteger(p?.decimals) ? p.decimals : Number.isInteger(meta?.decimals) ? meta.decimals : null;
    if (decimals == null) return null;
    return { decimals, price: p, symbol: p?.symbol || meta?.symbol || c.split('.')[0], name: meta?.name || p?.symbol || c };
  };

  const base = { chainId: NEAR_CHAIN_ID, chainName: NEAR_CHAIN_NAME, wallet: raw.accountId };
  const holdings = [];
  const native = fromBaseUnits(raw.nativeYocto, YOCTO);
  if (native > 0) {
    holdings.push({ ...base, address: null, symbol: 'NEAR', name: 'NEAR', amount: native, kind: 'near', price: nearPrice });
  }
  for (const t of raw.tokens) {
    const s = sizeOf(t.contract);
    if (!s) continue; // can't size it — skip rather than show a wrong amount
    const amount = fromBaseUnits(t.raw, s.decimals);
    if (!(amount > 0)) continue;
    // Liquid-staking tokens (stNEAR, LiNEAR, rNEAR) are staking positions.
    const lst = lstProtocol(t.contract);
    holdings.push({
      ...base, address: t.contract, symbol: s.symbol, name: s.name, amount, kind: 'ft', price: s.price,
      ...(lst ? { protocol: lst, label: 'Staking' } : {}),
    });
  }
  for (const s of raw.pools) {
    holdings.push({
      ...base,
      address: `pool:${s.pool}`, // distinct holdings key per pool
      symbol: 'NEAR',
      name: `Staked NEAR · ${s.pool}`,
      amount: fromBaseUnits(s.yocto, YOCTO),
      kind: 'near',
      protocol: s.pool,
      label: 'Staking',
      price: nearPrice,
    });
  }
  // NEAR unstaked inside an LST contract: owned, not in the wallet yet.
  for (const u of raw.unstakes || []) {
    const state = u.withdrawable ? 'withdrawable' : 'unstaking';
    holdings.push({
      ...base,
      address: `unstake:${u.contract}:${state}`,
      symbol: 'NEAR',
      name: `${u.withdrawable ? 'Withdrawable' : 'Unstaking'} NEAR · ${u.protocol}`,
      amount: fromBaseUnits(u.yocto, YOCTO),
      kind: 'near',
      protocol: `${u.protocol} (${state})`,
      label: 'Staking',
      price: nearPrice,
    });
  }
  // Public NEAR Intents balances: FTs held on intents.near for this account.
  for (const t of intentTokens) {
    const s = sizeOf(t.contract);
    if (!s) continue;
    const amount = fromBaseUnits(t.raw, s.decimals);
    if (!(amount > 0)) continue;
    holdings.push({
      ...base, address: `intents:${t.contract}`, symbol: s.symbol, name: `${s.name} · NEAR Intents`,
      amount, kind: 'ft', price: s.price, protocol: 'NEAR Intents', label: 'Intents',
    });
  }

  const positions = [rheaLendPosition(raw.rheaLend, sizeOf, { accountId: raw.accountId })].filter(Boolean);
  return {
    accountId: raw.accountId,
    exists: raw.exists,
    holdings,
    positions,
    intentsOtherCount: raw.intents?.otherCount || 0,
    defiErrors: raw.defiErrors || [],
    ...(raw.partial ? { partial: true } : {}),
    fetchedAt: Date.now(),
  };
}

// Per-account breakdown for the AI facts (holdings in the portfolio are
// aggregated across accounts, so this is the only place that says whose is what).
//
// Token symbols and names are chosen by whoever deployed the contract, so they
// are untrusted text headed into an LLM prompt (airdrop spam like
// "claim-at-xyz.com", or outright instructions). Only tokens with a market
// price are listed, under a sanitized symbol; unpriced ones become a count.
// Detection runs on the RAW symbol (see prompts/untrusted.js), before it is
// squeezed to a ticker, so "Ignore previous…" is withheld, not shortened.
const cleanSymbol = (s) => guardString(s, 'symbol').value;

export function nearAccountFacts(accounts = []) {
  const r = (n) => (Number.isFinite(n) ? Number(n.toPrecision(6)) : null);
  return accounts.map((a) => {
    const rows = a.holdings || [];
    const priced = rows.filter((h) => h.price?.price != null);
    const unpriced = rows.length - priced.length;
    return {
      account: a.accountId,
      found: a.exists !== false,
      holdings: priced.map((h) => ({
        asset: cleanSymbol(h.symbol),
        amount: r(h.amount),
        usd: r(h.amount * h.price.price),
        ...(h.label === 'Staking' ? { staked: true, stakedIn: h.protocol } : {}),
        ...(h.label === 'Intents' ? { heldIn: 'NEAR Intents (public balance on intents.near)' } : {}),
      })),
      // Lending positions: listed tokens are set by the protocol's governance,
      // but symbols still come from token contracts, so they are sanitized too.
      ...(a.positions?.length
        ? {
          positions: a.positions.map((p) => ({
            protocol: p.protocol,
            kind: p.kind,
            netUsd: r(p.usd),
            healthFactor: p.healthFactor != null ? r(p.healthFactor) : null,
            legs: p.legs.map((l) => ({ side: l.kind, asset: cleanSymbol(l.symbol), amount: r(l.amount), usd: r(l.usd) })),
            ...(p.unpricedLegs ? { unpricedLegs: p.unpricedLegs } : {}),
          })),
        }
        : {}),
      ...(a.intentsOtherCount ? { intentsNonFungibleCount: a.intentsOtherCount } : {}),
      ...(a.defiErrors?.length ? { unreadProtocols: a.defiErrors } : {}),
      ...(unpriced
        ? { unpricedTokenCount: unpriced, unpricedNote: 'Tokens with no market price — often airdrop spam; names withheld. Advise not to interact with them.' }
        : {}),
    };
  });
}

export async function loadNearAccount(accountId, opts) {
  return priceNearAccount(await fetchNearAccountRaw(accountId, opts), opts);
}
