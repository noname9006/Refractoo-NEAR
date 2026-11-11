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

// Etherscan V2 free tier is ~5 req/sec against ONE host with ONE key shared by
// every chain. Firing all chains' tx/token/log queries at once returns "NOTOK"
// (rate limited). Funnel them through a tight limiter so they don't trip it.
export const etherscanLimit = createLimiter(2);
