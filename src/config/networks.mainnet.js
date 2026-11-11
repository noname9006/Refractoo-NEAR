// Mainnet network profile.
//
// This is the app's original configuration, moved out of data/public.js,
// data/tokens.js and components/dashboard/format.js so that a second (testnet)
// profile can exist alongside it. Behaviour is unchanged from before the split.
//
// Addresses are production contracts. A wrong address degrades gracefully:
// balanceOf reverts (allowFailure) or the price key just returns nothing —
// never fatal. Verify against a block explorer before relying on a number.

// Brand tints for token glyphs (falls back to a neutral chip when absent).
export const TINTS = {
  stable: { bg: '#e9f4fe', fg: '#2775ca' },
  eth: { bg: '#eef1fd', fg: '#627eea' },
  btc: { bg: '#fff0e6', fg: '#f7931a' },
  arb: { bg: '#eaf3ff', fg: '#28a0f0' },
  op: { bg: '#ffeaec', fg: '#ff0420' },
  base: { bg: '#e9eefe', fg: '#0052ff' },
  poly: { bg: '#f0eafe', fg: '#8247e5' },
  stake: { bg: '#e8f0ff', fg: '#00a3ff' },
  gov: { bg: '#f3e9ff', fg: '#7b4dd8' },
  // Confidential/shielded tokens (Zama ERC-7984 wrappers, Inco, CoFHE).
  shield: { bg: '#eae9fe', fg: '#5b4bd8' },
};

// kind: rough class used for grouping/risk. protocol/label: set for staking
// derivatives so defi.js can surface them as positions.
function t(chainId, address, symbol, name, decimals, glyph, extra = {}) {
  return {
    chainId, address, symbol, name, decimals, glyph,
    color: TINTS[extra.tint] || null,
    ...extra,
  };
}

// Each chain lists several public RPC endpoints. Public nodes flake constantly
// (ERR_CONNECTION_CLOSED, intermittent 5xx, per-IP rate limits); with a single
// endpoint one bad node blanks the whole chain. The list is ordered by
// preference and consumed by createChainProvider, which fails over across them.
const CHAINS = [
  {
    chainId: 1,
    name: 'Ethereum',
    symbol: 'ETH',
    rpcs: [
      'https://ethereum-rpc.publicnode.com',
      'https://cloudflare-eth.com',
      'https://rpc.ankr.com/eth',
    ],
  },
  {
    chainId: 42161,
    name: 'Arbitrum',
    symbol: 'ETH',
    rpcs: [
      'https://arbitrum-one-rpc.publicnode.com',
      'https://arb1.arbitrum.io/rpc',
      'https://rpc.ankr.com/arbitrum',
    ],
  },
  {
    chainId: 10,
    name: 'Optimism',
    symbol: 'ETH',
    rpcs: [
      'https://optimism-rpc.publicnode.com',
      'https://mainnet.optimism.io',
      'https://rpc.ankr.com/optimism',
    ],
  },
  {
    chainId: 8453,
    name: 'Base',
    symbol: 'ETH',
    rpcs: [
      'https://base-rpc.publicnode.com',
      'https://mainnet.base.org',
    ],
  },
  {
    chainId: 137,
    name: 'Polygon',
    symbol: 'POL',
    rpcs: [
      'https://polygon-bor-rpc.publicnode.com',
      'https://rpc.ankr.com/polygon',
    ],
  },
];

