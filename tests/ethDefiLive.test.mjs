// Live smoke tests against real chains / real accounts. Skipped by default —
// they depend on public RPCs and on third-party wallets that keep positions open.
//
//   LIVE_DEFI=1 node --test tests/ethDefiLive.test.mjs
//   (optionally ETH_RPC_URL=https://your-node  if the default public RPCs are blocked)
//
// If a demo-wallet test fails because a position closed, pick another active
// address in src/near/demoFixtures.js. If a registry test fails, an address in
// src/data/ethDefiRegistry.js or the token list is wrong — that is a real bug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { makeExec, fetchEthDefiPositions } from '../src/data/ethDefi.js';
import { fetchAavePosition } from '../src/data/defi.js';
import { MORPHO_BLUE, MORPHO_MARKETS, MORPHO_VAULTS } from '../src/data/ethDefiRegistry.js';
import { DEMO_EVM_DEFI_WALLETS, DEMO_NEAR_DEFI_ACCOUNT } from '../src/near/demoFixtures.js';
import { loadNearAccount } from '../src/near/nearAccount.js';
import { CHAINS } from '../src/config/networks.js';
import mainnet from '../src/config/networks.mainnet.js';

const skip = !process.env.LIVE_DEFI && 'set LIVE_DEFI=1 to run live DeFi smoke tests';
const ETH = CHAINS.find((c) => c.chainId === 1);
const RPC = process.env.ETH_RPC_URL || undefined; // optional: your own node, if the public ones are unreachable from here
const T = { timeout: 120_000, skip };

test('live registry: every curated Morpho market matches the chain (tokens, oracle, LLTV)', T, async () => {
  const iface = new Interface(['function idToMarketParams(bytes32) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)']);
  const res = await makeExec(ETH, RPC)(MORPHO_MARKETS.map((m) => ({ to: MORPHO_BLUE, iface, fn: 'idToMarketParams', args: [m.id] })));
  MORPHO_MARKETS.forEach((m, i) => {
    const p = res[i];
    assert.ok(p, `${m.coll.symbol}/${m.loan.symbol}: market not found on chain`);
    assert.equal(p[0].toLowerCase(), m.loan.address.toLowerCase());
    assert.equal(p[1].toLowerCase(), m.coll.address.toLowerCase());
    assert.equal(p[2].toLowerCase(), m.oracle.toLowerCase());
    assert.equal(Number(p[4]) / 1e18, m.lltv);
  });
});

test('live registry: Morpho vaults wrap the declared asset; the new tokens match their symbols', T, async () => {
  const iface = new Interface(['function asset() view returns (address)', 'function symbol() view returns (string)']);
  const exec = makeExec(ETH, RPC);
  const vaults = await exec(MORPHO_VAULTS.map((v) => ({ to: v.address, iface, fn: 'asset' })));
  MORPHO_VAULTS.forEach((v, i) => assert.equal(vaults[i]?.[0].toLowerCase(), v.asset.address.toLowerCase(), `${v.name} asset`));
  const toks = ['eETH', 'weETH', 'USDe', 'sUSDe', 'sDAI', 'sUSDS'].map((s) => mainnet.tokens.find((t) => t.chainId === 1 && t.symbol === s));
  const res = await exec(toks.map((t) => ({ to: t.address, iface, fn: 'symbol' })));
  toks.forEach((t, i) => assert.equal(res[i]?.[0], t.symbol, `${t.symbol} address`));
});

test('live demo wallets: each EVM demo wallet still shows its protocol position', T, async () => {
  const expect = { 'Aave borrower': 'Aave v3', 'Morpho borrower': 'Morpho', 'SparkLend user': 'SparkLend', 'Uniswap v3 LP': 'Uniswap v3' };
  for (const w of DEMO_EVM_DEFI_WALLETS) {
    const want = expect[w.label];
    assert.ok(want, `no expectation for demo wallet "${w.label}"`);
    const found = [];
    const aave = await fetchAavePosition(w.address, ETH, RPC);
    if (aave) found.push(aave);
    const { positions, failed } = await fetchEthDefiPositions(w.address, ETH, RPC);
    assert.deepEqual(failed, [], `${w.label}: a reader failed`);
    found.push(...positions);
    assert.ok(found.some((p) => p.protocol === want), `${w.label} (${w.address}) no longer has a ${want} position — pick another demo wallet`);
  }
});

test('live demo wallet: the NEAR demo account still has a Rhea Lend position', T, async () => {
  const acct = await loadNearAccount(DEMO_NEAR_DEFI_ACCOUNT);
  assert.ok(acct.positions.some((p) => p.protocol === 'Rhea Lend'), `${DEMO_NEAR_DEFI_ACCOUNT} no longer has a Rhea Lend position`);
});
