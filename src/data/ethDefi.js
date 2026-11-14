// Ethereum-mainnet DeFi position readers beyond Aave v3:
//
//   SparkLend   Aave-v3 fork → same getUserAccountData() as Aave (USD, 8 dec).
//   Morpho      Blue: position(id, user) per curated market (supplied, collateral,
//               borrowed, health factor from the market oracle + LLTV), plus
//               MetaMorpho vault shares → assets.
//   Uniswap v3  concentrated-liquidity NFTs: amounts from liquidity + the pool's
//               current price + the position's tick range.
//
// Lido, ether.fi, Ethena and Spark savings tokens (stETH/wstETH, eETH/weETH,
// sUSDe, sDAI/sUSDS) are ordinary priced ERC-20s: they are listed in the token
// registry (config/networks.mainnet.js) and surface as staking positions.
//
// All reads are on-chain eth_calls through the shared Multicall3 helper and the
// per-chain RPC limiter; USD comes only from the DefiLlama price feed. A leg
// with no price makes the row's USD (and nothing else) unavailable — we never
// guess a value. Each reader is isolated: one failing never blanks the others.

import { Interface } from 'ethers';
import { multicall } from './multicall.js';
import { fetchPrices } from './prices.js';
import { llamaKey } from './tokens.js';
import { amount as fmtAmount } from '../components/dashboard/format.js';
import { fetchAavePosition } from './defi.js';
import {
  ETH, SPARK_POOL, MORPHO_BLUE, MORPHO_MARKETS, MORPHO_VAULTS, UNI_V3_NPM, UNI_V3_FACTORY,
} from './ethDefiRegistry.js';

