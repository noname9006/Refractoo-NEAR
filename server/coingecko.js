// Server-side CoinGecko token list fetcher and cache.
// Runs once at startup and refreshes every 24h.
// Clients hit /api/tokenlist instead of CoinGecko directly, avoiding rate limits.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dir, 'cache');
const LIST_FILE = join(CACHE_DIR, 'tokenlist.json');
const CACHE_TTL = 24 * 60 * 60 * 1000;

// CoinGecko platform names for our supported chains
// CELO's ERC-20 twin of the native coin: probing it would double-count the native balance.
const SKIP = new Set(['42220:0x471ece3750da237f93b8e339c536989b8978a438']);
const PLATFORM_CHAIN = {
  'ethereum': 1,
  'arbitrum-one': 42161,
  'optimistic-ethereum': 10,
  'base': 8453,
  'polygon-pos': 137,
  'binance-smart-chain': 56,
  'mantle': 5000,
  'manta-pacific': 169,
  'avalanche': 43114,
  'xdai': 100,
  'zksync': 324,
  'scroll': 534352,
  'celo': 42220,
};
const SUPPORTED = new Set(Object.keys(PLATFORM_CHAIN));
const CHAINS_KEY = Object.values(PLATFORM_CHAIN).sort((x, y) => x - y).join(',');

const CG = 'https://api.coingecko.com/api/v3';
const API_KEY = process.env.COINGECKO_API_KEY || '';

function cgHeaders() {
  if (!API_KEY) return {};
  // Pro keys begin with "CG-", demo keys are shorter UUIDs
  const hdr = API_KEY.startsWith('CG-') ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key';
  return { [hdr]: API_KEY };
}

async function cgGet(path) {
  const res = await fetch(`${CG}${path}`, { headers: cgHeaders() });
  if (res.status === 429) throw new Error('CoinGecko rate limit hit');
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status} at ${path}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchCoinList() {
  return cgGet('/coins/list?include_platform=true');
  // [{id, symbol, name, platforms: {platformName: contractAddress}}]
}

async function fetchTopMarkets(pages = 8) {
  // Returns image URLs for the top 250*pages coins by market cap.
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const data = await cgGet(
      `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${p}&sparkline=false`
    );
    out.push(...data);
    if (p < pages) await sleep(1300); // stay comfortably within free-tier 10–30 req/min
  }
  return out; // [{id, image, symbol, name, ...}]
}

function buildMap(coinList, markets) {
  const imageById = new Map(markets.map((c) => [c.id, c.image || null]));
  // market_cap_rank lets the client tier its balance probing: ranked tokens are
  // the liquid ones a wallet is likely to actually hold, probed first.
  const rankById = new Map(markets.map((c) => [c.id, c.market_cap_rank ?? null]));
  const map = {}; // "chainId:address(lowercase)" → {symbol, name, cgId, imageUrl, rank}
  for (const coin of coinList) {
    const imageUrl = imageById.get(coin.id) || null;
    const rank = rankById.get(coin.id) ?? null;
    for (const [platform, address] of Object.entries(coin.platforms || {})) {
      if (!SUPPORTED.has(platform) || !address) continue;
      const chainId = PLATFORM_CHAIN[platform];
      if (SKIP.has(`${chainId}:${address.toLowerCase()}`)) continue;
      map[`${chainId}:${address.toLowerCase()}`] = {
        symbol: (coin.symbol || '?').toUpperCase(),
        name: coin.name || coin.symbol || 'Unknown',
        cgId: coin.id,
        imageUrl,
        rank,
      };
    }
  }
  return map;
}

// ---------- state ----------
let _map = null;
let _mapAt = 0;
let _refreshing = false;

function tryLoadCache() {
  try {
    if (!existsSync(LIST_FILE)) return false;
    const raw = JSON.parse(readFileSync(LIST_FILE, 'utf8'));
    // A cache built for a different chain set would hide the new chains' tokens.
    if (raw.chains !== CHAINS_KEY) return false;
    if (Date.now() - raw.updated < CACHE_TTL) {
      _map = raw.map;
      _mapAt = raw.updated;
      const age = Math.round((Date.now() - raw.updated) / 60000);
      console.log(`[cg] Loaded ${Object.keys(_map).length} tokens from cache (${age}min old)`);
      return true;
    }
  } catch {}
  return false;
}

