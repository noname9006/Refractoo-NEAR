import { guardString } from '../prompts/untrusted.js';
// Public NEAR account, read-only by account name — no wallet, no signature.
//
//   balances + FT list + staking pools   FastNEAR  api.fastnear.com/v1/account/{id}/full
//   staked amount per pool               NEAR RPC  get_account_total_balance (view call)
//   FT decimals/symbol (unpriced only)   NEAR RPC  ft_metadata (view call)
//   USD prices + 24h change              DefiLlama coingecko:near, near:<contract>
//
// All three are public, CORS-enabled endpoints called from the browser. They
// see the account name you look up — the same exposure as the EVM explorers,
// stated in the "who sees what" panel. Nothing here is cached to disk.
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
const RPC = 'https://rpc.mainnet.fastnear.com';
const YOCTO = 24;
const MAX_TOKENS = 40; // FT lists can be long with airdrop spam
const MAX_POOLS = 10;
const MAX_METADATA = 15;

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

// Integer string in base units → JS number (enough precision for display/USD).
export function fromBaseUnits(raw, decimals) {
  const s = String(raw ?? '0').replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(s)) return 0;
  if (!decimals) return Number(s);
  const pad = s.padStart(decimals + 1, '0');
  return Number(`${pad.slice(0, -decimals)}.${pad.slice(-decimals)}`);
}

const b64 = (obj) => btoa(JSON.stringify(obj));

async function rpcView(fetchImpl, contract, method, args = {}) {
  const r = await fetchImpl(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'query',
      params: { request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: b64(args) },
    }),
  });
  const j = await r.json();
  if (j.error || !Array.isArray(j.result?.result)) throw new Error(j.error?.cause?.name || 'rpc view failed');
  return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
}

// Limited-concurrency map.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); }
  }));
  return out;
}

// → { accountId, exists, nativeYocto, tokens: [{contract, raw}], pools: [{pool, yocto}] }
export async function fetchNearAccountRaw(accountId, { fetchImpl = (...a) => fetch(...a) } = {}) {
  const id = normalizeAccountId(accountId);
  if (!isNearAccountId(id)) throw new Error(`"${accountId}" is not a NEAR account id`);
  const r = await fetchImpl(`${FASTNEAR}/${encodeURIComponent(id)}/full`);
  if (!r.ok) throw new Error(`FastNEAR ${r.status}`);
  const full = await r.json();
  if (!full?.state) return { accountId: id, exists: false, nativeYocto: '0', tokens: [], pools: [] };

  // Spendable = balance; `locked` is validator stake of this account itself.
  const tokens = (full.tokens || [])
    .filter((t) => t?.contract_id && /^\d+$/.test(String(t.balance || '')) && BigInt(t.balance) > 0n)
    .slice(0, MAX_TOKENS)
    .map((t) => ({ contract: t.contract_id, raw: String(t.balance) }));

  const poolIds = (full.pools || []).map((p) => p?.pool_id).filter(Boolean).slice(0, MAX_POOLS);
  const staked = await pool(poolIds, 4, (p) => rpcView(fetchImpl, p, 'get_account_total_balance', { account_id: id }));
  const pools = poolIds
    .map((p, i) => ({ pool: p, yocto: typeof staked[i] === 'string' ? staked[i] : null }))
    .filter((p) => p.yocto && BigInt(p.yocto) > 0n);

  return {
    accountId: id,
    exists: true,
    nativeYocto: String(full.state.balance || '0'),
    lockedYocto: String(full.state.locked || '0'),
    tokens,
    pools,
  };
}

// Raw account → priced holdings in buildPortfolio()'s shape.
export async function priceNearAccount(raw, { fetchImpl = (...a) => fetch(...a), fetchPricesImpl = fetchPrices } = {}) {
  const keys = [NEAR_PRICE_KEY, ...raw.tokens.map((t) => `near:${t.contract}`)];
  const prices = await fetchPricesImpl(keys).catch(() => new Map());
  const nearPrice = prices.get(NEAR_PRICE_KEY) || null;

  // Decimals: DefiLlama has them for priced tokens; ask the contract otherwise.
  const missing = raw.tokens.filter((t) => !Number.isInteger(prices.get(`near:${t.contract}`)?.decimals)).slice(0, MAX_METADATA);
  const metas = await pool(missing, 4, (t) => rpcView(fetchImpl, t.contract, 'ft_metadata'));
  const metaBy = new Map(missing.map((t, i) => [t.contract, metas[i]]));

  const base = { chainId: NEAR_CHAIN_ID, chainName: NEAR_CHAIN_NAME, wallet: raw.accountId };
  const holdings = [];
  const native = fromBaseUnits(raw.nativeYocto, YOCTO);
  if (native > 0) {
    holdings.push({ ...base, address: null, symbol: 'NEAR', name: 'NEAR', amount: native, kind: 'near', price: nearPrice });
  }
  for (const t of raw.tokens) {
    const p = prices.get(`near:${t.contract}`) || null;
    const meta = metaBy.get(t.contract);
    const decimals = Number.isInteger(p?.decimals) ? p.decimals : Number.isInteger(meta?.decimals) ? meta.decimals : null;
    if (decimals == null) continue; // can't size it — skip rather than show a wrong amount
    const amount = fromBaseUnits(t.raw, decimals);
    if (!(amount > 0)) continue;
    holdings.push({
      ...base,
      address: t.contract,
      symbol: p?.symbol || meta?.symbol || t.contract.split('.')[0],
      name: meta?.name || p?.symbol || t.contract,
      amount,
      kind: 'ft',
      price: p,
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
  return { accountId: raw.accountId, exists: raw.exists, holdings, fetchedAt: Date.now() };
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
      })),
      ...(unpriced
        ? { unpricedTokenCount: unpriced, unpricedNote: 'Tokens with no market price — often airdrop spam; names withheld. Advise not to interact with them.' }
        : {}),
    };
  });
}

export async function loadNearAccount(accountId, opts) {
  return priceNearAccount(await fetchNearAccountRaw(accountId, opts), opts);
}
