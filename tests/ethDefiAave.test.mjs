// Offline tests for the shared Aave-v3-style reader (Aave + SparkLend) and for the
// token-registry entries that make ether.fi / Ethena / Spark savings / Lido show
// up as staking positions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAavePosition, stakingPositionsFromHoldings } from '../src/data/defi.js';
import { SPARK_POOL } from '../src/data/ethDefiRegistry.js';
import mainnet from '../src/config/networks.mainnet.js';

const OWNER = '0x000000000000000000000000000000000000dEaD';
const ETH_CHAIN = { chainId: 1, name: 'Ethereum' };
const acct = (collUsd, debtUsd, hf) => ({
  totalCollateralBase: BigInt(Math.round(collUsd * 1e8)), // USD, 8 decimals
  totalDebtBase: BigInt(Math.round(debtUsd * 1e8)),
  healthFactor: hf == null ? 2n ** 256n - 1n : BigInt(Math.round(hf * 1e18)),
});

test('fetchAavePosition: net value, health factor and legs from getUserAccountData', async () => {
  let asked;
  const p = await fetchAavePosition(OWNER, ETH_CHAIN, undefined, {
    getAccountData: async (pool, owner) => { asked = { pool, owner }; return acct(10_000, 4_000, 1.8); },
  });
  assert.equal(asked.pool, '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2'); // Aave v3 Ethereum pool
  assert.equal(asked.owner, OWNER);
  assert.equal(p.protocol, 'Aave v3');
  assert.equal(p.usd, 6_000);
  assert.ok(Math.abs(p.healthFactor - 1.8) < 1e-9);
  assert.deepEqual(p.legs.map((l) => [l.tone, l.usd]), [['sup', 10_000], ['bor', 4_000]]);
  assert.match(p.sub, /Health factor 1\.80/);
});

test('fetchAavePosition: no debt → no health factor; no collateral, read failure or no pool → null', async () => {
  const noDebt = await fetchAavePosition(OWNER, ETH_CHAIN, undefined, { getAccountData: async () => acct(500, 0, null) });
  assert.equal(noDebt.healthFactor, null);
  assert.equal(noDebt.usd, 500);
  assert.equal(noDebt.legs.length, 1);
  assert.equal(await fetchAavePosition(OWNER, ETH_CHAIN, undefined, { getAccountData: async () => acct(0, 0, null) }), null);
  assert.equal(await fetchAavePosition(OWNER, ETH_CHAIN, undefined, { getAccountData: async () => { throw new Error('rpc'); } }), null);
  assert.equal(await fetchAavePosition(OWNER, { chainId: 999999, name: 'X' }, undefined, { getAccountData: async () => acct(1, 0, null) }), null);
});

test("SparkLend: the same reader pointed at Spark's pool, labelled as SparkLend", async () => {
  let pool;
  const p = await fetchAavePosition(OWNER, ETH_CHAIN, undefined, {
    pool: SPARK_POOL, protocol: 'SparkLend', glyph: '✨',
    getAccountData: async (pl) => { pool = pl; return acct(77_000, 30_000, 2.28); },
  });
  assert.equal(pool, SPARK_POOL);
  assert.equal(p.protocol, 'SparkLend');
  assert.equal(p.glyph, '✨');
  assert.equal(p.usd, 47_000);
  assert.ok(Math.abs(p.healthFactor - 2.28) < 1e-9);
});

const ETH_TOKENS = mainnet.tokens.filter((t) => t.chainId === 1);
const tokenBy = (sym) => ETH_TOKENS.find((t) => t.symbol === sym);

test('registry: ether.fi, Ethena and Spark savings tokens have the right protocol, address and decimals', () => {
  const expect = {
    eETH: ['0x35fA164735182de50811E8e2E824cFb9B6118ac2', 'ether.fi'],
    weETH: ['0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee', 'ether.fi'],
    sUSDe: ['0x9D39A5DE30e57443BfF2A8307A4256c8797A3497', 'Ethena'],
    sDAI: ['0x83F20F44975D03b1b09e64809B757c47f942BEeA', 'Spark'],
    sUSDS: ['0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD', 'Spark'],
  };
  for (const [sym, [address, protocol]] of Object.entries(expect)) {
    const t = tokenBy(sym);
    assert.ok(t, `${sym} missing`);
    assert.equal(t.address, address);
    assert.equal(t.protocol, protocol);
    assert.equal(t.label, 'Staking');
    assert.equal(t.decimals, 18);
  }
  const usde = tokenBy('USDe');
  assert.equal(usde.address, '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3');
  assert.ok(!usde.protocol, 'plain USDe is a stablecoin, not a staking position');
  const addrs = ETH_TOKENS.map((t) => t.address.toLowerCase());
  assert.equal(new Set(addrs).size, addrs.length, 'an Ethereum token address is registered twice');
});

test('registry: held ether.fi / Ethena / Spark tokens become staking positions, like Lido', () => {
  const h = (sym, usd) => ({ ...tokenBy(sym), symbol: sym, amount: 1, usd, chainName: 'Ethereum' });
  const pos = stakingPositionsFromHoldings([h('weETH', 2000), h('sUSDe', 1.25), h('sUSDS', 1.1), h('wstETH', 2300), h('USDe', 1)]);
  assert.deepEqual(pos.map((p) => p.protocol).sort(), ['Ethena', 'Lido', 'Spark', 'ether.fi']);
  assert.ok(pos.every((p) => p.kind === 'Staking'));
});
