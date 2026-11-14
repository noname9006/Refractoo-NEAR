import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, etherscanLimit, etherscanBlocked, noteEtherscanRefusal } from '../src/utils/limit.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The Etherscan free tier answers "Max calls per sec rate limit reached (3/sec)"
// when more than 3 requests start within a second. The limiter must hold that
// however fast the individual requests return.
test('etherscanLimit never starts more than 3 requests per window', { timeout: 30_000 }, async () => {
  const starts = [];
  await Promise.all(Array.from({ length: 10 }, () => etherscanLimit(async () => { starts.push(Date.now()); })));
  assert.equal(starts.length, 10);
  starts.sort((a, b) => a - b);
  // Any 4 consecutive starts must span more than a second (the window is 1250 ms;
  // allow a few ms of timer slack).
  for (let i = 0; i + 3 < starts.length; i++) {
    const span = starts[i + 3] - starts[i];
    assert.ok(span >= 1200, `starts ${i}..${i + 3} span only ${span} ms`);
  }
});

// Slow responses must not stall the queue: pacing, not the in-flight cap, is
// what bounds the rate. (A cap of 2 made a 4 s response block everything.)
test('etherscanLimit keeps starting requests while earlier ones are in flight', { timeout: 30_000 }, async () => {
  await sleep(1300); // let the previous test's window drain
  let started = 0;
  const calls = Array.from({ length: 5 }, () => etherscanLimit(async () => { started += 1; await sleep(3000); }));
  await sleep(2700);
  assert.equal(started, 5, 'all 5 should have started before the first one finished');
  await Promise.all(calls);
});

test('etherscanLimit passes through results and rejections', { timeout: 30_000 }, async () => {
  assert.equal(await etherscanLimit(async () => 42), 42);
  await assert.rejects(etherscanLimit(async () => { throw new Error('boom'); }), /boom/);
  // A rejection must not jam the queue.
  assert.equal(await etherscanLimit(async () => 'after'), 'after');
});

// Refusals that cannot succeed later in the session block the chain, so the
// app stops spending paced slots (and console lines) on it every refresh.
test('permanent Etherscan refusals block the chain for the session', () => {
  const refusals = [
    [900001, 'Free API access is not supported for this chain. Please upgrade your api plan for full chain coverage.'],
    [900002, 'Missing or unsupported chainid parameter (required for v2 api), please see https://api.etherscan.io/v2/chainlist for the list of supported chainids'],
    [900003, 'Community Free API Limit reached. Resets 2026-11-15 00:00:00 UTC. For higher, uninterrupted limits, please upgrade to API Pro: https://etherscan.io/apis'],
  ];
  for (const [chainId, message] of refusals) {
    assert.equal(etherscanBlocked(chainId), false);
    assert.equal(noteEtherscanRefusal(chainId, `chain-${chainId}`, message), true, message);
    assert.equal(etherscanBlocked(chainId), true);
  }
});

test('transient Etherscan errors do not block the chain', () => {
  const transient = [
    'Max calls per sec rate limit reached (3/sec)',
    'NOTOK',
    'No records found',
    'Etherscan txlist HTTP 502',
    '',
    undefined,
  ];
  for (const message of transient) {
    assert.equal(noteEtherscanRefusal(900010, 'chain', message), false, String(message));
  }
  assert.equal(etherscanBlocked(900010), false);
});

test('a refusal is logged once per chain, not once per request', () => {
  const realInfo = console.info;
  const lines = [];
  console.info = (...a) => lines.push(a.join(' '));
  try {
    for (let i = 0; i < 5; i++) {
      noteEtherscanRefusal(900020, 'Optimism', 'Free API access is not supported for this chain. Please upgrade.');
    }
  } finally {
    console.info = realInfo;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Optimism/);
});

test('createLimiter caps concurrency and runs everything', async () => {
  const limit = createLimiter(2);
  let active = 0;
  let peak = 0;
  const results = await Promise.all(Array.from({ length: 7 }, (_, i) => limit(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await sleep(15);
    active -= 1;
    return i;
  })));
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(peak, 2);
});
