// Static, on-chain-verified addresses for the Ethereum-mainnet DeFi readers in
// ethDefi.js. Everything here was checked against the contracts themselves
// (Morpho idToMarketParams, ERC-4626 name()/asset()), not copied blindly from a
// listing. Morpho Blue has no on-chain "list my markets" call, so we read the
// user's position in a CURATED set of the largest markets and vaults — markets
// outside this list are not seen. Extend the arrays to cover more.

export const ETH = 1;

export const SPARK_POOL = '0xC13e21B648A5Ee794902342038FF3aDAB66BE987'; // SparkLend (Aave v3 fork)

export const MORPHO_BLUE = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';

const tok = (symbol, address, decimals) => ({ symbol, address, decimals });
const USDC = tok('USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6);
const USDT = tok('USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6);
const WETH = tok('WETH', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 18);

export const MORPHO_MARKETS = [
  { id: '0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64', loan: USDC, coll: tok('cbBTC', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', 8), oracle: '0xA6D6950c9F177F1De7f7757FB33539e3Ec60182a', lltv: 0.86 },
  { id: '0x3a85e619751152991742810df6ec69ce473daef99e28a64ab2340d7b7ccfee49', loan: USDC, coll: tok('WBTC', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 8), oracle: '0xDddd770BADd886dF3864029e4B377B5F6a2B6b83', lltv: 0.86 },
  { id: '0xe7e9694b754c4d4f7e21faf7223f6fa71abaeb10296a4c43a54a7977149687d2', loan: USDT, coll: tok('wstETH', '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', 18), oracle: '0x95DB30fAb9A3754e42423000DF27732CB2396992', lltv: 0.86 },
  { id: '0xa921ef34e2fc7a27ccc50ae7e4b154e16c9799d3387076c421423ef52ac4df99', loan: USDT, coll: tok('WBTC', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 8), oracle: '0x008bF4B1cDA0cc9f0e882E0697f036667652E1ef', lltv: 0.86 },
  { id: '0xb8fc70e82bc5bb53e773626fcc6a23f7eefa036918d7ef216ecfb1950a94a85e', loan: WETH, coll: tok('wstETH', '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', 18), oracle: '0xbD60A6770b27E084E8617335ddE769241B0e71D8', lltv: 0.965 },
  { id: '0x85252bb8485c99bba46fe149c7dd2aad83672640f53c630890673cf1848ba16e', loan: USDC, coll: tok('weETH', '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee', 18), oracle: '0xa3A7A3ceFee206f9d7Fe00eC3C83324ED4228411', lltv: 0.86 },
  { id: '0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc', loan: USDC, coll: tok('wstETH', '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', 18), oracle: '0x48F7E36EB6B826B2dF4B2E630B62Cd25e89E40e2', lltv: 0.86 },
];

// MetaMorpho (ERC-4626) vaults: shares → assets via convertToAssets.
export const MORPHO_VAULTS = [
  { address: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB', name: 'Steakhouse USDC', asset: USDC },
  { address: '0xbEef047a543E45807105E51A8BBEFCc5950fcfBa', name: 'Steakhouse USDT', asset: USDT },
  { address: '0xdd0f28e19C1780eb6396170735D45153D261490d', name: 'Gauntlet USDC Prime', asset: USDC },
  { address: '0xA0804346780b4c2e3bE118ac957D1DB82F9d7484', name: 'Smokehouse USDT', asset: USDT },
  { address: '0xBEeFFF209270748ddd194831b3fa287a5386f5bC', name: 'Smokehouse USDC', asset: USDC },
  { address: '0x94643e86aa5E38DDAc6c7791C1297f4E40cD96c1', name: '1337 USDC', asset: USDC },
];

// Uniswap v3 (Ethereum mainnet).
export const UNI_V3_NPM = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
export const UNI_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
