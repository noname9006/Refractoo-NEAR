// Testnet network profile — the Sepolia family, where every FHE stack coexists.
//
// Why this profile exists: Fhenix CoFHE has NO mainnet deployment (it is live on
// Ethereum Sepolia, Arbitrum Sepolia and Base Sepolia only), so exercising it at
// all requires a testnet mode. Zama and Inco also run testnets on these same
// chains, which makes this the one profile where all three adapters can be
// tested side by side.
//
// PRICING: DefiLlama has no testnet coverage, so every token here carries an
// explicit `priceKey` pointing at its MAINNET twin. The profile's
// priceMode: 'proxy' makes the UI label these figures as proxied — they are not
// real value. See config/networks.js → priceKeyFor().
//
// ADDRESSES: testnet deployments move and get redeployed far more often than
// mainnet ones. Everything here degrades gracefully if wrong — probeBalances
// uses allowFailure, so a bad address yields no balance rather than an error —
// but verify against the explorer before trusting a number.

import { TINTS } from './networks.mainnet.js';

function t(chainId, address, symbol, name, decimals, glyph, extra = {}) {
  return {
    chainId, address, symbol, name, decimals, glyph,
    color: TINTS[extra.tint] || null,
    ...extra,
  };
}

// Mainnet price-key twins, so testnet balances get a plausible USD figure.
const PX = {
  USDC: 'ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  WETH: 'ethereum:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  ETH: 'coingecko:ethereum',
};

const CHAINS = [
  {
    chainId: 11155111,
    name: 'Sepolia',
    symbol: 'ETH',
    rpcs: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://sepolia.drpc.org',
      'https://rpc.sepolia.org',
    ],
  },
  {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    symbol: 'ETH',
    rpcs: [
      'https://arbitrum-sepolia-rpc.publicnode.com',
      'https://sepolia-rollup.arbitrum.io/rpc',
    ],
  },
  {
    chainId: 84532,
    name: 'Base Sepolia',
    symbol: 'ETH',
    rpcs: [
      'https://base-sepolia-rpc.publicnode.com',
      'https://sepolia.base.org',
    ],
  },
];

