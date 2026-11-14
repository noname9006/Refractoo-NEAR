import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpcView, NEAR_RPC, NEAR_RPC_FALLBACK } from '../src/near/rpc.js';
import { priceNearAccount, loadNearAccount } from '../src/near/nearAccount.js';
import { fetchIntentsSalt } from '../src/near/nep413.js';

// Fake NEAR RPC helpers. A `view` response carries the JSON-encoded value as bytes,
// the way the real call_function result does.
const encode = (v) => [...new TextEncoder().encode(JSON.stringify(v))];
const ok = (value) => ({ status: 200, json: async () => ({ result: { result: encode(value) } }) });
const throttled = (retryAfterSeconds) => ({
  status: 429,
  headers: new Headers(retryAfterSeconds == null ? {} : { 'retry-after': String(retryAfterSeconds) }),
  json: async () => ({}),
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs first: it leaves no gate pause behind for the tests after it.
test('a throttled FastNEAR request falls over to the official RPC without waiting', { timeout: 20_000 }, async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return url === NEAR_RPC ? throttled(null) : ok('from-fallback');
  };
  const t = Date.now();
  const value = await rpcView(fetchImpl, 'fallback-probe.near', 'get');
  assert.equal(value, 'from-fallback');
  assert.deepEqual(urls, [NEAR_RPC, NEAR_RPC_FALLBACK]);
  assert.ok(Date.now() - t < 900, `took ${Date.now() - t} ms; a backoff pause would take ~1 s`);
});

test('when both endpoints are throttled, every queued request waits out the pause', { timeout: 20_000 }, async () => {
  // The first 6 calls are 429: that is both endpoints for each of the 3 requests,
  // so every first round fails whatever order the gate lets them through in.
  const calls = [];
  const okStarts = [];
  const fetchImpl = async () => {
    const t = Date.now();
    calls.push(t);
    if (calls.length <= 6) return throttled(1);
    okStarts.push(t);
    return ok('done');
  };
  const results = await Promise.all([1, 2, 3].map(() => rpcView(fetchImpl, 'pause-probe.near', 'get')));
  assert.deepEqual(results, ['done', 'done', 'done']);
  assert.ok(calls.length > 2, 'the throttled round was retried');
  // A successful call only starts after the 1 s Retry-After pause (small slack for timers).
  for (const s of okStarts) assert.ok(s - calls[0] >= 950, `started ${s - calls[0]} ms after the first call`);
});

test('request starts are spaced apart and at most 3 are open at once', { timeout: 20_000 }, async () => {
  const starts = [];
  let open = 0;
  let maxOpen = 0;
  const fetchImpl = async () => {
    starts.push(Date.now());
    open++;
    maxOpen = Math.max(maxOpen, open);
    await sleep(30);
    open--;
    return ok(1);
  };
  await Promise.all(Array.from({ length: 6 }, () => rpcView(fetchImpl, 'gap-probe.near', 'get')));
  assert.ok(maxOpen <= 3, `maxOpen was ${maxOpen}`);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 95, `gap ${starts[i] - starts[i - 1]} ms`);
});

test('ft_metadata is read once per contract, not once per account', async () => {
  let metaCalls = 0;
  const fetchImpl = async (_url, init) => {
    const { params } = JSON.parse(init.body);
    if (params.method_name === 'ft_metadata' && params.account_id === 'memo-probe.near') {
      metaCalls++;
      return ok({ decimals: 6, symbol: 'MP', name: 'Memo probe' });
    }
    return { status: 200, json: async () => ({ error: { cause: { name: 'NO_CONTRACT' } } }) };
  };
  const raw = (accountId) => ({
    accountId, exists: true, nativeYocto: '0', pools: [], intents: { tokens: [] },
    tokens: [{ contract: 'memo-probe.near', raw: '5000000' }],
  });
  const noPrices = async () => new Map();
  const a = await priceNearAccount(raw('one.near'), { fetchImpl, fetchPricesImpl: noPrices });
  const b = await priceNearAccount(raw('two.near'), { fetchImpl, fetchPricesImpl: noPrices });
  assert.equal(metaCalls, 1);
  assert.equal(a.holdings[0].amount, 5);
  assert.equal(b.holdings[0].amount, 5);
});

test('fetchIntentsSalt goes through the gate: a throttled call falls over and the salt is decoded', { timeout: 20_000 }, async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return url === NEAR_RPC ? throttled(null) : ok('0a1b2c3d');
  };
  const salt = await fetchIntentsSalt({ fetchImpl });
  assert.deepEqual([...salt], [0x0a, 0x1b, 0x2c, 0x3d]);
  assert.deepEqual(urls, [NEAR_RPC, NEAR_RPC_FALLBACK]);
});

// --- FastNEAR account index (api.fastnear.com/.../full) ---
const viewAccount = { status: 200, json: async () => ({ result: { amount: '3000000000000000000000000', locked: '0' } }) };
const noContract = { status: 200, json: async () => ({ error: { cause: { name: 'NO_CONTRACT' } } }) };
const rpcStub = (init) => (JSON.parse(init.body).params.request_type === 'view_account' ? viewAccount : noContract);

test('account index: a 429 is retried and the full account is returned', { timeout: 30_000 }, async () => {
  let indexCalls = 0;
  const fetchImpl = async (url, init) => {
    if (!String(url).includes('api.fastnear.com')) return rpcStub(init);
    indexCalls++;
    if (indexCalls === 1) return { ok: false, status: 429 };
    return { ok: true, status: 200, json: async () => ({ state: { balance: '2000000000000000000000000', locked: '0' }, tokens: [], pools: [] }) };
  };
  const out = await loadNearAccount('retry-probe.near', { fetchImpl, fetchPricesImpl: async () => new Map() });
  assert.equal(indexCalls, 2);
  assert.equal(out.partial, undefined);
  assert.equal(out.holdings.find((h) => h.address === null).amount, 2);
});

test('account index: still throttled after retries gives a partial RPC-only read, not an error', { timeout: 30_000 }, async () => {
  let indexCalls = 0;
  const fetchImpl = async (url, init) => {
    if (!String(url).includes('api.fastnear.com')) return rpcStub(init);
    indexCalls++;
    return { ok: false, status: 429 };
  };
  const out = await loadNearAccount('partial-probe.near', { fetchImpl, fetchPricesImpl: async () => new Map() });
  assert.equal(indexCalls, 3, 'first try plus two retries');
  assert.equal(out.exists, true);
  assert.equal(out.partial, true);
  assert.equal(out.holdings.find((h) => h.address === null).amount, 3, 'NEAR balance read over RPC');
  assert.ok(out.defiErrors.some((e) => /FastNEAR index/.test(e)));
});