// Curated, high-liquidity token set per chain. These are probed first (tier 1);
// the CoinGecko registry supplies the long tail. Extend as needed.
const TOKENS = [
  // ── Ethereum ──
  t(1, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USDC', 'USD Coin', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(1, '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT', 'Tether USD', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(1, '0x6B175474E89094C44Da98b954EedeAC495271d0F', 'DAI', 'Dai', 18, '$', { tint: 'stable', kind: 'stable' }),
  t(1, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'WETH', 'Wrapped Ether', 18, 'Ξ', { tint: 'eth', kind: 'eth' }),
  t(1, '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 'WBTC', 'Wrapped BTC', 8, '₿', { tint: 'btc', kind: 'btc' }),
  t(1, '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', 'stETH', 'Lido Staked ETH', 18, 'Ξ', { tint: 'stake', kind: 'eth', protocol: 'Lido', label: 'Staking' }),
  t(1, '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', 'wstETH', 'Wrapped stETH', 18, 'Ξ', { tint: 'stake', kind: 'eth', protocol: 'Lido', label: 'Staking' }),
  t(1, '0xae78736Cd615f374D3085123A210448E74Fc6393', 'rETH', 'Rocket Pool ETH', 18, 'Ξ', { tint: 'stake', kind: 'eth', protocol: 'Rocket Pool', label: 'Staking' }),
  t(1, '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704', 'cbETH', 'Coinbase Wrapped Staked ETH', 18, 'Ξ', { tint: 'stake', kind: 'eth', protocol: 'Coinbase', label: 'Staking' }),
  t(1, '0x514910771AF9Ca656af840dff83E8264EcF986CA', 'LINK', 'Chainlink', 18, 'L', { tint: 'gov', kind: 'token' }),
  t(1, '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', 'UNI', 'Uniswap', 18, 'U', { tint: 'gov', kind: 'token' }),
  t(1, '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', 'AAVE', 'Aave', 18, 'A', { tint: 'gov', kind: 'token' }),

  // ── Arbitrum ──
  t(42161, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'USDC', 'USD Coin', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(42161, '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 'USDT', 'Tether USD', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(42161, '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', 'DAI', 'Dai', 18, '$', { tint: 'stable', kind: 'stable' }),
  t(42161, '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 'WETH', 'Wrapped Ether', 18, 'Ξ', { tint: 'eth', kind: 'eth' }),
  t(42161, '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', 'WBTC', 'Wrapped BTC', 8, '₿', { tint: 'btc', kind: 'btc' }),
  t(42161, '0x912CE59144191C1204E64559FE8253a0e49E6548', 'ARB', 'Arbitrum', 18, 'A', { tint: 'arb', kind: 'token' }),
  t(42161, '0x5979D7b546E38E414F7E9822514be443A4800529', 'wstETH', 'Wrapped stETH', 18, 'Ξ', { tint: 'stake', kind: 'eth', protocol: 'Lido', label: 'Staking' }),
  t(42161, '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', 'LINK', 'Chainlink', 18, 'L', { tint: 'gov', kind: 'token' }),

  // ── Optimism ──
  t(10, '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 'USDC', 'USD Coin', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(10, '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', 'USDT', 'Tether USD', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(10, '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', 'DAI', 'Dai', 18, '$', { tint: 'stable', kind: 'stable' }),
  t(10, '0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18, 'Ξ', { tint: 'eth', kind: 'eth' }),
  t(10, '0x68f180fcCe6836688e9084f035309E29Bf0A2095', 'WBTC', 'Wrapped BTC', 8, '₿', { tint: 'btc', kind: 'btc' }),
  t(10, '0x4200000000000000000000000000000000000042', 'OP', 'Optimism', 18, 'O', { tint: 'op', kind: 'token' }),
  t(10, '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb', 'wstETH', 'Wrapped stETH', 18, 'Ξ', { tint: 'stake', kind: 'eth', protocol: 'Lido', label: 'Staking' }),

  // ── Base ──
  t(8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USDC', 'USD Coin', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(8453, '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', 'DAI', 'Dai', 18, '$', { tint: 'stable', kind: 'stable' }),
  t(8453, '0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18, 'Ξ', { tint: 'eth', kind: 'eth' }),
  t(8453, '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', 'cbETH', 'Coinbase Wrapped Staked ETH', 18, 'Ξ', { tint: 'stake', kind: 'eth', protocol: 'Coinbase', label: 'Staking' }),
  t(8453, '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', 'wstETH', 'Wrapped stETH', 18, 'Ξ', { tint: 'stake', kind: 'eth', protocol: 'Lido', label: 'Staking' }),
  t(8453, '0x940181a94A35A4569E4529A3CDfB74e38FD98631', 'AERO', 'Aerodrome', 18, 'A', { tint: 'gov', kind: 'token' }),

  // ── Polygon ──
  t(137, '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 'USDC', 'USD Coin', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(137, '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 'USDC.e', 'USD Coin (bridged)', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(137, '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 'USDT', 'Tether USD', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(137, '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', 'DAI', 'Dai', 18, '$', { tint: 'stable', kind: 'stable' }),
  t(137, '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', 'WETH', 'Wrapped Ether', 18, 'Ξ', { tint: 'eth', kind: 'eth' }),
  t(137, '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', 'WBTC', 'Wrapped BTC', 8, '₿', { tint: 'btc', kind: 'btc' }),
  t(137, '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', 'WMATIC', 'Wrapped POL', 18, 'P', { tint: 'poly', kind: 'token' }),
  t(137, '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', 'LINK', 'Chainlink', 18, 'L', { tint: 'gov', kind: 'token' }),
];

// Confidential-token stacks live on this profile's chains.
//
// Zama Protocol has been live on Ethereum mainnet since 2025-12-30 and exposes
// an ENUMERABLE wrapper registry, so its confidential tokens are discovered
// on-chain rather than hardcoded. Inco Lightning went live on Base mainnet on
// 2026-06-15 but ships no registry, so its tokens come from a curated list.
// Fhenix CoFHE has no mainnet deployment — it is testnet-only (see the testnet
// profile).
const FHE_STACKS = [
  {
    id: 'zama',
    name: 'Zama Protocol',
    chainId: 1,
    // Registry deployed on Ethereum, managed by the Zama Protocol DAO.
    // https://docs.zama.org/protocol/protocol-apps/addresses/mainnet/ethereum
    discovery: { type: 'registry', address: '0xeb5015fF021DB115aCe010f23F55C2591059bBA0' },
    // Zama's own chain descriptor key, used by the SDK's chain export.
    sdkChain: 'mainnet',
  },
  {
    id: 'inco',
    name: 'Inco Lightning',
    chainId: 8453,
    // No registry — curated list. Confidential token addresses on Base must be
    // filled in from Inco's deployments before this stack yields anything;
    // an empty list simply means "nothing to discover" (never an error).
    discovery: { type: 'list', tokens: [] },
  },
];

export default {
  mode: 'mainnet',
  label: 'Mainnet',
  testnet: false,
  chains: CHAINS,
  tokens: TOKENS,
  // Price mode: 'live' ⇒ DefiLlama keys are built directly from the chain slug.
  priceMode: 'live',
  // DefiLlama chain slugs (used to build price keys).
  chainSlug: { 1: 'ethereum', 42161: 'arbitrum', 10: 'optimism', 8453: 'base', 137: 'polygon' },
  // Per-chain native token: price key + display metadata. Most chains run on
  // ETH; Polygon's native gas token is POL (different price + symbol/glyph).
  native: {
    1:     { key: 'coingecko:ethereum', symbol: 'ETH', name: 'Ethereum', glyph: 'Ξ', color: TINTS.eth },
    42161: { key: 'coingecko:ethereum', symbol: 'ETH', name: 'Ethereum', glyph: 'Ξ', color: TINTS.eth },
    10:    { key: 'coingecko:ethereum', symbol: 'ETH', name: 'Ethereum', glyph: 'Ξ', color: TINTS.eth },
    8453:  { key: 'coingecko:ethereum', symbol: 'ETH', name: 'Ethereum', glyph: 'Ξ', color: TINTS.eth },
    137:   { key: 'coingecko:polygon-ecosystem-token', symbol: 'POL', name: 'Polygon', glyph: 'P', color: TINTS.poly },
  },
  // Aave v3 Pool (getUserAccountData) per chain.
  aaveV3Pool: {
    1: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    42161: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    10: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    8453: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    137: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  },
  // Display metadata for the chain filter pills + activity rows.
  chainMeta: {
    1: { name: 'Ethereum', cd: 'eth' },
    42161: { name: 'Arbitrum', cd: 'arb' },
    10: { name: 'Optimism', cd: 'op' },
    8453: { name: 'Base', cd: 'base' },
    137: { name: 'Polygon', cd: 'poly' },
  },
  explorer: {
    1: 'https://etherscan.io',
    42161: 'https://arbiscan.io',
    10: 'https://optimistic.etherscan.io',
    8453: 'https://basescan.org',
    137: 'https://polygonscan.com',
  },
  // The CoinGecko token registry (server/index.js) only covers mainnets, so the
  // tier-2 long-tail probe is meaningful here.
  useTokenRegistry: true,
  fheStacks: FHE_STACKS,
};
