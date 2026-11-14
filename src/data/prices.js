// USD price feed via DefiLlama (no API key, no account).

import { llamaKey, nativeFor } from './tokens.js';

const LLAMA = 'https://coins.llama.fi';

async function llamaGet(path) {
  const res = await fetch(`${LLAMA}${path}`);
  if (!res.ok) throw new Error(`DefiLlama HTTP ${res.status}`);
  return res.json();
}

// Build the price keys for a set of holdings. holdings: [{chainId, address}]
// (address omitted ⇒ native ETH). Returns { keys, keyOf } where keyOf(h) maps a
// holding back to its price key.
export function holdingKeys(holdings) {
  // Native tokens are chain-specific: ETH on most chains, but POL on Polygon —
  // a wildly different price. Use the per-chain native key so the chart values
  // each native balance with its real price (not always ETH's).
  //
  // keyOf can be null for a token the active network profile can't price (a
  // testnet token with no declared mainnet twin); those keys are dropped so no
  // request is ever built around a "null" key.
  // NEAR rows: native and per-pool staking rows (address "pool:…") are priced as
  // NEAR; nativeFor('near') would wrongly fall back to ETH's key.
  const keyOf = (h) => {
    if (h.chainId === 'near' && (!h.address || String(h.address).startsWith('pool:'))) return 'coingecko:near';
    return h.address ? llamaKey(h.chainId, h.address) : nativeFor(h.chainId).key;
  };
  const keys = [...new Set(holdings.map(keyOf))].filter(Boolean);
  return { keys, keyOf };
}

