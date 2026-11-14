import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAddress } from 'ethers';
import { readMorpho, readUniswapV3, uniV3Amounts, fetchEthDefiPositions } from '../src/data/ethDefi.js';
import * as REG from '../src/data/ethDefiRegistry.js';
import { llamaKey } from '../src/data/tokens.js';

const OWNER = '0x000000000000000000000000000000000000dEaD';
const M0 = REG.MORPHO_MARKETS[0]; // cbBTC / USDC, lltv 0.86
const key = (a) => llamaKey(1, a);
const prices = (obj) => async () => new Map(Object.entries(obj).map(([a, price]) => [key(a), { price }]));

// Fake multicall: handlers keyed by fn name get the call and return a Result-like value (or null).
const fakeExec = (handlers) => async (calls) => calls.map((c) => handlers[c.fn]?.(c) ?? null);

test('registry: every address is a valid checksummed address, ids are bytes32', () => {
  const addrs = [REG.SPARK_POOL, REG.MORPHO_BLUE, REG.UNI_V3_NPM, REG.UNI_V3_FACTORY,
    ...REG.MORPHO_MARKETS.flatMap((m) => [m.loan.address, m.coll.address, m.oracle]),
    ...REG.MORPHO_VAULTS.flatMap((v) => [v.address, v.asset.address])];
  for (const a of addrs) assert.equal(getAddress(a), a, `not checksummed: ${a}`);
  for (const m of REG.MORPHO_MARKETS) assert.match(m.id, /^0x[0-9a-f]{64}$/);
  assert.equal(new Set(REG.MORPHO_MARKETS.map((m) => m.id)).size, REG.MORPHO_MARKETS.length);
});

test('Morpho: supplied/collateral/borrowed per market; health factor from oracle × LLTV', async () => {
  // 1 cbBTC collateral @ $100k, 40k USDC borrowed. Oracle price scale: 1e36 · 10^(loanDec − collDec).
  const exec = fakeExec({
    position: (c) => (c.args[0] === M0.id ? [0n, 4n * 10n ** 16n, 10n ** 8n] : [0n, 0n, 0n]),
    balanceOf: () => [0n],
    // 1e12 raw USDC borrowed in total across 1e18 shares → 1 share = 1e-6 raw (virtual 1e6 offset)
    market: () => [10n ** 13n, 10n ** 19n, 10n ** 12n, 10n ** 18n, 0n, 0n],
    price: () => [100_000n * 10n ** 34n],
  });
  const [p, ...rest] = await readMorpho(OWNER, { exec, getPrices: prices({ [M0.coll.address]: 100_000, [M0.loan.address]: 1 }) });
  assert.equal(rest.length, 0);
  assert.equal(p.protocol, 'Morpho');
  const borrowed = p.legs.find((l) => l.tone === 'bor');
  assert.ok(Math.abs(borrowed.amount - 40_000) < 1, `borrowed ${borrowed.amount}`);
  assert.ok(Math.abs(p.healthFactor - (100_000 * 0.86) / 40_000) < 0.01, `hf ${p.healthFactor}`); // ≈ 2.15
  assert.ok(Math.abs(p.usd - 60_000) < 1);
  assert.equal(p.unpricedLegs, 0);
});

test('Morpho: HF is still computed when a price is missing, but USD is null — not guessed', async () => {
  const exec = fakeExec({
    position: (c) => (c.args[0] === M0.id ? [0n, 4n * 10n ** 16n, 10n ** 8n] : [0n, 0n, 0n]),
    balanceOf: () => [0n],
    market: () => [10n ** 13n, 10n ** 19n, 10n ** 12n, 10n ** 18n, 0n, 0n],
    price: () => [100_000n * 10n ** 34n],
  });
  const [p] = await readMorpho(OWNER, { exec, getPrices: prices({ [M0.loan.address]: 1 }) }); // cbBTC unpriced
  assert.equal(p.usd, null);
  assert.ok(p.healthFactor > 2);
  assert.equal(p.unpricedLegs, 1);
});

