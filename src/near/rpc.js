// Shared NEAR RPC helpers: read-only view calls and limited-concurrency map.
// Used by the account reader and the per-protocol DeFi adapters.

export const NEAR_RPC = 'https://rpc.mainnet.fastnear.com';

const b64 = (obj) => btoa(JSON.stringify(obj));

// FastNEAR's free RPC answers bursts with 429. All NEAR reads share one
// in-flight cap, and a 429/5xx is retried with backoff before it counts as a
// failure.
const MAX_IN_FLIGHT = 4;
const RETRY_MS = [400, 1200, 2500];
let inFlight = 0;
const waiters = [];
async function limited(fn) {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise((res) => waiters.push(res));
  inFlight++;
  try { return await fn(); } finally { inFlight--; waiters.shift()?.(); }
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function rpcPost(fetchImpl, params) {
  for (let attempt = 0; ; attempt++) {
    const r = await limited(() => fetchImpl(NEAR_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params }),
    }));
    if ((r.status === 429 || r.status >= 500) && attempt < RETRY_MS.length) { await sleep(RETRY_MS[attempt]); continue; }
    if (r.status === 429 || r.status >= 500) throw new Error(`RPC ${r.status}`);
    return r.json();
  }
}

// Call a view method; returns the decoded JSON result or throws.
export async function rpcView(fetchImpl, contract, method, args = {}) {
  const j = await rpcPost(fetchImpl, { request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: b64(args) });
  if (j.error || !Array.isArray(j.result?.result)) {
    throw new Error(j.error?.cause?.name || (j.result?.error ? String(j.result.error).slice(0, 160) : 'rpc view failed'));
  }
  return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
}

// view_account → { amount, locked } or null when the account doesn't exist.
export async function rpcAccount(fetchImpl, accountId) {
  const j = await rpcPost(fetchImpl, { request_type: 'view_account', finality: 'final', account_id: accountId });
  if (j.error) {
    if (j.error.cause?.name === 'UNKNOWN_ACCOUNT') return null;
    throw new Error(j.error.cause?.name || 'view_account failed');
  }
  return j.result && /^\d+$/.test(String(j.result.amount)) ? { amount: String(j.result.amount), locked: String(j.result.locked || '0') } : null;
}

// Limited-concurrency map. A rejected item becomes null; the rest still run.
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); }
  }));
  return out;
}

// Integer string in base units → JS number (enough precision for display/USD).
export function fromBaseUnits(raw, decimals) {
  const s = String(raw ?? '0').replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(s)) return 0;
  if (!decimals) return Number(s);
  const pad = s.padStart(decimals + 1, '0');
  return Number(`${pad.slice(0, -decimals)}.${pad.slice(-decimals)}`);
}

// Positive integer string (base units) or null.
export const posInt = (v) => (/^\d+$/.test(String(v ?? '')) && BigInt(v) > 0n ? String(v) : null);