// Fetch current USD prices + 24h change for the given price keys.
// Returns a Map: key → { price, change24h, symbol }.
//
// Keys are CHUNKED: a portfolio that probes the whole token registry can have
// hundreds of holdings, and cramming them all into one URL exceeds DefiLlama's
// request limit (the whole batch then fails and NOTHING gets priced — every row
// shows "—"). Each chunk is fetched in parallel.
const PRICE_CHUNK = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run async tasks with at most `limit` in flight at once. A portfolio that
// probes the whole token registry can produce a dozen+ /percentage chunks;
// firing them all via Promise.all bursts DefiLlama hard enough that it starts
// 500ing chunks that work fine in isolation — and bisection below then makes
// the burst worse, not better. Capping concurrency keeps total in-flight
// requests bounded regardless of portfolio size.
async function runLimited(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// One /percentage request at exactly this batch size — no retry, no
// bisection. true + merged into `changes` on success, false on failure.
async function probePercentage(batch, changes) {
  try {
    const data = await llamaGet(`/percentage/${encodeURIComponent(batch.join(','))}?period=1d`);
    Object.assign(changes, data?.coins || {});
    return true;
  } catch {
    return false;
  }
}

// Fetch 24h % change for a batch of keys into `changes`. Some tokens (e.g.
// extremely low-priced/illiquid ones) make DefiLlama's /percentage endpoint
// 500 — which also strips CORS headers, so the browser reports it as a CORS
// error even though it's a server-side bug.
//
// A failure can mean either "a couple of bad tokens in this batch" (worth
// bisecting to isolate them) or "the endpoint itself is unhealthy right now"
// (bisecting further just multiplies useless requests against a backend
// that's already struggling). To tell them apart cheaply: after the whole
// batch fails its retry, probe both halves once each. If only one half
// fails, the bad token(s) are isolated there — recurse into just that half.
// If BOTH halves fail outright, it's a systemic outage: drop the whole
// remaining batch in one shot instead of cascading down to single-key
// requests, which previously turned one bad batch into ~4x its size in
// sequential requests.
async function fetchPercentages(batch, changes, skipFirstTry = false) {
  if (!batch.length) return true;
  if (!skipFirstTry && (await probePercentage(batch, changes))) return true;
  await sleep(500);
  if (await probePercentage(batch, changes)) return true;

  if (batch.length === 1) {
    console.warn('[percentage] dropping key', batch[0]);
    return false;
  }

  const mid = Math.ceil(batch.length / 2);
  const first = batch.slice(0, mid);
  const second = batch.slice(mid);

  const [firstOk, secondOk] = await Promise.all([
    probePercentage(first, changes),
    probePercentage(second, changes),
  ]);

  if (!firstOk && !secondOk) {
    console.warn('[percentage] dropping', batch.length, 'keys — endpoint looks unhealthy');
    return false;
  }
  // Independent branches — run concurrently. A half that itself cascades
  // 2-3 bisection levels deep (each with a 500ms retry sleep) used to block
  // its sibling from even starting, turning one slow recovery into the sum
  // of both instead of the max.
  await Promise.all([
    !firstOk ? fetchPercentages(first, changes, true) : null,
    !secondOk ? fetchPercentages(second, changes, true) : null,
  ]);
  return true;
}

const PRICE_CONCURRENCY = 3;

export async function fetchPrices(keys) {
  const out = new Map();
  if (!keys.length) return out;

  const chunks = [];
  for (let i = 0; i < keys.length; i += PRICE_CHUNK) chunks.push(keys.slice(i, i + PRICE_CHUNK));

  await runLimited(chunks.map((chunkKeys) => async () => {
    const list = chunkKeys.join(',');
    const changes = {};
    const [cur] = await Promise.allSettled([
      llamaGet(`/prices/current/${encodeURIComponent(list)}`),
      fetchPercentages(chunkKeys, changes),
    ]);
    const coins = cur.status === 'fulfilled' ? cur.value?.coins || {} : {};
    for (const key of chunkKeys) {
      const c = coins[key];
      if (!c || typeof c.price !== 'number') continue;
      out.set(key, {
        price: c.price, change24h: changes[key] ?? null, symbol: c.symbol || null,
        decimals: Number.isInteger(c.decimals) ? c.decimals : null, // NEAR FTs need this
      });
    }
  }), PRICE_CONCURRENCY);
  return out;
}

// Historical USD prices for activity rows: the price of each token at the moment
// its transaction happened. items: [{ key, ts }] where `key` is a llama price key
// and `ts` is UNIX SECONDS. Returns Map("key@ts" → price); missing entries simply absent.
export async function fetchHistoricalPrices(items) {
  const out = new Map();
  if (!items?.length) return out;

  // Group requested timestamps per key.
  const byKey = new Map();
  for (const { key, ts } of items) {
    if (!key || !ts) continue;
    const t = Math.round(ts);
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(t);
  }
  if (!byKey.size) return out;

  const coins = {};
  for (const [key, tsSet] of byKey) coins[key] = [...tsSet];

  let data;
  try {
    data = await llamaGet(`/batchHistorical?coins=${encodeURIComponent(JSON.stringify(coins))}&searchWidth=600`);
  } catch {
    return out;
  }
  const got = data?.coins || {};
  for (const [key, tsSet] of byKey) {
    const series = got[key]?.prices || [];
    if (!series.length) continue;
    for (const ts of tsSet) {
      let best = null, bestD = Infinity;
      for (const p of series) { const d = Math.abs(p.timestamp - ts); if (d < bestD) { bestD = d; best = p.price; } }
      if (best != null) out.set(`${key}@${ts}`, best);
    }
  }
  return out;
}

// Portfolio value history for the sparkline. Fetches a price chart per holding
// (decoy-padded) and sums balance·price(t) across holdings into one series.
// range: '24H' | '7D' | '30D' | '90D'. Returns [{ t, value }] or [] on failure.
//
// searchWidth controls how far (in seconds) DefiLlama searches around each
// candle timestamp for price data. 600 s (10 min) is fine for liquid tokens
// updated every few minutes, but tokens with sparse history (once or twice a
// day at irregular times) need a much wider window — otherwise every daily
// candle misses the data and the chart flatlines. Using half the candle period
// as the search window guarantees a hit as long as the token has ≥1 update/day.
const RANGE = {
  // Dense grids (15m / 2h) give DeBank-like jagged detail; verified against the
  // live /chart endpoint (returns exactly `span` points for these periods).
  '24H': { span: 97, period: '15m', searchWidth: 600  },
  '7D':  { span: 84, period: '2h', searchWidth: 3600 },
  '30D': { span: 120, period: '6h', searchWidth: 10800 },
  // '1d' (not '2d') — DefiLlama's /chart endpoint only reliably parses standard
  // single-unit periods; multi-day periods returned empty, which is what broke
  // the 90D (and made 30D inconsistent) curves.
  '90D': { span: 90, period: '1d', searchWidth: 43200 },
};

// /chart refuses any request whose keys × span exceeds 500 data points
// ("Requested 504 data points exceeds the maximum of 500"). Keys per request
// therefore depend on the range's span: 5 at 7D (span 84), 4 at 30D (span 120).
const CHART_MAX_POINTS = 500;

// Reconstruct the portfolio-value time series from whatever priceAt holds so
// far. Used both for the final result and for mid-fetch partial updates.
function buildPortfolioSeries(priceAt, valued, keyOf) {
  if (!priceAt.size) return [];

  // Time grid: the densest key's candle timestamps. These are evenly spaced
  // (one cadence per range), which keeps the summed curve smooth — a union of
  // every key's timestamps would be irregularly spaced and make the line jagged.
  let grid = [];
  for (const m of priceAt.values()) if (m.size > grid.length) grid = [...m.keys()].sort((a, b) => a - b);
  if (grid.length < 2) return [];

  // Clip the grid to where every SIGNIFICANT holding has real history. A holding
  // younger than the range only has data for its recent candles; before that,
  // nearest() below back-fills its single oldest price — a constant — which
  // flattens the left part of the summed curve into a bogus straight line. So we
  // start the grid no earlier than the latest "first data point" among holdings
  // that matter. Dust holdings (<1% of the live total) are excluded from this
  // constraint so a tiny young token can't collapse 90D down to a few days; they
  // still get the oldest-price back-fill, which is negligible at their weight.
  const liveTotal = valued.reduce((s, h) => s + h.amount * (h.price || 0), 0);
  let clipStart = grid[0];
  for (const h of valued) {
    const m = priceAt.get(keyOf(h));
    if (!m || !m.size) continue; // no history (e.g. native/coingecko key) — can't constrain
    const share = liveTotal > 0 ? (h.amount * (h.price || 0)) / liveTotal : 0;
    if (share < 0.01) continue;
    let first = Infinity;
    for (const k of m.keys()) if (k < first) first = k;
    if (first > clipStart) clipStart = first;
  }
  if (clipStart > grid[0]) {
    const clipped = grid.filter((ts) => ts >= clipStart);
    if (clipped.length >= 2) grid = clipped;
  }

  const nearest = (m, ts) => {
    if (m.has(ts)) return m.get(ts);
    let best = null, bestD = Infinity;
    for (const [k, v] of m) { const d = Math.abs(k - ts); if (d < bestD) { bestD = d; best = v; } }
    return best;
  };

  const series = grid.map((ts) => {
    let value = 0;
    for (const h of valued) {
      const m = priceAt.get(keyOf(h));
      const px = m ? nearest(m, ts) : null;
      // Fall back to the holding's current price when the feed skipped its
      // history, so the holding still contributes its value instead of being
      // silently dropped (which made the chart jump between reloads).
      value += h.amount * (px != null ? px : (h.price || 0));
    }
    return { t: ts, value };
  });

  // Anchor the final point to the LIVE portfolio total. Longer ranges use wide
  // candles (e.g. 12h/2d), so their last candle can be hours stale and disagree
  // with 24H's near-live edge — pinning the right edge keeps every range ending
  // at the same current value. (liveTotal computed above for the clip weights.)
  if (liveTotal > 0) series[series.length - 1] = { ...series[series.length - 1], value: liveTotal };

  return series;
}

export async function fetchPortfolioHistory(holdings, range = '7D') {
  const valued = holdings.filter((h) => h.amount > 0);
  if (!valued.length) return [];
  const { keys, keyOf } = holdingKeys(valued);
  const { span, period, searchWidth } = RANGE[range] || RANGE['7D'];

  // Build per-key timestamp→price across chunks fetched in parallel. Native
  // tokens use coingecko: keys, which /chart accepts (verified live). A bad key
  // in a batch is isolated by the bisection in fetchKeys, and any holding left
  // without history still falls back to h.price. Excluding them made a
  // native-only selection (e.g. NEAR alone) produce no chart at all.
  const chartKeys = keys;
  const priceAt = new Map();

  // Fetch a set of keys, recording each key's price history into priceAt. A
  // single token with too-short history makes DefiLlama 400 the WHOLE batch — so
  // on failure we split the batch and retry the halves, isolating the bad key
  // (dropped only once it fails alone). This is why long ranges (30D/90D), which
  // are likeliest to outrun a young token's history, were returning nothing.
  const fetchKeys = async (batch) => {
    if (!batch.length) return;
    let data;
    try {
      data = await llamaGet(
        `/chart/${encodeURIComponent(batch.join(','))}?span=${span}&period=${period}&searchWidth=${searchWidth}`
      );
    } catch (e) {
      if (batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        await Promise.all([fetchKeys(batch.slice(0, mid)), fetchKeys(batch.slice(mid))]);
      } else {
        console.warn('[chart] dropping key with no usable history', range, batch[0], e?.message || e);
      }
      return;
    }
    const coins = data?.coins || {};
    for (const key of batch) {
      const series = coins[key]?.prices || [];
      const m = new Map(series.map((p) => [p.timestamp, p.price]));
      if (m.size) priceAt.set(key, m);
    }
  };

  const perRequest = Math.max(1, Math.floor(CHART_MAX_POINTS / span));
  const chunks = [];
  for (let i = 0; i < chartKeys.length; i += perRequest) chunks.push(chartKeys.slice(i, i + perRequest));
  await runLimited(chunks.map((batch) => () => fetchKeys(batch)), PRICE_CONCURRENCY);

  return buildPortfolioSeries(priceAt, valued, keyOf);
}
