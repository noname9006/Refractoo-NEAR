import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPortfolioHistory } from '../src/data/prices.js';

// DefiLlama /chart refuses requests with more than 500 data points (keys × span):
// "Requested 504 data points exceeds the maximum of 500". Batches must stay under it.
test('/chart requests stay within 500 data points for every range', { timeout: 60_000 }, async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    const keys = decodeURIComponent(u.pathname.slice('/chart/'.length)).split(',');
    const span = Number(u.searchParams.get('span'));
    const tooBig = keys.length * span > 500;
    seen.push({ n: keys.length, span, status: tooBig ? 400 : 200 });
    if (tooBig) return new Response('{"message":"too many points"}', { status: 400 });
    const coins = Object.fromEntries(keys.map((k) => [k, { prices: [{ timestamp: 1_700_000_000, price: 2 }] }]));
    return new Response(JSON.stringify({ coins }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const holdings = Array.from({ length: 23 }, (_, i) => ({
      chainId: '1', address: `0x${(i + 1).toString(16).padStart(40, '0')}`, amount: 1, price: 1,
    }));
    for (const range of ['24H', '7D', '30D', '90D']) await fetchPortfolioHistory(holdings, range);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(seen.length > 0, 'chart requests were made');
  const refused = seen.filter((r) => r.status === 400);
  assert.deepEqual(refused, [], `refused requests: ${JSON.stringify(refused)}`);
});
