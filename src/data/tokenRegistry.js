// Shared client-side token registry — fetched from the local proxy server and
// cached in localStorage permanently. Used by coinIcons.js (icons) and enrich.js
// (scam filtering + metadata).
//
// CACHING: the cached map is kept indefinitely and served instantly on every
// session load (token metadata barely changes day-to-day). When it's older than
// TTL we still serve the stale copy immediately, then refresh from the server in
// the background and notify subscribers (see onRegistryUpdate) so icons repaint.

// v2: registry now includes Polygon (chainId 137).
// v3: entries now carry a market-cap `rank`; the endpoint is gzipped. Bumped so
// existing clients re-fetch the richer payload instead of serving a 24h-fresh
// pre-rank map (enrich.js tiers its probing on rank/imageUrl).
// v4: registry covers 13 chains (BNB, Mantle, Manta, Avalanche, Gnosis, zkSync,
// Scroll, Celo added). Bumped so clients drop the 5-chain map; the old key is
// removed to free localStorage space (the map is ~3 MB).
const LS_KEY = 'cg_tokenmap_v4';
try { localStorage.removeItem('cg_tokenmap_v3'); } catch {}
const TTL = 24 * 60 * 60 * 1000;

let _map = null;
let _promise = null;

// Subscribers notified whenever _map is (re)assigned — including a background
// refresh of a stale cache. coinIcons.js uses this to repopulate fresh icons.
const _subs = new Set();
export function onRegistryUpdate(cb) {
  _subs.add(cb);
  return () => _subs.delete(cb);
}
function setMap(map) {
  _map = map;
  for (const cb of _subs) { try { cb(_map); } catch {} }
  return _map;
}

// Returns { map, stale } for whatever is in storage, or null when absent. A
// stale map is still usable — callers serve it and refresh in the background.
function tryStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw && raw.map) return { map: raw.map, stale: Date.now() - raw.saved >= TTL };
  } catch {}
  return null;
}

function saveStorage(map) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ saved: Date.now(), map }));
  } catch {}
}

function fetchRegistry() {
  return fetch('/api/tokenlist')
    .then((r) => r.json())
    .then((d) => {
      const map = d.map || {};
      saveStorage(map);
      return setMap(map);
    });
}

export function getTokenRegistry() {
  if (_map !== null) return Promise.resolve(_map);
  if (_promise) return _promise;

  const cached = tryStorage();
  if (cached) {
    setMap(cached.map);
    // Outdated cache: serve it now, refresh in the background (fire-and-forget).
    if (cached.stale) fetchRegistry().catch(() => {});
    return Promise.resolve(_map);
  }

  _promise = fetchRegistry()
    .catch(() => setMap({}))
    .finally(() => { _promise = null; });

  return _promise;
}

// Synchronous lookup — only valid after getTokenRegistry() has resolved.
// Returns { symbol, name, cgId, imageUrl } | null
export function lookupToken(chainId, address) {
  if (!_map || !address) return null;
  return _map[`${chainId}:${address.toLowerCase()}`] || null;
}

// Kick off load immediately so it's ready before first render
getTokenRegistry();
