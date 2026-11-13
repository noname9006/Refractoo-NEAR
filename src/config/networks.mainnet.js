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
  bnb: { bg: '#fdf6e1', fg: '#c99400' },
  mnt: { bg: '#e8f5f3', fg: '#0d8a7b' },
  avax: { bg: '#fdeaea', fg: '#e84142' },
  celo: { bg: '#fdfbe0', fg: '#a89a00' },
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
  {
    chainId: 56,
    name: 'BNB Chain',
    symbol: 'BNB',
    rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'],
  },
  {
    chainId: 5000,
    name: 'Mantle',
    symbol: 'MNT',
    rpcs: ['https://mantle-rpc.publicnode.com', 'https://rpc.mantle.xyz'],
  },
  {
    chainId: 169,
    name: 'Manta Pacific',
    symbol: 'ETH',
    rpcs: ['https://pacific-rpc.manta.network/http', 'https://manta-pacific.drpc.org'],
  },
  {
    chainId: 43114,
    name: 'Avalanche',
    symbol: 'AVAX',
    rpcs: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://api.avax.network/ext/bc/C/rpc'],
  },
  {
    chainId: 100,
    name: 'Gnosis',
    symbol: 'XDAI',
    rpcs: ['https://gnosis-rpc.publicnode.com', 'https://rpc.gnosischain.com'],
  },
  // zkSync Era: Multicall3 is live at the canonical address (verified
  // 2026-11-14), so it needs no special casing.
  {
    chainId: 324,
    name: 'zkSync Era',
    symbol: 'ETH',
    rpcs: ['https://mainnet.era.zksync.io', 'https://zksync.drpc.org'],
  },
  {
    chainId: 534352,
    name: 'Scroll',
    symbol: 'ETH',
    rpcs: ['https://scroll-rpc.publicnode.com', 'https://rpc.scroll.io'],
  },
  {
    chainId: 42220,
    name: 'Celo',
    symbol: 'CELO',
    rpcs: ['https://celo-rpc.publicnode.com', 'https://forno.celo.org'],
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
  // ── BNB Chain (Binance-peg stables use 18 decimals) ──
  t(56, '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 'USDC', 'USD Coin', 18, '$', { tint: 'stable', kind: 'stable' }),
  t(56, '0x55d398326f99059fF775485246999027B3197955', 'USDT', 'Tether USD', 18, '$', { tint: 'stable', kind: 'stable' }),
  t(56, '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', 'WBNB', 'Wrapped BNB', 18, 'B', { tint: 'bnb', kind: 'token' }),
  t(56, '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', 'ETH', 'Ethereum (BNB Chain)', 18, 'Ξ', { tint: 'eth', kind: 'eth' }),
  t(56, '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', 'BTCB', 'Bitcoin BEP2', 18, '₿', { tint: 'btc', kind: 'btc' }),
  // ── Mantle ──
  t(5000, '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9', 'USDC', 'USD Coin', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(5000, '0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE', 'USDT', 'Tether USD', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(5000, '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8', 'WMNT', 'Wrapped Mantle', 18, 'M', { tint: 'mnt', kind: 'token' }),
  t(5000, '0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111', 'WETH', 'Wrapped Ether', 18, 'Ξ', { tint: 'eth', kind: 'eth' }),
  t(5000, '0xcDA86A272531e8640cD7F1a92c01839911B90bb0', 'mETH', 'Mantle Staked Ether', 18, 'Ξ', { tint: 'stake', kind: 'eth', protocol: 'Mantle LSP', label: 'Staking' }),
  // ── Manta Pacific ──
  t(169, '0x0Dc808adcE2099A9F62AA87D9670745AbA741746', 'WETH', 'Wrapped Ether', 18, 'Ξ', { tint: 'eth', kind: 'eth' }),
  t(169, '0xb73603C5d87fA094B7314C74ACE2e64D165016fb', 'USDC', 'USD Coin', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(169, '0xf417F5A458eC102B90352F697D6e2Ac3A3d2851f', 'USDT', 'Tether USD', 6, '$', { tint: 'stable', kind: 'stable' }),
  // ── Avalanche ──
  t(43114, '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', 'USDC', 'USD Coin', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(43114, '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', 'USDT', 'Tether USD', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(43114, '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', 'WAVAX', 'Wrapped AVAX', 18, 'A', { tint: 'avax', kind: 'token' }),
  t(43114, '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', 'WETH.e', 'Wrapped Ether', 18, 'Ξ', { tint: 'eth', kind: 'eth' }),
  t(43114, '0x152b9d0FdC40C096757F570A51E494bd4b943E50', 'BTC.b', 'Bitcoin', 8, '₿', { tint: 'btc', kind: 'btc' }),
  // ── Gnosis ──
  t(100, '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d', 'WXDAI', 'Wrapped xDAI', 18, '$', { tint: 'stable', kind: 'stable' }),
  t(100, '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83', 'USDC', 'USD Coin', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(100, '0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1', 'WETH', 'Wrapped Ether', 18, 'Ξ', { tint: 'eth', kind: 'eth' }),
  t(100, '0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb', 'GNO', 'Gnosis', 18, 'G', { tint: 'gov', kind: 'token' }),
  // ── zkSync Era ──
  t(324, '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4', 'USDC', 'USD Coin', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(324, '0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4', 'USDC.e', 'USD Coin (bridged)', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(324, '0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91', 'WETH', 'Wrapped Ether', 18, 'Ξ', { tint: 'eth', kind: 'eth' }),
  t(324, '0x5A7d6b2F92C77FAD6CCaBd7EE0624E64907Eaf3E', 'ZK', 'ZKsync', 18, 'Z', { tint: 'gov', kind: 'token' }),
  // ── Scroll ──
  t(534352, '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4', 'USDC', 'USD Coin', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(534352, '0xf55BEC9cafDbE8730f096Aa55dad6D22d44099Df', 'USDT', 'Tether USD', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(534352, '0x5300000000000000000000000000000000000004', 'WETH', 'Wrapped Ether', 18, 'Ξ', { tint: 'eth', kind: 'eth' }),
  // ── Celo (CELO is native; its ERC-20 twin 0x471E… is left out so it isn't counted twice) ──
  t(42220, '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', 'USDC', 'USD Coin', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(42220, '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', 'USDT', 'Tether USD', 6, '$', { tint: 'stable', kind: 'stable' }),
  t(42220, '0x765DE816845861e75A25fCA122bb6898B8B1282a', 'USDm', 'Mento Dollar', 18, '$', { tint: 'stable', kind: 'stable' }),
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
  chainSlug: {
    1: 'ethereum', 42161: 'arbitrum', 10: 'optimism', 8453: 'base', 137: 'polygon',
    56: 'bsc', 5000: 'mantle', 169: 'manta', 43114: 'avax', 100: 'xdai', 324: 'era', 534352: 'scroll', 42220: 'celo',
  },
  // Per-chain native token: price key + display metadata. Most chains run on
  // ETH; Polygon's native gas token is POL (different price + symbol/glyph).
  native: {
    1:     { key: 'coingecko:ethereum', symbol: 'ETH', name: 'Ethereum', glyph: 'Ξ', color: TINTS.eth },
    42161: { key: 'coingecko:ethereum', symbol: 'ETH', name: 'Ethereum', glyph: 'Ξ', color: TINTS.eth },
    10:    { key: 'coingecko:ethereum', symbol: 'ETH', name: 'Ethereum', glyph: 'Ξ', color: TINTS.eth },
    8453:  { key: 'coingecko:ethereum', symbol: 'ETH', name: 'Ethereum', glyph: 'Ξ', color: TINTS.eth },
    137:   { key: 'coingecko:polygon-ecosystem-token', symbol: 'POL', name: 'Polygon', glyph: 'P', color: TINTS.poly },
    56:    { key: 'coingecko:binancecoin', symbol: 'BNB', name: 'BNB', glyph: 'B', color: TINTS.bnb },
    5000:  { key: 'coingecko:mantle', symbol: 'MNT', name: 'Mantle', glyph: 'M', color: TINTS.mnt },
    169:   { key: 'coingecko:ethereum', symbol: 'ETH', name: 'Ethereum', glyph: 'Ξ', color: TINTS.eth },
    43114: { key: 'coingecko:avalanche-2', symbol: 'AVAX', name: 'Avalanche', glyph: 'A', color: TINTS.avax },
    100:   { key: 'coingecko:xdai', symbol: 'XDAI', name: 'xDAI', glyph: '$', color: TINTS.stable },
    324:   { key: 'coingecko:ethereum', symbol: 'ETH', name: 'Ethereum', glyph: 'Ξ', color: TINTS.eth },
    534352: { key: 'coingecko:ethereum', symbol: 'ETH', name: 'Ethereum', glyph: 'Ξ', color: TINTS.eth },
    42220: { key: 'coingecko:celo', symbol: 'CELO', name: 'Celo', glyph: 'C', color: TINTS.celo },
  },
  // Aave v3 Pool (getUserAccountData) per chain.
  aaveV3Pool: {
    1: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    42161: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    10: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    8453: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    137: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    56: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB',
    43114: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    100: '0xb50201558B00496A145fE76f7424749556E326D8',
    324: '0x78e30497a3c7527d953c6B1E3541b021A98Ac43c',
    534352: '0x11fCfe756c05AD438e312a7fd934381537D3cFfe',
    42220: '0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402',
  },
  // Display metadata for the chain filter pills + activity rows.
  chainMeta: {
    1: { name: 'Ethereum', cd: 'eth' },
    42161: { name: 'Arbitrum', cd: 'arb' },
    10: { name: 'Optimism', cd: 'op' },
    8453: { name: 'Base', cd: 'base' },
    137: { name: 'Polygon', cd: 'poly' },
    56: { name: 'BNB Chain', cd: 'bnb' },
    5000: { name: 'Mantle', cd: 'mnt' },
    169: { name: 'Manta Pacific', cd: 'manta' },
    43114: { name: 'Avalanche', cd: 'avax' },
    100: { name: 'Gnosis', cd: 'gno' },
    324: { name: 'zkSync Era', cd: 'zk' },
    534352: { name: 'Scroll', cd: 'scroll' },
    42220: { name: 'Celo', cd: 'celo' },
  },
  explorer: {
    1: 'https://etherscan.io',
    42161: 'https://arbiscan.io',
    10: 'https://optimistic.etherscan.io',
    8453: 'https://basescan.org',
    137: 'https://polygonscan.com',
    56: 'https://bscscan.com',
    5000: 'https://mantlescan.xyz',
    169: 'https://pacific-explorer.manta.network',
    43114: 'https://snowtrace.io',
    100: 'https://gnosisscan.io',
    324: 'https://era.zksync.network',
    534352: 'https://scrollscan.com',
    42220: 'https://celoscan.io',
  },
  // The CoinGecko token registry (server/index.js) only covers mainnets, so the
  // tier-2 long-tail probe is meaningful here.
  useTokenRegistry: true,
  fheStacks: FHE_STACKS,
};
