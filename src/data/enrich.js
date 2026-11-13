// Orchestrates the per-wallet enrichment reads (token balances, Aave position,
// approvals) across all chains. Kept separate from public.js so the raw native
// + tx reads stay independent of the heavier, optional integrations. Every
// branch degrades to empty/null on failure — enrichment never blocks the app.
//
// Probing is TIERED so the dashboard paints fast without giving up coverage:
//   • Tier 1 — curated tokens + the top-market-cap slice of the CoinGecko
//     registry (those with an icon, a reliable proxy for "real, liquid") +
//     anything the wallet has actually transferred. ~hundreds of tokens/chain;
//     covers essentially all real holdings. Probed first, rendered immediately.
//   • Tier 2 — the long tail of the registry (thousands of tokens). Probed in
//     the background after tier 1 has already painted, so a dust holding in an
//     obscure token still shows up, just a beat later.
// Results stream out through onProgress(enriched, phase) as each chain resolves.

import { CHAINS } from './public.js';
import { TOKENS, makeToken } from './tokens.js';
import { probeBalances } from './balances.js';
import { fetchAavePosition } from './defi.js';
import { fetchApprovals } from './approvals.js';
import { getTokenRegistry } from './tokenRegistry.js';
import { USE_TOKEN_REGISTRY } from '../config/networks.js';
import { getCachedEnriched, setCachedEnriched } from '../storage/dataCache.js';

// Split the probe universe into tier-1 (fast, high-value) and tier-2 (long tail)
// token lists per chain. Returns { tier1: Map<chainId, token[]>, tier2: Map<…> }.
async function buildTieredTokens(clusterData) {
  const supported = new Set(CHAINS.map((c) => c.chainId));
  const curatedByChain = new Map();
  const tier1 = new Map(); // cid -> Map(addr -> token)
  const tier2 = new Map();
  for (const c of CHAINS) {
    curatedByChain.set(c.chainId, new Set());
    tier1.set(c.chainId, new Map());
    tier2.set(c.chainId, new Map());
  }

  // Curated tokens are always tier-1 (already full token objects).
  for (const t of TOKENS) {
    if (!supported.has(t.chainId)) continue;
    const addr = t.address.toLowerCase();
    curatedByChain.get(t.chainId).add(addr);
    tier1.get(t.chainId).set(addr, t);
  }

  // The CoinGecko registry only covers mainnets. On a testnet profile it would
  // be thousands of guaranteed-empty multicall sub-calls, so it's skipped and the
  // probe universe becomes the curated list plus tokens seen in history. Note
  // that this also disables the "not in the registry ⇒ probably a scam" filter
  // below, which is correct: on a testnet, absence from CoinGecko means nothing.
  const cgMap = USE_TOKEN_REGISTRY ? await getTokenRegistry().catch(() => ({})) : {};
  const cgAvailable = Object.keys(cgMap).length > 0;

  // Registry: an entry with an icon (imageUrl) or an explicit market-cap rank is
  // in CoinGecko's top market pages → tier-1. Everything else is tier-2.
  if (cgAvailable) {
    for (const [key, entry] of Object.entries(cgMap)) {
      const colon = key.indexOf(':');
      const cid = Number(key.slice(0, colon));
      const addr = key.slice(colon + 1); // already lowercase
      if (!supported.has(cid)) continue;
      if (curatedByChain.get(cid).has(addr)) continue;
      const tk = makeToken(cid, { address: addr, symbol: entry.symbol, name: entry.name, decimals: 18 });
      const isTop = !!entry.imageUrl || entry.rank != null;
      if (isTop) tier1.get(cid).set(addr, tk);
      else if (!tier1.get(cid).has(addr)) tier2.get(cid).set(addr, tk);
    }
  }

  // Tokens the wallet has actually transferred (from Etherscan history) are
  // promoted to tier-1 regardless of market cap — the user demonstrably touched
  // them. Etherscan's on-chain metadata (decimals) overrides registry defaults.
  for (const pub of Object.values(clusterData || {})) {
    for (const chain of pub?.chains || []) {
      if (chain.error) continue;
      const cid = chain.chainId;
      if (!supported.has(cid)) continue;
      for (const tx of chain.tokenTransfers || []) {
        const addr = tx.contract?.toLowerCase();
        if (!addr || curatedByChain.get(cid).has(addr)) continue;
        const cgEntry = cgMap[`${cid}:${addr}`];
        // With the registry available, skip tokens not in it (scam filter).
        if (cgAvailable && !cgEntry) continue;
        tier2.get(cid).delete(addr); // promote out of the long tail
        tier1.get(cid).set(addr, makeToken(cid, {
          address: tx.contract,
          symbol: cgEntry?.symbol || tx.token,
          name: cgEntry?.name || tx.tokenName || tx.token,
          decimals: tx.decimals ?? 18,
        }));
      }
    }
  }

  return {
    tier1: new Map([...tier1].map(([cid, m]) => [cid, [...m.values()]])),
    tier2: new Map([...tier2].map(([cid, m]) => [cid, [...m.values()]])),
  };
}

