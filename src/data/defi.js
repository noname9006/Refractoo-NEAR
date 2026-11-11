// Best-effort DeFi position detection. Two honest, real sources:
//
//   1. Aave v3 — Pool.getUserAccountData(user) gives total collateral, total
//      debt and the health factor directly, in the protocol's base currency
//      (USD, 8 decimals). One contract read per chain.
//   2. Liquid-staking derivatives held in the wallet (stETH/wstETH/rETH/cbETH)
//      are surfaced as staking positions, valued from the price feed upstream.
//
// We deliberately do NOT guess at AMM LP positions (Uniswap v3 NFTs, etc.) —
// those need per-protocol NFT/tick math and would invite fabricated numbers.

import { Contract } from 'ethers';
import { AAVE_V3_POOL } from './tokens.js';
import { createChainProvider } from './public.js';
import { rpcLimitFor } from '../utils/limit.js';
import { amount } from '../components/dashboard/format.js';

const AAVE_POOL_ABI = [
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
];

// Aave reports monetary amounts in "base currency" with 8 decimals (USD).
const fromBase = (v) => Number(v) / 1e8;

// Reads the wallet's Aave v3 position on one chain. Returns a position object or
// null when there's no collateral. healthFactor is 1e18-scaled (∞ when no debt).
export async function fetchAavePosition(owner, chain, rpcOverride) {
  const pool = AAVE_V3_POOL[chain.chainId];
  if (!pool) return null;
  const provider = createChainProvider(chain, rpcOverride);
  const contract = new Contract(pool, AAVE_POOL_ABI, provider);

  let data;
  try {
    // Route through the chain's limiter so Aave reads share the budget with the
    // balance multicalls instead of bursting the endpoint independently.
    data = await rpcLimitFor(chain.chainId, !!rpcOverride)(() => contract.getUserAccountData(owner));
  } catch (err) {
    console.warn(`[defi] Aave read failed on ${chain.name}:`, err?.message || err);
    return null;
  }

  const collateral = fromBase(data.totalCollateralBase);
  if (!(collateral > 0)) return null;
  const debt = fromBase(data.totalDebtBase);
  const hfRaw = data.healthFactor; // uint256, 1e18-scaled; MaxUint256 when no debt
  const healthFactor = debt > 0 ? Number(hfRaw) / 1e18 : null;

  return {
    protocol: 'Aave v3',
    chainId: chain.chainId,
    chainName: chain.name,
    kind: 'Lending',
    glyph: '👻',
    usd: collateral - debt, // net position value
    healthFactor,
    legs: [
      { label: 'Supplied', tone: 'sup', usd: collateral },
      ...(debt > 0 ? [{ label: 'Borrowed', tone: 'bor', usd: debt }] : []),
    ],
    sub:
      healthFactor != null
        ? `Lending · Health factor ${healthFactor.toFixed(2)}`
        : 'Lending · no outstanding debt',
  };
}

// Turns staking-derivative holdings into staking positions. holdings already
// carry USD (added by the portfolio builder). chainName lets us label the row.
export function stakingPositionsFromHoldings(holdings) {
  return holdings
    .filter((h) => h.protocol && h.label === 'Staking')
    .map((h) => ({
      protocol: h.protocol,
      chainId: h.chainId,
      chainName: h.chainName,
      kind: 'Staking',
      glyph: '🌊',
      usd: h.usd || 0,
      healthFactor: null,
      legs: [
        {
          label: 'Staked',
          tone: 'sup',
          text: `${amount(h.amount)} ${h.symbol}`,
          usd: h.usd || 0,
        },
      ],
      sub: `Staking · ${h.symbol}`,
    }));
}
