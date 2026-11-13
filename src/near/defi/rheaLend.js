// Rhea Lend (formerly Burrow) — supplied, collateral, borrowed, health factor.
//
//   contract.main.burrow.near  get_account_all_positions  → supplied[], positions{ REGULAR | shadow_ref_v1-<pool> : { collateral[], borrowed[] } }
//   contract.main.burrow.near  get_assets                 → per-token config: extra_decimals, volatility_ratio
//
// Balances are in the token's decimals PLUS the asset's extra_decimals (USDC:
// 6 + 12). Health factor follows the protocol's own rule, per position:
//   Σ collateral_usd × vr  /  Σ borrowed_usd ÷ vr      (vr = volatility_ratio / 10000)
// It is only computed when every leg of that position has a price — a missing
// price would make it look safer or riskier than it is. LP-share collateral
// (shadow_ref_v1-*) has no price here yet, so it is listed amount-free.

import { rpcView, fromBaseUnits } from '../rpc.js';

export const RHEA_LEND = 'contract.main.burrow.near';
const isShadow = (id) => String(id).startsWith('shadow_');
const rows = (list) => (Array.isArray(list) ? list : [])
  .filter((x) => typeof x?.token_id === 'string' && /^\d+$/.test(String(x.balance || '')) && BigInt(x.balance) > 0n)
  .map((x) => ({ token: x.token_id, balance: String(x.balance) }));

// → null (no account) | { supplied, positions: { name: { collateral, borrowed } }, assets: { token: { extra, vr } } }
export async function fetchRheaLend(accountId, { fetchImpl }) {
  const acct = await rpcView(fetchImpl, RHEA_LEND, 'get_account_all_positions', { account_id: accountId });
  if (!acct || typeof acct !== 'object') return null;
  const supplied = rows(acct.supplied);
  const positions = {};
  for (const [name, p] of Object.entries(acct.positions || {})) {
    const collateral = rows(p?.collateral);
    const borrowed = rows(p?.borrowed);
    if (collateral.length || borrowed.length) positions[name] = { collateral, borrowed };
  }
  const tokens = [...new Set([supplied, ...Object.values(positions).flatMap((p) => [p.collateral, p.borrowed])]
    .flat().map((r) => r.token).filter((t) => !isShadow(t)))];
  if (!supplied.length && !Object.keys(positions).length) return null;

  const assets = {};
  if (tokens.length) {
    const list = await rpcView(fetchImpl, RHEA_LEND, 'get_assets', { token_ids: tokens }).catch(() => []);
    for (const a of Array.isArray(list) ? list : []) {
      const c = a?.config;
      if (a?.token_id && Number.isInteger(c?.extra_decimals)) {
        assets[a.token_id] = { extra: c.extra_decimals, vr: Number(c.volatility_ratio) / 10000 };
      }
    }
  }
  return { supplied, positions, assets };
}

// Tokens whose decimals/price the account reader needs to resolve.
export const rheaLendTokens = (raw) => (raw ? [...new Set([
  ...raw.supplied, ...Object.values(raw.positions).flatMap((p) => [...p.collateral, ...p.borrowed]),
].map((r) => r.token).filter((t) => !isShadow(t)))] : []);

// sizeOf(contract) → { decimals, price: {price,…}|null, symbol } | null
// → a DeFi position row (same shape as data/defi.js Aave rows) or null.
export function rheaLendPosition(raw, sizeOf, { accountId } = {}) {
  if (!raw) return null;
  let unpriced = 0;
  const leg = (r, kind) => {
    const a = raw.assets[r.token];
    const s = isShadow(r.token) ? null : sizeOf(r.token);
    if (!a || !s || !Number.isInteger(s.decimals)) {
      unpriced++;
      return { kind, token: r.token, symbol: isShadow(r.token) ? 'LP shares' : r.token, amount: null, usd: null, vr: null };
    }
    const amount = fromBaseUnits(r.balance, s.decimals + a.extra);
    const price = s.price?.price;
    if (price == null) unpriced++;
    return { kind, token: r.token, symbol: s.symbol, amount, usd: price != null ? amount * price : null, vr: a.vr };
  };

  const legs = raw.supplied.map((r) => leg(r, 'Supplied'));
  let healthFactor = null;
  let healthUnknown = false;
  for (const p of Object.values(raw.positions)) {
    const col = p.collateral.map((r) => leg(r, 'Collateral'));
    const bor = p.borrowed.map((r) => leg(r, 'Borrowed'));
    legs.push(...col, ...bor);
    if (!bor.length) continue;
    const priced = [...col, ...bor].every((l) => l.usd != null && l.vr > 0);
    if (!priced) { healthUnknown = true; continue; }
    const adjCol = col.reduce((s, l) => s + l.usd * l.vr, 0);
    const adjBor = bor.reduce((s, l) => s + l.usd / l.vr, 0);
    const hf = adjBor > 0 ? adjCol / adjBor : null;
    if (hf != null && (healthFactor == null || hf < healthFactor)) healthFactor = hf; // riskiest position
  }
  if (!legs.length) return null;

  const sum = (k) => legs.filter((l) => l.kind === k).reduce((s, l) => s + (l.usd || 0), 0);
  const supplied = sum('Supplied') + sum('Collateral');
  const borrowed = sum('Borrowed');
  const hasDebt = legs.some((l) => l.kind === 'Borrowed');
  const fmt = (n) => (n == null ? '?' : Number(n.toPrecision(6)).toLocaleString('en-US', { maximumFractionDigits: 6 }));

  return {
    protocol: 'Rhea Lend',
    chainId: 'near',
    chainName: 'NEAR',
    wallet: accountId,
    kind: 'Lending',
    glyph: '🏦',
    usd: supplied - borrowed,
    healthFactor,
    unpricedLegs: unpriced,
    legs: legs.map((l) => ({
      label: `${l.kind} ${l.symbol}`,
      tone: l.kind === 'Borrowed' ? 'bor' : 'sup',
      text: l.amount != null ? `${fmt(l.amount)} ${l.symbol}` : 'amount not priced',
      usd: l.usd,
      // raw fields for AI facts
      kind: l.kind, symbol: l.symbol, amount: l.amount,
    })),
    sub: healthFactor != null
      ? `Lending · Health factor ${healthFactor.toFixed(2)}`
      : hasDebt
        ? (healthUnknown ? 'Lending · health factor unavailable (unpriced leg)' : 'Lending')
        : 'Lending · no outstanding debt',
  };
}
