// Active network profile — the single place that decides whether the app is in
// mainnet or testnet mode, and the single source of chain/token/FHE config.
//
// WHY A PROFILE LAYER: the chain list, token address book, price keys, explorer
// URLs and chain-filter pills used to be hardcoded in five different files. Two
// network modes means every one of those has to switch together, so they were
// collected into two profile objects and everything downstream now reads from
// the active one. data/public.js and data/tokens.js are kept as thin re-exports
// so no existing import path had to change.
//
// MODE SELECTION (in precedence order):
//   1. A dev-only runtime override in localStorage (Settings → Network), which
//      exists because VITE_ vars are inlined at build time — otherwise flipping
//      modes locally would need a rebuild every time. DEV builds only.
//   2. VITE_NETWORK_MODE=mainnet|testnet
//   3. 'mainnet'
//
// Changing modes must reload the page: profiles are resolved once at module
// load, and half-swapped chain config would paint testnet balances under
// mainnet labels.

import mainnet from './networks.mainnet.js';
import testnet from './networks.testnet.js';

const PROFILES = { mainnet, testnet };

// Read directly rather than importing storage/local.js — this module sits at the
// bottom of the dependency graph and should stay free of app imports.
export const MODE_OVERRIDE_KEY = 'pwai.networkMode';

function readOverride() {
  if (!import.meta.env.DEV) return null;
  try {
    const v = localStorage.getItem(MODE_OVERRIDE_KEY);
    return v && PROFILES[v] ? v : null;
  } catch {
    return null;
  }
}

function resolveMode() {
  const override = readOverride();
  if (override) return override;
  const env = import.meta.env.VITE_NETWORK_MODE;
  if (env && PROFILES[env]) return env;
  if (env) {
    console.warn(`[networks] unknown VITE_NETWORK_MODE "${env}" — falling back to mainnet`);
  }
  return 'mainnet';
}

export const MODE = resolveMode();
export const PROFILE = PROFILES[MODE];
export const IS_TESTNET = PROFILE.testnet;

// --- Dev-only mode switching -------------------------------------------------

export function setModeOverride(mode) {
  if (!import.meta.env.DEV) throw new Error('Network mode override is available in dev builds only');
  if (!PROFILES[mode]) throw new Error(`Unknown network mode "${mode}"`);
  try {
    localStorage.setItem(MODE_OVERRIDE_KEY, mode);
  } catch (err) {
    console.warn('[networks] could not persist mode override', err);
  }
  // Full reload — see the note at the top of this file.
  window.location.reload();
}

export function clearModeOverride() {
  try {
    localStorage.removeItem(MODE_OVERRIDE_KEY);
  } catch {}
  window.location.reload();
}

export const AVAILABLE_MODES = Object.keys(PROFILES).map((m) => ({
  mode: m,
  label: PROFILES[m].label,
  chains: PROFILES[m].chains.map((c) => c.name),
}));

// --- Chain + token config (consumed via data/public.js & data/tokens.js) -----

// `rpc` mirrors the first entry for any caller that reads a single URL.
export const CHAINS = PROFILE.chains.map((c) => ({ ...c, rpc: c.rpcs[0] }));
export const CHAIN_IDS = CHAINS.map((c) => c.chainId);
export const TOKENS = PROFILE.tokens;
export const CHAIN_SLUG = PROFILE.chainSlug;
export const NATIVE_BY_CHAIN = PROFILE.native;
export const AAVE_V3_POOL = PROFILE.aaveV3Pool;
export const CHAIN_META = PROFILE.chainMeta;
export const EXPLORER = PROFILE.explorer;
export const FHE_STACKS = PROFILE.fheStacks;
export const USE_TOKEN_REGISTRY = PROFILE.useTokenRegistry;
export const PRICE_MODE = PROFILE.priceMode;

// Multicall3 is deployed at the same address on every chain in both profiles
// (including all three Sepolia testnets), so this is mode-independent.
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

// --- Pricing ----------------------------------------------------------------

// Testnet tokens are priced through their mainnet twin's key. Built once from
// the profile's token list: "chainId:address" → mainnet DefiLlama key.
const PROXY_KEYS = new Map(
  PROFILE.tokens
    .filter((t) => t.priceKey)
    .map((t) => [`${t.chainId}:${t.address.toLowerCase()}`, t.priceKey])
);

// DefiLlama price key for an ERC-20 on the active profile.
//   mainnet → "ethereum:0x…" built from the chain slug
//   testnet → the token's declared mainnet twin, or null when unknown
// Returns null when the token cannot be priced; callers must filter nulls out
// (an unpriced holding shows its amount with no USD value, which is correct).
export function priceKeyFor(chainId, address) {
  if (!address) return NATIVE_BY_CHAIN[chainId]?.key || null;
  const proxy = PROXY_KEYS.get(`${chainId}:${address.toLowerCase()}`);
  if (proxy) return proxy;
  const slug = CHAIN_SLUG[chainId];
  return slug ? `${slug}:${address.toLowerCase()}` : null;
}

// --- Storage namespacing ----------------------------------------------------

// The IndexedDB chain cache MUST be namespaced by mode. Without this, the
// cache-first paint in useAppFlow would render Sepolia balances into a mainnet
// dashboard on the next load. Wallet addresses and UI prefs are chain-agnostic
// and stay shared across modes.
export const cacheDbName = () => (MODE === 'mainnet' ? 'pwai' : `pwai-${MODE}`);

if (IS_TESTNET) {
  console.info(
    `[networks] TESTNET mode — chains: ${CHAINS.map((c) => c.name).join(', ')}. ` +
      'USD figures are proxied from mainnet prices and are not real value.'
  );
}
