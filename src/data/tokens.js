// Token registry + on-chain address book for the ACTIVE network profile.
//
// The address book itself now lives in src/config/networks.{mainnet,testnet}.js;
// this module is the stable import surface over whichever profile is active, so
// its consumers never need to know which mode the app is in:
//   - balances.js  → which ERC-20s to probe via Multicall3 balanceOf
//   - prices.js    → DefiLlama price keys + decoy pool
//   - defi.js      → Aave v3 pool address + which holdings are staking positions
//
// See config/networks.js for how the mode is resolved and how testnet tokens are
// priced through their mainnet twins.

import {
  TOKENS,
  CHAIN_SLUG,
  NATIVE_BY_CHAIN,
  AAVE_V3_POOL,
  MULTICALL3,
  priceKeyFor,
} from '../config/networks.js';

export { TOKENS, CHAIN_SLUG, NATIVE_BY_CHAIN, AAVE_V3_POOL, MULTICALL3 };

export const tokensForChain = (chainId) => TOKENS.filter((t) => t.chainId === chainId);

// Normalize a discovered token (from the registry or Etherscan history) into the
// full shape balances.js + the portfolio builder expect. Curated TOKENS are
// already in this shape; this fills sane defaults for everything else.
export function makeToken(chainId, { address, symbol, name, decimals } = {}) {
  const sym = symbol || '?';
  return {
    chainId,
    address,
    symbol: sym,
    name: name || sym || 'Unknown',
    decimals: decimals ?? 18,
    glyph: sym[0] || '•',
    color: null,
    kind: 'token',
    protocol: null,
    label: null,
  };
}

export const findToken = (chainId, address) =>
  TOKENS.find((t) => t.chainId === chainId && t.address.toLowerCase() === address?.toLowerCase());

// DefiLlama price key for an ERC-20. Mode-aware: on mainnet this is
// "{chainSlug}:{address}"; on testnet it resolves to the token's mainnet twin,
// or null when the token has no declared twin (⇒ unpriced, amount only).
export const llamaKey = priceKeyFor;

// Native gas token price key for a chain, plus display metadata.
export const nativeFor = (chainId) => NATIVE_BY_CHAIN[chainId] || Object.values(NATIVE_BY_CHAIN)[0];

// Kept for callers that want "the" native key without a chain in hand. On any
// profile whose chains are all ETH-based this is ETH; it is only ever a
// fallback — prefer nativeFor(chainId).
export const NATIVE_LLAMA_KEY = Object.values(NATIVE_BY_CHAIN)[0]?.key || 'coingecko:ethereum';