test('Morpho vault: shares convert to assets and are priced via the vault asset', async () => {
  const v = REG.MORPHO_VAULTS[0];
  const exec = fakeExec({
    position: () => [0n, 0n, 0n],
    balanceOf: (c) => (c.to === v.address ? [123n * 10n ** 18n] : [0n]),
    convertToAssets: () => [5_000n * 10n ** 6n],
  });
  const out = await readMorpho(OWNER, { exec, getPrices: prices({ [v.asset.address]: 1 }) });
  assert.equal(out.length, 1);
  assert.equal(out[0].usd, 5000);
  assert.match(out[0].sub, /Vault · Steakhouse USDC/);
});

test('Morpho: nothing held → no rows and no second round of reads', async () => {
  let rounds = 0;
  const exec = async (calls) => { rounds++; return calls.map(() => [0n, 0n, 0n]); };
  assert.deepEqual(await readMorpho(OWNER, { exec }), []);
  assert.equal(rounds, 1);
});

test('Uniswap v3 maths: single-sided outside the range, both sides inside, continuous at the edges', () => {
  const L = 10n ** 18n;
  const sp = (tick) => BigInt(Math.round(1.0001 ** (tick / 2) * 2 ** 96));
  const below = uniV3Amounts({ liquidity: L, sqrtPriceX96: sp(-500), tickLower: -100, tickUpper: 100 });
  assert.ok(below.raw0 > 0 && below.raw1 === 0 && !below.inRange);
  const above = uniV3Amounts({ liquidity: L, sqrtPriceX96: sp(500), tickLower: -100, tickUpper: 100 });
  assert.ok(above.raw1 > 0 && above.raw0 === 0 && !above.inRange);
  const mid = uniV3Amounts({ liquidity: L, sqrtPriceX96: sp(0), tickLower: -100, tickUpper: 100 });
  assert.ok(mid.raw0 > 0 && mid.raw1 > 0 && mid.inRange);
  // price a hair inside the lower edge ≈ the all-token0 amount
  const edge = uniV3Amounts({ liquidity: L, sqrtPriceX96: sp(-99), tickLower: -100, tickUpper: 100 });
  assert.ok(Math.abs(edge.raw0 - below.raw0) / below.raw0 < 0.01);
  // known value: L=1e18, ±100 ticks around price 1 → raw0 = L(1 − 1/1.0001^50) ≈ 4.987e15
  assert.ok(Math.abs(mid.raw0 - 1e18 * (1 - 1 / 1.0001 ** 50)) / 4.987e15 < 1e-3);
});

