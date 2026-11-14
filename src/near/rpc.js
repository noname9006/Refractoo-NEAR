// Shared NEAR RPC helpers: read-only view calls and limited-concurrency map.
// Used by the account reader and the per-protocol DeFi adapters.

export const NEAR_RPC = 'https://rpc.mainnet.fastnear.com';
// Official NEAR RPC (run by NEAR). Same JSON-RPC, CORS-enabled. Used when FastNEAR
// throttles, so its lookups are visible to NEAR as well (see the "who sees what" panel).
export const NEAR_RPC_FALLBACK = 'https://rpc.mainnet.near.org';
const ENDPOINTS = [NEAR_RPC, NEAR_RPC_FALLBACK];

const b64 = (obj) => btoa(JSON.stringify(obj));
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Rate gate shared by every NEAR read (all accounts, all protocols). FastNEAR's
// free RPC answers bursts with 429. The old per-request retries all woke up
// together and hit the same wall again, so:
//   • at most MAX_IN_FLIGHT requests are open at once;
//   • request starts are at least MIN_GAP_MS apart;
//   • a 429 or 5xx pauses the whole gate, not just the request that got it, for
//     the server's Retry-After (seconds) or an exponential backoff with jitter.
// MIN_GAP_MS is a guess at a safe rate; FastNEAR's published limit wasn't checked.
const MAX_IN_FLIGHT = 3;
const MIN_GAP_MS = 100;
const BACKOFF_MS = [1000, 2000, 4000, 8000]; // one entry per retry
const MAX_PAUSE_MS = 15_000;

let open = 0;
const slotWaiters = [];
let nextStartAt = 0; // earliest moment the next request may start
let pausedUntil = 0; // nothing starts before this (set by a 429 or 5xx)

// A released slot goes straight to the next waiter, so it is never counted as
// free while someone is queued for it.
async function acquire() {
  if (open < MAX_IN_FLIGHT) { open++; return; }
  await new Promise((res) => slotWaiters.push(res));
}
function release() {
  const next = slotWaiters.shift();
  if (next) next(); else open--;
}

async function paced(fn) {
  await acquire();
  try {
    // Re-check after each sleep: a pause set while we slept still applies.
    let wait = Math.max(nextStartAt, pausedUntil) - Date.now();
    while (wait > 0) { await sleep(wait); wait = Math.max(nextStartAt, pausedUntil) - Date.now(); }
    nextStartAt = Date.now() + MIN_GAP_MS; // no await between the check and this write
    return await fn();
  } finally {
    release();
  }
}

function pause(ms) {
  pausedUntil = Math.max(pausedUntil, Date.now() + Math.min(ms, MAX_PAUSE_MS) + Math.random() * 250);
}

// Retry-After in seconds → ms. Null when absent or in HTTP-date form.
function retryAfterMs(r) {
  const s = Number(r.headers?.get?.('retry-after'));
  return Number.isFinite(s) && s > 0 ? s * 1000 : null;
}

// One round tries each endpoint in turn: a 429, 5xx or network error moves on to
// the next one at once. Only when every endpoint in the round is throttled does the
// gate pause and start another round (up to BACKOFF_MS.length retries).
async function rpcPost(fetchImpl, params) {
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params }),
  };
  for (let round = 0; ; round++) {
    let last = null;
    let err = null;
    for (const url of ENDPOINTS) {
      try {
        last = await paced(() => fetchImpl(url, init));
      } catch (e) {
        err = e;
        continue;
      }
      const throttled = last.status === 429 || last.status >= 500;
      if (!throttled) return last.json();
    }
    if (!last) throw err; // every endpoint failed with a network error, not throttling
    if (round >= BACKOFF_MS.length) throw new Error(`RPC ${last.status}`);
    pause(retryAfterMs(last) ?? BACKOFF_MS[round]);
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
