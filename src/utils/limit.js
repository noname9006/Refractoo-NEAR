// Tiny promise-concurrency limiter. publicnode's RPC endpoints (one subdomain
// per chain) rate-limit per host, so bursting many multicalls at one chain's
// endpoint produces 503s that blank that chain non-deterministically. Limiters
// cap the in-flight count, trading a little latency for reliable, complete loads.

export function createLimiter(max) {
  let active = 0;
  const queue = [];
  const pump = () => {
    if (active >= max || queue.length === 0) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => { active -= 1; pump(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump(); });
}

// Shared across the whole app. 5 chains × chunked multicalls + aave + approvals
// all funnel through here. Retained for callers that aren't chain-scoped.
export const rpcLimit = createLimiter(5);

// Per-chain RPC limiters. publicnode exposes one subdomain per chain
// (ethereum-rpc / arbitrum-one-rpc / …) and rate-limits per host — so firing
// chain A's multicalls in no way constrains chain B. A single global width-5
// pipe across all chains was therefore needlessly serializing independent
// endpoints; each chain now gets its own limiter so all five load in parallel.
//
// A user-supplied custom RPC has no shared rate limit (it's their own node), so
// it gets a much wider limiter — the point of bringing your own RPC is speed,
// and privacy: the publicnode operator no longer sees the queried address.
const SHARED_RPC_WIDTH = 4; // public shared-infra endpoint, per chain
const CUSTOM_RPC_WIDTH = 16; // user's own node — go fast
const _rpcLimiters = new Map();

export function rpcLimitFor(chainId, custom = false) {
  const key = `${chainId}:${custom ? 'custom' : 'shared'}`;
  let lim = _rpcLimiters.get(key);
  if (!lim) {
    lim = createLimiter(custom ? CUSTOM_RPC_WIDTH : SHARED_RPC_WIDTH);
    _rpcLimiters.set(key, lim);
  }
  return lim;
}

// Etherscan V2 free tier allows 3 req/sec against ONE host with ONE key shared
// by every chain ("Max calls per sec rate limit reached (3/sec)"). A concurrency
// cap alone doesn't hold that — two fast responses in a row still burst — so
// requests are also PACED: at most ETHERSCAN_MAX starts per ETHERSCAN_WINDOW_MS.
const ETHERSCAN_MAX = 3;
const ETHERSCAN_WINDOW_MS = 1250; // 2.4 req/sec, headroom for network jitter
// Responses routinely take 1–9 s, so the in-flight cap is kept wide: the pacing
// below is what holds the rate, and a narrow cap just idles the queue.
const _etherscanQueue = createLimiter(6);
const _etherscanStarts = []; // start times of the last ETHERSCAN_MAX requests
export const etherscanLimit = (fn) => _etherscanQueue(async () => {
  // Sliding window, re-checked against the clock after every sleep. A fixed
  // per-request delay breaks in a background tab, where timers are clamped to
  // ≥1 s and fire together: it either bursts past the limit or crawls.
  for (;;) {
    const now = Date.now();
    while (_etherscanStarts.length && now - _etherscanStarts[0] >= ETHERSCAN_WINDOW_MS) _etherscanStarts.shift();
    if (_etherscanStarts.length < ETHERSCAN_MAX) break;
    await new Promise((r) => setTimeout(r, _etherscanStarts[0] + ETHERSCAN_WINDOW_MS - now));
  }
  _etherscanStarts.push(Date.now());
  return fn();
});

// Chains this key can't query for the rest of the session: not on the free plan
// (Optimism, Base, BNB, …), not served by the V2 API at all (Manta, zkSync, …),
// or out of daily quota. Every wallet × chain × endpoint would otherwise spend a
// paced slot (and a console line) re-learning the same refusal each refresh.
// Callers check BEFORE queueing and again INSIDE the limiter — requests queued
// before the first refusal came back must not fire either.
const ETHERSCAN_REFUSAL = /not supported for this chain|upgrade your api plan|unsupported chainid|free api limit reached/i;
const _etherscanBlocked = new Set();
export const etherscanBlocked = (chainId) => _etherscanBlocked.has(chainId);
// Returns true when `message` is a refusal that blocks the chain for the session.
export function noteEtherscanRefusal(chainId, chainName, message) {
  const msg = String(message || '');
  if (!ETHERSCAN_REFUSAL.test(msg)) return false;
  if (!_etherscanBlocked.has(chainId)) {
    _etherscanBlocked.add(chainId);
    console.info(`[etherscan] ${chainName || chainId}: skipped for this session — ${msg.split('.')[0]}`);
  }
  return true;
}