// Circle's official testnet USDC + the canonical wrapped-ETH on each chain.
const TOKENS = [
  // ── Ethereum Sepolia ──
  t(11155111, '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 'USDC', 'USD Coin (Sepolia)', 6, '$', { tint: 'stable', kind: 'stable', priceKey: PX.USDC }),
  t(11155111, '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', 'WETH', 'Wrapped Ether (Sepolia)', 18, 'Ξ', { tint: 'eth', kind: 'eth', priceKey: PX.WETH }),

  // ── Arbitrum Sepolia ──
  t(421614, '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', 'USDC', 'USD Coin (Arb Sepolia)', 6, '$', { tint: 'stable', kind: 'stable', priceKey: PX.USDC }),
  t(421614, '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73', 'WETH', 'Wrapped Ether (Arb Sepolia)', 18, 'Ξ', { tint: 'eth', kind: 'eth', priceKey: PX.WETH }),

  // ── Base Sepolia ──
  t(84532, '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 'USDC', 'USD Coin (Base Sepolia)', 6, '$', { tint: 'stable', kind: 'stable', priceKey: PX.USDC }),
  t(84532, '0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether (Base Sepolia)', 18, 'Ξ', { tint: 'eth', kind: 'eth', priceKey: PX.WETH }),
];

// Comma-separated env list → array of trimmed, non-empty addresses.
const envList = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// The CoFHE demo contract(s). VITE_COFHE_DEMO_ADDRESSES takes a comma-separated
// list for multiple deployments; VITE_COFHE_DEMO_ADDRESS is the single-address
// form; VITE_CONFIDENTIAL_DEMO_ADDRESS is the pre-FHE-plan name. All three are
// honoured and merged (deduped) so existing .env files keep working.
const cofheAddresses = Array.from(
  new Set([
    ...envList(import.meta.env.VITE_COFHE_DEMO_ADDRESSES),
    ...envList(import.meta.env.VITE_COFHE_DEMO_ADDRESS),
    ...envList(import.meta.env.VITE_CONFIDENTIAL_DEMO_ADDRESS),
  ])
);

// CoFHE ships no confidential-token standard and no registry, so its
// "confidential holdings" are whatever contracts you point it at. Each address
// is assumed to be a ConfidentialDemo.sol deployment (same getter + FHE type) —
// deploy copies to more than one address to track more than one sealed value.
const cofheContracts = cofheAddresses.map((address, i) => ({
  address,
  symbol: 'DEMO',
  name:
    cofheAddresses.length > 1
      ? `CoFHE sealed demo balance #${i + 1}`
      : 'CoFHE sealed demo balance',
  decimals: 0,
  glyph: '🔒',
  // The demo contract's own getter, not a token standard.
  getter: 'getSealedBalance',
  fheType: 'uint128',
}));

const FHE_STACKS = [
  // CoFHE is live on all three of this profile's chains. The demo contract is
  // deployed to whichever one you chose, so the same entry is offered on each
  // and simply finds nothing on the others.
  ...CHAINS.map((c) => ({
    id: 'cofhe',
    name: 'Fhenix CoFHE',
    chainId: c.chainId,
    discovery: { type: 'list', tokens: cofheContracts },
  })),
  {
    id: 'zama',
    name: 'Zama Protocol',
    chainId: 11155111,
    // Sepolia's wrapper-registry address, taken from @zama-fhe/sdk's own chain
    // descriptor (chains.sepolia.registryAddress) rather than from prose docs.
    // VITE_ZAMA_SEPOLIA_REGISTRY overrides it if Zama redeploys.
    discovery: {
      type: 'registry',
      address:
        import.meta.env.VITE_ZAMA_SEPOLIA_REGISTRY || '0x2f0750Bbb0A246059d80e94c454586a7F27a128e',
    },
    sdkChain: 'sepolia',
  },
  {
    id: 'inco',
    name: 'Inco Lightning',
    chainId: 84532,
    discovery: { type: 'list', tokens: envList(import.meta.env.VITE_INCO_TESTNET_TOKENS).map((address) => ({ address })) },
  },
];

export default {
  mode: 'testnet',
  label: 'Testnet',
  testnet: true,
  chains: CHAINS,
  tokens: TOKENS,
  // 'proxy' ⇒ USD figures come from mainnet twins and must be labelled as such.
  priceMode: 'proxy',
  // No DefiLlama slugs exist for testnets; pricing goes through token.priceKey.
  chainSlug: {},
  native: {
    11155111: { key: PX.ETH, symbol: 'ETH', name: 'Sepolia Ether', glyph: 'Ξ', color: TINTS.eth },
    421614: { key: PX.ETH, symbol: 'ETH', name: 'Arb Sepolia Ether', glyph: 'Ξ', color: TINTS.eth },
    84532: { key: PX.ETH, symbol: 'ETH', name: 'Base Sepolia Ether', glyph: 'Ξ', color: TINTS.eth },
  },
  // Aave v3 has testnet deployments, but at different addresses per network and
  // they get redeployed. Left empty: fetchAavePosition() returns null when a
  // chain has no pool, which is exactly the desired degrade.
  aaveV3Pool: {},
  chainMeta: {
    11155111: { name: 'Sepolia', cd: 'eth' },
    421614: { name: 'Arb Sepolia', cd: 'arb' },
    84532: { name: 'Base Sepolia', cd: 'base' },
  },
  explorer: {
    11155111: 'https://sepolia.etherscan.io',
    421614: 'https://sepolia.arbiscan.io',
    84532: 'https://sepolia.basescan.org',
  },
  // The CoinGecko registry is mainnet-only, so the tier-2 long-tail probe would
  // be thousands of guaranteed-empty multicalls. Skipped: the curated list plus
  // transferred tokens from history is the whole universe here.
  useTokenRegistry: false,
  fheStacks: FHE_STACKS,
};