const MORPHO_ABI = new Interface([
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
]);
const ORACLE_ABI = new Interface(['function price() view returns (uint256)']);
const VAULT_ABI = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
]);
const ERC20_ABI = new Interface([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);
const NPM_ABI = new Interface([
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
]);
const FACTORY_ABI = new Interface(['function getPool(address, address, uint24) view returns (address)']);
const POOL_ABI = new Interface([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
]);

const UNI_MAX_NFTS = 30; // enumerate at most this many position NFTs per wallet
const usdOf = (amt, price) => (price != null && Number.isFinite(amt) ? amt * price : null);
const sumOrNull = (xs) => (xs.some((x) => x == null) ? null : xs.reduce((s, x) => s + x, 0));

// Default I/O: one Multicall3 round on `chain`, results decoded per call.
// calls: [{ to, iface, fn, args }] → decoded Result | null (null = failed call).
export function makeExec(chain, rpcOverride) {
  return async (calls) => {
    if (!calls.length) return [];
    const { results } = await multicall(chain, calls.map((c) => ({
      target: c.to, allowFailure: true, callData: c.iface.encodeFunctionData(c.fn, c.args || []),
    })), rpcOverride);
    return calls.map((c, i) => {
      const r = results[i];
      if (!r?.success || r.returnData === '0x') return null;
      try { return c.iface.decodeFunctionResult(c.fn, r.returnData); } catch { return null; }
    });
  };
}

const priceOf = (prices, address) => prices.get(llamaKey(ETH, address))?.price ?? null;
const priceKeys = (addrs) => [...new Set(addrs.map((a) => llamaKey(ETH, a)))];

// ── Morpho ────────────────────────────────────────────────────────────────────
export async function readMorpho(owner, { exec, getPrices = fetchPrices, chainName = 'Ethereum' }) {
  const stage1 = await exec([
    ...MORPHO_MARKETS.map((m) => ({ to: MORPHO_BLUE, iface: MORPHO_ABI, fn: 'position', args: [m.id, owner] })),
    ...MORPHO_VAULTS.map((v) => ({ to: v.address, iface: VAULT_ABI, fn: 'balanceOf', args: [owner] })),
  ]);
  const mPos = stage1.slice(0, MORPHO_MARKETS.length);
  const vBal = stage1.slice(MORPHO_MARKETS.length);

  const activeM = MORPHO_MARKETS.map((m, i) => ({ m, p: mPos[i] }))
    .filter(({ p }) => p && (p[0] > 0n || p[1] > 0n || p[2] > 0n));
  const activeV = MORPHO_VAULTS.map((v, i) => ({ v, shares: vBal[i]?.[0] ?? 0n })).filter((x) => x.shares > 0n);
  if (!activeM.length && !activeV.length) return [];

  const stage2 = await exec([
    ...activeM.flatMap(({ m }) => [
      { to: MORPHO_BLUE, iface: MORPHO_ABI, fn: 'market', args: [m.id] },
      { to: m.oracle, iface: ORACLE_ABI, fn: 'price' },
    ]),
    ...activeV.map(({ v, shares }) => ({ to: v.address, iface: VAULT_ABI, fn: 'convertToAssets', args: [shares] })),
  ]);
  const prices = await getPrices(priceKeys([
    ...activeM.flatMap(({ m }) => [m.loan.address, m.coll.address]),
    ...activeV.map(({ v }) => v.asset.address),
  ])).catch(() => new Map());

  const out = [];
  activeM.forEach(({ m, p }, i) => {
    const mk = stage2[i * 2];
    const orc = stage2[i * 2 + 1];
    const [supplyShares, borrowShares, collateralRaw] = p;
    if (!mk) return; // market state unreadable → can't value shares; skip rather than guess
    // Morpho's virtual-share conversions (rounding as the protocol does).
    const supplyRaw = (supplyShares * (mk[0] + 1n)) / (mk[1] + 1_000_000n);
    const borrowRaw = (borrowShares * (mk[2] + 1n) + (mk[3] + 1_000_000n) - 1n) / (mk[3] + 1_000_000n);
    const loanAmt = Number(supplyRaw) / 10 ** m.loan.decimals;
    const debtAmt = Number(borrowRaw) / 10 ** m.loan.decimals;
    const collAmt = Number(collateralRaw) / 10 ** m.coll.decimals;
    const pl = priceOf(prices, m.loan.address);
    const pc = priceOf(prices, m.coll.address);

    // Health factor, as Morpho defines it: collateral (in loan units, via the
    // market oracle) × LLTV ÷ debt. Needs no USD price at all.
    let healthFactor = null;
    if (borrowRaw > 0n && orc) {
      const collInLoan = (collateralRaw * orc[0]) / 10n ** 36n;
      healthFactor = (Number(collInLoan) * m.lltv) / Number(borrowRaw);
    }

    const legs = [];
    const add = (label, tone, amt, symbol, usd) => legs.push({ label: `${label} ${symbol}`, tone, text: `${fmtAmount(amt)} ${symbol}`, usd, symbol, amount: amt });
    if (supplyRaw > 0n) add('Supplied', 'sup', loanAmt, m.loan.symbol, usdOf(loanAmt, pl));
    if (collateralRaw > 0n) add('Collateral', 'sup', collAmt, m.coll.symbol, usdOf(collAmt, pc));
    if (borrowRaw > 0n) add('Borrowed', 'bor', debtAmt, m.loan.symbol, usdOf(debtAmt, pl));
    const net = sumOrNull(legs.map((l) => (l.tone === 'bor' ? (l.usd == null ? null : -l.usd) : l.usd)));
    out.push({
      protocol: 'Morpho', chainId: ETH, chainName, kind: 'Lending', glyph: '🦋',
      usd: net, healthFactor, unpricedLegs: legs.filter((l) => l.usd == null).length, legs,
      sub: `Lending · ${m.coll.symbol}/${m.loan.symbol}` + (healthFactor != null ? ` · Health factor ${healthFactor.toFixed(2)}` : ''),
    });
  });

  activeV.forEach(({ v }, i) => {
    const assets = stage2[activeM.length * 2 + i]?.[0];
    if (assets == null) return;
    const amt = Number(assets) / 10 ** v.asset.decimals;
    const usd = usdOf(amt, priceOf(prices, v.asset.address));
    out.push({
      protocol: 'Morpho', chainId: ETH, chainName, kind: 'Lending', glyph: '🦋',
      usd, healthFactor: null, unpricedLegs: usd == null ? 1 : 0,
      legs: [{ label: `Vault ${v.name}`, tone: 'sup', text: `${fmtAmount(amt)} ${v.asset.symbol}`, usd, symbol: v.asset.symbol, amount: amt }],
      sub: `Vault · ${v.name}`,
    });
  });
  return out;
}

// ── Uniswap v3 ────────────────────────────────────────────────────────────────
// Token amounts held by a position — the standard concentrated-liquidity maths:
//   price below range → all token0; above → all token1; inside → both.
// Floating point is plenty for display (error ≪ 1e-9 relative).
export function uniV3Amounts({ liquidity, sqrtPriceX96, tickLower, tickUpper }) {
  const L = Number(liquidity);
  const sp = Number(sqrtPriceX96) / 2 ** 96;
  const sa = 1.0001 ** (Number(tickLower) / 2);
  const sb = 1.0001 ** (Number(tickUpper) / 2);
  if (sp <= sa) return { raw0: L * (1 / sa - 1 / sb), raw1: 0, inRange: false };
  if (sp >= sb) return { raw0: 0, raw1: L * (sb - sa), inRange: false };
  return { raw0: L * (1 / sp - 1 / sb), raw1: L * (sp - sa), inRange: true };
}

export async function readUniswapV3(owner, { exec, getPrices = fetchPrices, chainName = 'Ethereum' }) {
  const [bal] = await exec([{ to: UNI_V3_NPM, iface: NPM_ABI, fn: 'balanceOf', args: [owner] }]);
  const n = Math.min(Number(bal?.[0] ?? 0n), UNI_MAX_NFTS);
  if (!n) return [];

  const ids = (await exec(Array.from({ length: n }, (_, i) => ({ to: UNI_V3_NPM, iface: NPM_ABI, fn: 'tokenOfOwnerByIndex', args: [owner, i] }))))
    .map((r) => r?.[0]).filter((x) => x != null);
  const poss = (await exec(ids.map((id) => ({ to: UNI_V3_NPM, iface: NPM_ABI, fn: 'positions', args: [id] }))))
    .map((p, i) => (p ? { id: ids[i], token0: p.token0, token1: p.token1, fee: Number(p.fee), tickLower: p.tickLower, tickUpper: p.tickUpper, liquidity: p.liquidity } : null))
    .filter((p) => p && p.liquidity > 0n); // closed/empty NFTs hold nothing
  if (!poss.length) return [];

  const tokens = [...new Set(poss.flatMap((p) => [p.token0, p.token1].map((a) => a.toLowerCase())))];
  const meta = await exec(tokens.flatMap((t) => [
    { to: t, iface: ERC20_ABI, fn: 'decimals' }, { to: t, iface: ERC20_ABI, fn: 'symbol' },
  ]));
  const info = new Map(tokens.map((t, i) => [t, { decimals: meta[i * 2] ? Number(meta[i * 2][0]) : null, symbol: meta[i * 2 + 1]?.[0] || t.slice(0, 6) }]));

  const pools = await exec(poss.map((p) => ({ to: UNI_V3_FACTORY, iface: FACTORY_ABI, fn: 'getPool', args: [p.token0, p.token1, p.fee] })));
  const slots = await exec(poss.map((_, i) => ({ to: pools[i]?.[0] ?? '0x0000000000000000000000000000000000000000', iface: POOL_ABI, fn: 'slot0' })));
  const prices = await getPrices(priceKeys(tokens)).catch(() => new Map());

  const legs = [];
  poss.forEach((p, i) => {
    const s = slots[i];
    const a0 = info.get(p.token0.toLowerCase());
    const a1 = info.get(p.token1.toLowerCase());
    if (!s || a0.decimals == null || a1.decimals == null) return; // can't value → skip, never guess
    const { raw0, raw1, inRange } = uniV3Amounts({ liquidity: p.liquidity, sqrtPriceX96: s.sqrtPriceX96, tickLower: p.tickLower, tickUpper: p.tickUpper });
    const amt0 = raw0 / 10 ** a0.decimals;
    const amt1 = raw1 / 10 ** a1.decimals;
    // Only the sides the position actually holds count; a single-sided
    // (out-of-range) position needs just that one token priced.
    const held = [];
    if (raw0 > 0) held.push({ amt: amt0, sym: a0.symbol, usd: usdOf(amt0, priceOf(prices, p.token0)) });
    if (raw1 > 0) held.push({ amt: amt1, sym: a1.symbol, usd: usdOf(amt1, priceOf(prices, p.token1)) });
    const usd = held.length ? sumOrNull(held.map((h) => h.usd)) : 0;
    legs.push({
      label: `#${p.id} ${a0.symbol}/${a1.symbol} ${+(p.fee / 10000).toFixed(4)}%`,
      tone: 'sup',
      text: held.map((h) => `${fmtAmount(h.amt)} ${h.sym}`).join(' + ') + (inRange ? '' : ' · out of range'),
      usd, inRange,
    });
  });
  if (!legs.length) return [];
  // Each NFT is an independent position, so unlike a lending net value a partial
  // sum is meaningful: count the priced NFTs and say how many were left out.
  const priced = legs.filter((l) => l.usd != null);
  const usd = priced.length ? priced.reduce((s, l) => s + l.usd, 0) : null;
  const unpriced = legs.length - priced.length;
  return [{
    protocol: 'Uniswap v3', chainId: ETH, chainName, kind: 'Liquidity', glyph: '🦄',
    usd, healthFactor: null, unpricedLegs: unpriced, legs,
    sub: `Liquidity · ${legs.length} position${legs.length === 1 ? '' : 's'}${unpriced ? ` (${unpriced} unpriced, not counted)` : ''} · excl. uncollected fees`,
  }];
}

// ── Entry point ───────────────────────────────────────────────────────────────
// All the extra Ethereum-mainnet readers for one wallet. Each is isolated:
// a failing reader is dropped (and noted in `failed`), the rest still land.
export async function fetchEthDefiPositions(owner, chain, rpcOverride, deps = {}) {
  if (chain.chainId !== ETH) return { positions: [], failed: [] };
  const exec = deps.exec || makeExec(chain, rpcOverride);
  const ctx = { exec, getPrices: deps.getPrices || fetchPrices, chainName: chain.name };
  const readers = {
    'SparkLend': async () => {
      const spark = await (deps.spark || ((o) => fetchAavePosition(o, chain, rpcOverride, { pool: SPARK_POOL, protocol: 'SparkLend', glyph: '✨' })))(owner);
      return spark ? [spark] : [];
    },
    'Morpho': () => readMorpho(owner, ctx),
    'Uniswap v3': () => readUniswapV3(owner, ctx),
  };
  const positions = [];
  const failed = [];
  await Promise.all(Object.entries(readers).map(async ([name, run]) => {
    try { positions.push(...await run()); } catch (e) { failed.push(name); console.warn(`[defi] ${name} read failed:`, e?.message || e); }
  }));
  return { positions, failed };
}
