import { getActiveProvider } from '../data/evmWallets.js';
// Inco Lightning adapter.
//
// Inco went live on Base mainnet on 2026-06-15 (Base Sepolia for testnet). Its
// confidential tokens hold balances as 32-byte handles, same idea as the other
// stacks, but two things about Inco are genuinely different and shape this file:
//
//  1. TEE, NOT THRESHOLD FHE. Decryption runs inside trusted execution
//     environments operated by a covalidator network ("attested decrypt"). That
//     is a HARDWARE trust assumption, not a cryptographic one — materially weaker
//     than Zama's or Fhenix's threshold committees. meta.trust says so, and the
//     Shielded card surfaces it to the user rather than lumping all three stacks
//     under one "encrypted" badge.
//
//  2. NO REGISTRY. Inco ships no wrapper registry, so there is nothing to
//     enumerate — confidential token addresses come from the network profile
//     (VITE_INCO_TESTNET_TOKENS, or the curated mainnet list). An empty list
//     means "nothing to discover", never an error.
//
// The SDK is viem-native and wants a viem WalletClient, while this app is
// ethers-v6 throughout. Rather than migrate anything, reveal() builds a minimal
// viem WalletClient over the same EIP-1193 provider the ethers BrowserProvider is
// already using — one wallet, two client objects, no second connection.

import { Interface } from 'ethers';
import { multicall, call, decode } from '../data/multicall.js';

export const meta = {
  id: 'inco',
  name: 'Inco Lightning',
  trust: 'tee',
  relayer: 'Inco covalidator network (TEE attested decrypt)',
  docs: 'https://docs.inco.org',
};

// Inco's confidential ERC-20 returns an encrypted handle from its balance getter.
// The getter name is configurable per token because Inco defines no single
// standard interface the way ERC-7984 does.
const getterIface = (getter) =>
  new Interface([`function ${getter}(address account) view returns (bytes32)`]);

const META = new Interface([
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
]);

const ZERO_HANDLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

// Static factory per chain, from the SDK's own deployment metadata.
const LIGHTNING_FACTORY = {
  8453: 'baseMainnet',
  84532: 'baseSepoliaTestnet',
};

export async function discover({ owners, chain, stack, rpcOverride }) {
  const tokens = stack?.discovery?.tokens || [];
  if (!tokens.length) return [];

  const perToken = 3 + owners.length;
  const calls = [];
  for (const t of tokens) {
    const getter = t.getter || 'balanceOf';
    const iface = getterIface(getter);
    calls.push(call(META, t.address, 'symbol'));
    calls.push(call(META, t.address, 'name'));
    calls.push(call(META, t.address, 'decimals'));
    for (const o of owners) calls.push(call(iface, t.address, getter, [o]));
  }

  const { results } = await multicall(chain, calls, rpcOverride);

  const out = [];
  tokens.forEach((t, i) => {
    const base = i * perToken;
    const getter = t.getter || 'balanceOf';
    const iface = getterIface(getter);
    // Config-supplied metadata wins over the on-chain read, so a token whose
    // getters revert can still be labelled from the profile.
    const symbol = t.symbol || decode(META, 'symbol', results[base], null);
    if (!symbol) return;
    const name = t.name || decode(META, 'name', results[base + 1], symbol);
    const decRaw = t.decimals ?? decode(META, 'decimals', results[base + 2], null);
    const decimals = decRaw == null ? 18 : Number(decRaw);

    owners.forEach((owner, j) => {
      const handle = decode(iface, getter, results[base + 3 + j], null);
      if (!handle || handle === ZERO_HANDLE) return;
      out.push({
        stack: 'inco',
        chainId: chain.chainId,
        chainName: chain.name,
        wallet: owner,
        address: t.address,
        symbol,
        name,
        decimals,
        // Set in the profile when the confidential token wraps a known ERC-20,
        // which is what lets it be priced.
        underlying: t.underlying || null,
        handle: String(handle),
        state: 'encrypted',
        amount: null,
        usd: null,
        change24h: null,
        error: null,
      });
    });
  });

  return out;
}

// --- reveal ------------------------------------------------------------------

const lightningCache = new Map();

async function getLightning(chain) {
  if (lightningCache.has(chain.chainId)) return lightningCache.get(chain.chainId);
  const factory = LIGHTNING_FACTORY[chain.chainId];
  if (!factory) throw new Error(`Inco Lightning is not deployed on ${chain.name}`);

  const { Lightning } = await import('@inco/lightning-js/lite');
  // Pass the profile's RPC list so Inco reads through the same endpoints (and
  // viem's fallback transport) as the rest of the app, instead of its own default.
  const instance = await Lightning[factory]({ hostChainRpcUrls: chain.rpcs });
  lightningCache.set(chain.chainId, instance);
  return instance;
}

// Build a viem WalletClient over the wallet's EIP-1193 provider. The SDK is
// viem-native; the app is ethers. Both talk to the same injected provider, so
// this adds a client object, not a second wallet connection.
async function getWalletClient(chain, provider) {
  const eip1193 = provider?.provider ?? getActiveProvider();
  if (!eip1193) throw new Error('No EIP-1193 wallet provider available for Inco');

  const [{ createWalletClient, custom }, { getViemChain }] = await Promise.all([
    import('viem'),
    import('@inco/lightning-js'),
  ]);

  const [account] = await eip1193.request({ method: 'eth_requestAccounts' });
  return createWalletClient({
    account,
    chain: getViemChain(chain.chainId),
    transport: custom(eip1193),
  });
}

// Decrypt one handle via attested decrypt. The covalidator signs an attestation
// over the plaintext, which lands in this browser and nowhere else.
//
// NOTE: attestedDecrypt accepts an ARRAY of handles, so Inco could reveal a whole
// wallet in one round-trip. The shared adapter interface is per-holding, so
// "reveal all" currently costs one call per token — correct, just not optimal. A
// batch hook on the interface would be the fix if it ever matters.
export async function reveal({ token, provider, chain }) {
  const [lightning, walletClient] = await Promise.all([
    getLightning(chain),
    getWalletClient(chain, provider),
  ]);

  const attestations = await lightning.attestedDecrypt(walletClient, [token.handle]);
  const value = attestations?.[0]?.plaintext?.value;
  if (value == null) throw new Error('Inco returned no plaintext for this handle');
  return BigInt(value);
}

export async function dispose() {
  lightningCache.clear();
}