async function refresh() {
  if (_refreshing) return;
  _refreshing = true;
  try {
    console.log('[cg] Fetching token list from CoinGecko...');
    // Coin list and first market page start together; subsequent market pages are sequential.
    const [coinList, markets] = await Promise.all([
      fetchCoinList(),
      fetchTopMarkets(4),
    ]);
    const map = buildMap(coinList, markets);
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(LIST_FILE, JSON.stringify({ updated: Date.now(), chains: CHAINS_KEY, map }));
    _map = map;
    _mapAt = Date.now();
    console.log(`[cg] Token list cached — ${Object.keys(map).length} entries across ${SUPPORTED.size} chains`);
  } catch (err) {
    console.error('[cg] Refresh failed:', err.message);
  } finally {
    _refreshing = false;
  }
}

// ---------- on-demand icon batch (for tokens outside the pre-loaded market pages) ----------
// Requests that arrive within 200 ms are collected and fired as one
// /coins/markets?ids=… call (up to 250 IDs per batch) instead of one
// /coins/{id} call per token. This turns a 20-token × 1.3 s serial queue
// into a single ~300 ms round-trip.
const _iconMem = new Map();
const _iconBatch = new Map(); // cgId → [resolve, ...]
let _iconTimer = null;

async function flushIconBatch() {
  _iconTimer = null;
  if (!_iconBatch.size) return;
  const entries = [..._iconBatch.entries()];
  _iconBatch.clear();

  const BATCH = 250;
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH);
    const ids = chunk.map(([id]) => id).join(',');
    try {
      const markets = await cgGet(
        `/coins/markets?vs_currency=usd&ids=${ids}&per_page=${BATCH}&sparkline=false`
      );
      const byId = new Map(markets.map((m) => [m.id, m.image || null]));
      for (const [cgId, resolvers] of chunk) {
        const url = byId.get(cgId) || null;
        _iconMem.set(cgId, url);
        if (_map) {
          for (const v of Object.values(_map)) {
            if (v.cgId === cgId && !v.imageUrl) v.imageUrl = url;
          }
        }
        for (const r of resolvers) r(url);
      }
    } catch {
      for (const [cgId, resolvers] of chunk) {
        _iconMem.set(cgId, null);
        for (const r of resolvers) r(null);
      }
    }
    if (i + BATCH < entries.length) await sleep(1300);
  }
}

function fetchIconForId(cgId) {
  if (_iconMem.has(cgId)) return Promise.resolve(_iconMem.get(cgId));
  return new Promise((resolve) => {
    if (!_iconBatch.has(cgId)) _iconBatch.set(cgId, []);
    _iconBatch.get(cgId).push(resolve);
    clearTimeout(_iconTimer);
    _iconTimer = setTimeout(flushIconBatch, 200);
  });
}

// ---------- public API ----------

export async function getTokenMap() {
  if (_map && Date.now() - _mapAt < CACHE_TTL) return _map;
  if (!_map) {
    if (!tryLoadCache()) await refresh();
  } else {
    refresh(); // stale — serve current data, refresh in background
  }
  return _map || {};
}

// Per-chain slice of the token map, for clients that only need one chain.
// Keys are kept in full "chainId:address" form so callers can merge shards
// straight into the same flat map shape getTokenMap() returns.
export async function getTokenMapForChain(chainId) {
  const map = await getTokenMap();
  const prefix = `${chainId}:`;
  const out = {};
  for (const key in map) if (key.startsWith(prefix)) out[key] = map[key];
  return out;
}

export async function getIconUrl(chainId, address) {
  const map = await getTokenMap();
  const entry = map[`${chainId}:${address.toLowerCase()}`];
  if (!entry) return null;
  if (entry.imageUrl) return entry.imageUrl;
  return fetchIconForId(entry.cgId);
}

// Kick off on module load
if (!tryLoadCache()) refresh();
// unref(): the refresh timer must not keep the process alive on its own.
// vite.config.js imports this module via the token-server plugin, so without
// unref() `vite build` finishes bundling but never exits. The API server
// (server/index.js) stays alive through its HTTP listener instead.
setInterval(refresh, CACHE_TTL).unref();