test('Uniswap v3: reads NFTs, skips empty ones, values both sides, flags out-of-range', async () => {
  const WETH = REG.MORPHO_VAULTS[0].asset.address; // any two real-looking addresses
  const USDC = REG.MORPHO_MARKETS[0].loan.address;
  const T0 = USDC, T1 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // USDC < WETH
  const pos = {
    1n: { token0: T0, token1: T1, fee: 500, tickLower: -200000, tickUpper: -190000, liquidity: 10n ** 15n },
    2n: { token0: T0, token1: T1, fee: 500, tickLower: -200000, tickUpper: -190000, liquidity: 0n }, // closed
  };
  const sqrtAt = (tick) => BigInt(Math.round(1.0001 ** (tick / 2) * 2 ** 96));
  const exec = fakeExec({
    balanceOf: () => [2n],
    tokenOfOwnerByIndex: (c) => [BigInt(c.args[1]) + 1n],
    positions: (c) => pos[c.args[0]],
    decimals: (c) => [c.to.toLowerCase() === T0.toLowerCase() ? 6 : 18],
    symbol: (c) => [c.to.toLowerCase() === T0.toLowerCase() ? 'USDC' : 'WETH'],
    getPool: () => ['0x00000000000000000000000000000000000000AA'],
    slot0: () => ({ sqrtPriceX96: sqrtAt(-195000) }), // inside the range
  });
  const out = await readUniswapV3(OWNER, { exec, getPrices: prices({ [T0]: 1, [T1]: 3000 }) });
  assert.equal(out.length, 1);
  const [u] = out;
  assert.equal(u.protocol, 'Uniswap v3');
  assert.equal(u.legs.length, 1); // the empty NFT is skipped
  assert.match(u.legs[0].label, /#1 USDC\/WETH 0\.05%/);
  assert.ok(u.legs[0].inRange);
  assert.ok(u.usd > 0 && Number.isFinite(u.usd));
  assert.equal(u.unpricedLegs, 0);

  // same NFT but price above the range → all token1 (WETH); only WETH needs a price
  const exec2 = fakeExec({
    balanceOf: () => [1n], tokenOfOwnerByIndex: () => [1n], positions: () => pos[1n],
    decimals: (c) => [c.to.toLowerCase() === T0.toLowerCase() ? 6 : 18],
    symbol: (c) => [c.to.toLowerCase() === T0.toLowerCase() ? 'USDC' : 'WETH'],
    getPool: () => ['0x00000000000000000000000000000000000000AA'],
    slot0: () => ({ sqrtPriceX96: sqrtAt(-150000) }),
  });
  const [u2] = await readUniswapV3(OWNER, { exec: exec2, getPrices: prices({ [T1]: 3000 }) });
  assert.match(u2.legs[0].text, /out of range/);
  assert.ok(!/USDC/.test(u2.legs[0].text.split('·')[0]));
  assert.ok(u2.usd > 0);
  void WETH;
});

test('Uniswap v3: an unpriced NFT is reported but not counted; the priced ones still total', async () => {
  const T0 = REG.MORPHO_MARKETS[0].loan.address; // priced
  const T1 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const OBSCURE = '0x1111111111111111111111111111111111111111'; // no price
  const sqrtAt = (tick) => BigInt(Math.round(1.0001 ** (tick / 2) * 2 ** 96));
  const pos = {
    1n: { token0: T0, token1: T1, fee: 3000, tickLower: -200000, tickUpper: -190000, liquidity: 10n ** 15n },
    2n: { token0: OBSCURE, token1: T1, fee: 3000, tickLower: -200000, tickUpper: -190000, liquidity: 10n ** 15n },
  };
  const exec = fakeExec({
    balanceOf: () => [2n], tokenOfOwnerByIndex: (c) => [BigInt(c.args[1]) + 1n], positions: (c) => pos[c.args[0]],
    decimals: () => [18], symbol: (c) => [c.to.toLowerCase() === OBSCURE ? 'OBS' : 'T'],
    getPool: () => ['0x00000000000000000000000000000000000000AA'], slot0: () => ({ sqrtPriceX96: sqrtAt(-195000) }),
  });
  const [u] = await readUniswapV3(OWNER, { exec, getPrices: prices({ [T0]: 1, [T1]: 3000 }) });
  assert.equal(u.legs.length, 2);
  assert.equal(u.unpricedLegs, 1);
  assert.equal(u.usd, u.legs.find((l) => l.usd != null).usd); // only the priced NFT
  assert.match(u.sub, /1 unpriced, not counted/);
});

test('Uniswap v3: wallet with no NFTs costs a single read and yields nothing', async () => {
  let rounds = 0;
  const exec = async (calls) => { rounds++; return calls.map(() => [0n]); };
  assert.deepEqual(await readUniswapV3(OWNER, { exec }), []);
  assert.equal(rounds, 1);
});

test('fetchEthDefiPositions: one failing reader does not blank the others; non-mainnet is a no-op', async () => {
  const chain = { chainId: 1, name: 'Ethereum' };
  const exec = async (calls) => {
    if (calls.some((c) => c.fn === 'position')) throw new Error('rpc down'); // Morpho stage 1
    return calls.map(() => [0n]);
  };
  const spark = { protocol: 'SparkLend', usd: 100, healthFactor: 2, legs: [] };
  const res = await fetchEthDefiPositions(OWNER, chain, undefined, { exec, spark: async () => spark, getPrices: prices({}) });
  assert.deepEqual(res.failed, ['Morpho']);
  assert.deepEqual(res.positions, [spark]);

  const other = await fetchEthDefiPositions(OWNER, { chainId: 8453, name: 'Base' }, undefined, { exec });
  assert.deepEqual(other, { positions: [], failed: [] });
});