// Returns { [address]: [{ chainId, chainName, balances[], ok, aave, approvals[] }] }.
// clusterData: raw public data ({ [address]: { chains[] } }), used to discover
// transferred-token addresses that aren't in the curated list.
// onProgress(enriched, phase): called as data streams in. phase ∈
//   'partial'  — a chain's balances / a wallet's positions just landed
//   'tier1'    — every chain's high-value balances are in (good moment to price)
export async function enrichCluster(addresses, { rpcOverrides = {}, clusterData = {}, onProgress } = {}) {
  // Output skeleton: one slot per (wallet, chain), filled as phases complete.
  const out = {};
  for (const a of addresses) {
    out[a] = CHAINS.map((c) => ({
      chainId: c.chainId, chainName: c.name, balances: [], ok: false, aave: null, approvals: [], extrasDone: false,
    }));
  }
  const slotOf = (a, cid) => out[a].find((s) => s.chainId === cid);
  const emit = (phase) => { if (typeof onProgress === 'function') onProgress(out, phase); };

  // Last-good cached balances per (wallet, chain) for per-chain fallback.
  const cachedByAddr = new Map();
  await Promise.all(addresses.map(async (a) => {
    const cached = await getCachedEnriched(a).catch(() => null);
    cachedByAddr.set(a, new Map((cached?.chains || []).map((c) => [c.chainId, c])));
  }));

  const { tier1, tier2 } = await buildTieredTokens(clusterData);

  // ── Phase 1: tier-1 balances, per chain, all wallets batched into one probe ──
  await Promise.all(CHAINS.map(async (chain) => {
    const res = await probeBalances(addresses, chain, tier1.get(chain.chainId) || [], rpcOverrides[chain.chainId]).catch(() => null);
    if (res) {
      for (const a of addresses) {
        const slot = slotOf(a, chain.chainId);
        slot.balances = res.byOwner.get(a.toLowerCase()) || [];
        slot.ok = res.ok;
      }
    }
    emit('partial'); // this chain's balances can render now
  }));
  emit('tier1'); // all high-value balances in — caller can fetch prices

  // ── Phase 1b: Aave positions + approvals, per (wallet, chain) ──
  await Promise.all(addresses.flatMap((a) =>
    CHAINS.map(async (chain) => {
      const rpc = rpcOverrides[chain.chainId];
      const [aave, approvals] = await Promise.all([
        fetchAavePosition(a, chain, rpc).catch(() => null),
        fetchApprovals(a, chain, rpc).catch(() => []),
      ]);
      const slot = slotOf(a, chain.chainId);
      slot.aave = aave;
      slot.approvals = approvals;
      slot.extrasDone = true;
      emit('partial');
    })
  ));

  // ── Phase 2: tier-2 long tail, background, accumulated onto tier-1 results ──
  await Promise.all(CHAINS.map(async (chain) => {
    const tokens = tier2.get(chain.chainId) || [];
    if (!tokens.length) return;
    const res = await probeBalances(addresses, chain, tokens, rpcOverrides[chain.chainId]).catch(() => null);
    if (res) {
      for (const a of addresses) {
        const extra = res.byOwner.get(a.toLowerCase()) || [];
        // tier-1 and tier-2 token sets are disjoint by address, so concat is safe.
        if (extra.length) slotOf(a, chain.chainId).balances = [...slotOf(a, chain.chainId).balances, ...extra];
      }
    }
    emit('partial');
  }));

  // ── Per-chain cache fallback + write last-good ──
  for (const a of addresses) {
    const cachedChains = cachedByAddr.get(a);
    out[a] = out[a].map((s) => {
      if (s.ok) return s;
      const c = cachedChains.get(s.chainId);
      // A failed chain (incomplete probe) falls back to its last-good tokens so
      // an intermittent RPC failure doesn't make the whole chain disappear.
      if (c && (c.balances?.length || 0) > 0) return { ...s, balances: c.balances, stale: true };
      return s;
    });
    // Cache only chains that succeeded (keep the fallback pool clean).
    const toCache = out[a].map((s) => (s.ok ? s : cachedChains.get(s.chainId) || s));
    setCachedEnriched(a, toCache);
  }

  return out;
}
