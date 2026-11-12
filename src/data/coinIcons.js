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

// NEAR rows: native gets the NEAR logo; FTs / staking pools fall back to the
// letter glyph (the icon server and registry only know EVM contracts).
const NEAR_ICON = 'https://assets.coingecko.com/coins/images/10365/small/near.jpg';

export async function getCoinIcon(chainId, address) {
  if (chainId === '__none') return null;
  if (chainId === 'near') return address ? null : NEAR_ICON;
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

// Icon by SYMBOL — for NEAR Intents assets, which carry no EVM contract we can
// key on. Uses the same CoinGecko registry (best-ranked match per symbol), plus
// native coins that have no contract entry in the registry.
const NATIVE_SYMBOL_ICONS = {
  NEAR: NEAR_ICON, WNEAR: NEAR_ICON,
  BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  ETH: NATIVE_ICON,
  SOL: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  ZEC: 'https://assets.coingecko.com/coins/images/486/small/circle-zcash-color.png',
  XRP: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  DOGE: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  TRX: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png',
  TON: 'https://assets.coingecko.com/coins/images/17980/small/ton_symbol.png',
  LTC: 'https://assets.coingecko.com/coins/images/2/small/litecoin.png',
};
let bySymbol = null;
function symbolIndex(map) {
  const idx = new Map();
  for (const v of Object.values(map || {})) {
    if (!v?.imageUrl || !v.symbol) continue;
    const k = String(v.symbol).toUpperCase();
    const cur = idx.get(k);
    if (!cur || (v.rank ?? 1e9) < (cur.rank ?? 1e9)) idx.set(k, v);
  }
  return idx;
}
onRegistryUpdate((m) => { bySymbol = symbolIndex(m); });

export async function getSymbolIcon(symbol) {
  const k = String(symbol || '').toUpperCase();
  if (!k) return null;
  if (NATIVE_SYMBOL_ICONS[k]) return NATIVE_SYMBOL_ICONS[k];
  if (!bySymbol) bySymbol = symbolIndex(await getTokenRegistry());
  return bySymbol.get(k)?.imageUrl || null;
}

export function useSymbolIcon(symbol) {
  const k = String(symbol || '').toUpperCase();
  const [url, setUrl] = useState(() => NATIVE_SYMBOL_ICONS[k] || bySymbol?.get(k)?.imageUrl);
  useEffect(() => {
    let cancelled = false;
    getSymbolIcon(k).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [k]);
  return url;
}

// Display name for a symbol from the same registry (sync; null until it loads).
const NATIVE_NAMES = { NEAR: 'NEAR', WNEAR: 'Wrapped NEAR', BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', ZEC: 'Zcash' };
export function symbolName(symbol) {
  const k = String(symbol || '').toUpperCase();
  return NATIVE_NAMES[k] || bySymbol?.get(k)?.name || symbol;
}
getTokenRegistry().then((m) => { if (!bySymbol) bySymbol = symbolIndex(m); });
