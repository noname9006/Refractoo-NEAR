// Public NEAR transactions for an account, mapped to the Activity feed's
// native-tx shape. Sources, in order:
//   1. NearBlocks API v3 — optional VITE_NEARBLOCKS_KEY (the keyless tier is
//      rate-limited hard and answers 429); one backoff retry on 429/5xx.
//   2. FastNEAR tx API (tx.main.fastnear.com) — keyless, CORS-enabled fallback.
//   3. The last list that loaded for this account (stale beats empty).
// Throws only when every source failed and nothing was ever loaded.
const NEARBLOCKS = 'https://api.nearblocks.io/v3';
const FASTNEAR = 'https://tx.main.fastnear.com/v0';
const NB_KEY = import.meta.env.VITE_NEARBLOCKS_KEY || '';

// yocto (10^-24) → NEAR via BigInt: a float divide turns 2.5 into 2.5000000000000004.
// Kept to 6 decimals; anything smaller is a security deposit, not a transfer.
const yoctoToNear = (y) => { try { return Number(BigInt(String(y || 0).split('.')[0]) / 10n ** 18n) / 1e6; } catch { return 0; } };
// 1-yocto deposits are NEP-141 security attachments, not transfers.
const realDeposit = (n) => (n >= 1e-6 ? n : 0);

const cache = new Map();    // accountId → { at, txs, source }
const lastGood = new Map(); // accountId → { txs, source } — survives failures
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(src, status) { super(`${src} HTTP ${status}`); this.status = status; }
}

async function fetchRetry(src, url, init, { retries = 1, baseMs = 1500 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) throw new HttpError(src, res.status);
    const ra = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 8000) : baseMs * 2 ** attempt);
  }
}

async function fromNearBlocks(accountId, limit) {
  const headers = NB_KEY ? { Authorization: `Bearer ${NB_KEY}` } : undefined;
  const j = await fetchRetry('NearBlocks', `${NEARBLOCKS}/accounts/${encodeURIComponent(accountId)}/txns?limit=${limit}`, { headers });
  return (j?.data || j?.txns || []).map((t) => {
    const fn = (t.actions || []).find((a) => a.action === 'FUNCTION_CALL');
    return {
      hash: t.transaction_hash,
      timestamp: Math.round(Number(t.block_timestamp) / 1e6),
      from: t.signer_account_id,
      to: t.receiver_account_id,
      valueNear: realDeposit(yoctoToNear(t.actions_agg?.deposit)),
      method: fn?.method || ((t.actions || []).some((a) => a.action === 'TRANSFER') ? '' : String(t.actions?.[0]?.action || '').toLowerCase().replace(/_/g, ' ')),
      failed: t.outcomes?.status === false,
    };
  });
}

async function fromFastNear(accountId, limit) {
  const post = (path, body) => fetchRetry('FastNEAR', `${FASTNEAR}/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const idx = await post('account', { account_id: accountId });
  const hashes = (idx?.account_txs || [])
    .slice()
    .sort((a, b) => Number(BigInt(b.tx_block_timestamp) - BigInt(a.tx_block_timestamp)))
    .slice(0, Math.min(limit, 20))
    .map((t) => t.transaction_hash);
  if (!hashes.length) return [];
  const det = await post('transactions', { tx_hashes: hashes });
  return (det?.transactions || []).map(({ transaction: tx, execution_outcome: eo }) => {
    const actions = tx?.actions || [];
    let deposit = 0n; let method = ''; let hasTransfer = false;
    for (const a of actions) {
      if (a === 'CreateAccount') continue;
      const [kind, body] = typeof a === 'string' ? [a, null] : Object.entries(a)[0];
      if (kind === 'Transfer') { hasTransfer = true; deposit += BigInt(body?.deposit || 0); }
      else if (kind === 'FunctionCall') { method ||= body?.method_name || ''; deposit += BigInt(body?.deposit || 0); }
    }
    const firstKind = typeof actions[0] === 'string' ? actions[0] : Object.keys(actions[0] || {})[0] || '';
    return {
      hash: tx?.hash,
      timestamp: Math.round(Number(eo?.block_timestamp || 0) / 1e6),
      from: tx?.signer_id,
      to: tx?.receiver_id,
      valueNear: realDeposit(yoctoToNear(deposit)),
      method: method || (hasTransfer ? '' : firstKind.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()),
      failed: !!eo?.outcome?.status?.Failure,
    };
  }).filter((t) => t.hash);
}

// Returns the tx array; `.source` on the array says where it came from
// ('nearblocks' | 'fastnear' | 'stale').
export async function fetchNearTxs(accountId, { limit = 25 } = {}) {
  const hit = cache.get(accountId);
  if (hit && Date.now() - hit.at < 50_000) return tag(hit.txs, hit.source);
  const errors = [];
  for (const [source, fn] of [['nearblocks', fromNearBlocks], ['fastnear', fromFastNear]]) {
    try {
      const txs = await fn(accountId, limit);
      cache.set(accountId, { at: Date.now(), txs, source });
      lastGood.set(accountId, { txs, source });
      return tag(txs, source);
    } catch (e) {
      errors.push(e);
      console.warn(`[nearTxs] ${source} failed for ${accountId}:`, e.message);
    }
  }
  const prev = lastGood.get(accountId);
  if (prev) return tag(prev.txs, 'stale');
  const err = new Error(errors.map((e) => e.message).join('; '));
  err.rateLimited = errors.some((e) => e.status === 429);
  throw err;
}

const tag = (txs, source) => Object.assign(txs.slice(), { source });
