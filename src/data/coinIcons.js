// Token icons sourced from the server-side CoinGecko proxy (/api/tokenlist).
// The server fetches and caches the full token list daily, so no client ever
// hits CoinGecko directly (which would immediately exhaust the free-tier rate
// limit when loading a portfolio with many tokens).
import { useState, useEffect } from 'react';
import { getTokenRegistry, onRegistryUpdate } from './tokenRegistry.js';

const NATIVE_ICON = 'https://assets.coingecko.com/coins/images/279/small/ethereum.png';

// In-memory icon cache: "chainId:address" → url string | null
const mem = new Map();

// Persist resolved icon URLs to localStorage so they survive page reloads.
// v3: bumped to flush entries cached as `null` under earlier versions — those
// were poisoned by transient failures (incl. COEP-blocked loads) and would
// otherwise keep an icon from ever appearing.
//
// CACHING: persisted icons are kept indefinitely and loaded immediately on every
// session — even past `expires` — so icons paint without waiting on the network.
// Freshness is handled by the token registry: when its cache is outdated it
// refreshes in the background and we repopulate via onRegistryUpdate below. The
// `expires` field is retained only as a recency key for trimming the store.
const LS_ICONS = 'cg_icons_v3';
const ICON_TTL = 24 * 60 * 60 * 1000;

;(function loadPersistedIcons() {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_ICONS) || '{}');
    for (const [k, v] of Object.entries(stored)) {
      if (v.url) mem.set(k, v.url);
    }
  } catch {}
})();

function persistIcon(key, url) {
  // Never persist a miss — a null is almost always transient (rate limit, a
  // blocked load). Caching it would keep the icon from ever resolving on reload.
  if (!url) return;
  try {
    const stored = JSON.parse(localStorage.getItem(LS_ICONS) || '{}');
    stored[key] = { url, expires: Date.now() + ICON_TTL };
    const entries = Object.entries(stored);
    if (entries.length > 500) {
      const trimmed = Object.fromEntries(
        entries.sort((a, b) => b[1].expires - a[1].expires).slice(0, 500)
      );
      localStorage.setItem(LS_ICONS, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(LS_ICONS, JSON.stringify(stored));
    }
  } catch {}
}

function ck(chainId, address) {
  return `${chainId}:${address ? address.toLowerCase() : 'native'}`;
}

// Populate mem cache from a registry map. Registry icons are authoritative, so a
// background refresh (stale cache) overwrites whatever we had — fixing icons that
// changed since the last session.
function populateFromRegistry(map) {
  for (const [key, v] of Object.entries(map)) {
    if (v.imageUrl && mem.get(key) !== v.imageUrl) {
      mem.set(key, v.imageUrl);
      persistIcon(key, v.imageUrl);
    }
  }
}

// Initial load, plus every background refresh of a stale registry cache.
getTokenRegistry().then(populateFromRegistry);
onRegistryUpdate(populateFromRegistry);

// Inflight deduplication for on-demand fetches
const inflight = new Map();

async function fetchOnDemand(chainId, address) {
  try {
    const res = await fetch(`/api/coinicon/${chainId}/${address.toLowerCase()}`);
    const d = await res.json();
    return d.url || null;
  } catch {
    return null;
  }
}

export async function getCoinIcon(chainId, address) {
  if (!address) return NATIVE_ICON;
  const key = ck(chainId, address);
  if (mem.has(key)) return mem.get(key);

  // Wait for registry to load — it may already have the icon
  await getTokenRegistry();
  if (mem.has(key)) return mem.get(key);

  // Token not in top-1000 by market cap — ask server to fetch it on demand
  if (inflight.has(key)) return inflight.get(key);
  const p = fetchOnDemand(chainId, address).then((url) => {
    mem.set(key, url);
    persistIcon(key, url);
    inflight.delete(key);
    return url;
  });
  inflight.set(key, p);
  return p;
}

export function useCoinIcon(chainId, address) {
  const key = ck(chainId, address);
  const [url, setUrl] = useState(() => (mem.has(key) ? mem.get(key) : undefined));

  useEffect(() => {
    if (mem.has(key)) { setUrl(mem.get(key)); return; }
    let cancelled = false;
    getCoinIcon(chainId, address).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return url; // undefined = loading, null = not found, string = url
}
