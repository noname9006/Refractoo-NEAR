// Zama Protocol adapter — ERC-7984 confidential tokens.
//
// Zama has been live on Ethereum mainnet since 2025-12-30. Its confidential
// tokens are ERC-20 wrappers ("shielded" USDC, USDT, WETH, …) registered in an
// on-chain Confidential Token Wrappers Registry, which is ENUMERABLE — so unlike
// the other two stacks this one gets real discovery instead of a curated list.
//
// SPLIT BY DESIGN:
//
//   discover() uses PLAIN ETHERS + Multicall3 and never touches @zama-fhe/sdk.
//   The SDK carries a multi-megabyte TFHE WASM bundle and spins up a Web Worker;
//   pulling that in just to learn "this wallet holds three confidential tokens"
//   would put it on the dashboard's critical path. Registry reads and
//   confidentialBalanceOf are ordinary view calls, so discovery costs one
//   multicall per chain and contacts no relayer at all.
//
//   reveal() lazily imports the SDK, because actual decryption genuinely needs
//   it: an EIP-712 permit, an ML-KEM transport keypair, and a relayer round-trip.
//
// ABI note: the function signatures below were taken from @zama-fhe/sdk's own
// contract helpers (getTokenPairsSliceContract, confidentialBalanceOfContract,
// …), not from prose docs, so they match what the SDK itself calls on-chain.

import { Interface } from 'ethers';
import { multicall, call, decode } from '../data/multicall.js';
import { memoryStorage } from './memory-storage.js';

export const meta = {
  id: 'zama',
  name: 'Zama Protocol',
  trust: 'threshold-fhe',
  relayer: 'Zama-operated relayer (relayer.*.zama.org)',
  docs: 'https://docs.zama.org/protocol',
};

// Registry addresses, mirrored from the SDK's own chain descriptors
// (@zama-fhe/sdk/chains → mainnet.registryAddress / sepolia.registryAddress).
// Used only as a fallback when the network profile doesn't pin one.
const REGISTRY_BY_CHAIN = {
  1: '0xeb5015fF021DB115aCe010f23F55C2591059bBA0',
  11155111: '0x2f0750Bbb0A246059d80e94c454586a7F27a128e',
};

// The SDK's chain-descriptor export name per chain id, for reveal().
const SDK_CHAIN_BY_ID = { 1: 'mainnet', 11155111: 'sepolia', 560048: 'hoodi', 97: 'bscTestnet' };

const REGISTRY = new Interface([
  'function getTokenConfidentialTokenPairsLength() view returns (uint256)',
  'function getTokenConfidentialTokenPairsSlice(uint256 fromIndex, uint256 toIndex) view returns ((address tokenAddress, address confidentialTokenAddress, bool isValid)[])',
]);

const ERC7984 = new Interface([
  'function confidentialBalanceOf(address account) view returns (bytes32)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function underlying() view returns (address)',
]);

const ZERO_HANDLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

// Registry pairs change rarely (a DAO vote adds a wrapper), so they're cached for
// the session. Not persisted: the list is small and one multicall re-reads it.
const pairsCache = new Map(); // chainId → { pairs, at }
const PAIRS_TTL_MS = 30 * 60 * 1000;

// Registry slices are read in windows so a registry that grows to hundreds of
// pairs doesn't produce one oversized return payload.
const SLICE = 200;

async function fetchPairs(chain, registry, rpcOverride) {
  const hit = pairsCache.get(chain.chainId);
  if (hit && Date.now() - hit.at < PAIRS_TTL_MS) return hit.pairs;

  const lenRes = await multicall(
    chain,
    [call(REGISTRY, registry, 'getTokenConfidentialTokenPairsLength')],
    rpcOverride
  );
  const len = Number(decode(REGISTRY, 'getTokenConfidentialTokenPairsLength', lenRes.results[0], 0n));
  if (!len) {
    pairsCache.set(chain.chainId, { pairs: [], at: Date.now() });
    return [];
  }

  const slices = [];
  for (let from = 0; from < len; from += SLICE) {
    slices.push(call(REGISTRY, registry, 'getTokenConfidentialTokenPairsSlice', [from, Math.min(from + SLICE, len)]));
  }
  const sliceRes = await multicall(chain, slices, rpcOverride);

  const pairs = [];
  for (const r of sliceRes.results) {
    const rows = decode(REGISTRY, 'getTokenConfidentialTokenPairsSlice', r, null);
    if (!rows) continue;
    for (const row of rows) {
      // ALWAYS check isValid: a revoked wrapper keeps a non-zero address in the
      // registry, and treating it as live would show a balance in a token the
      // DAO has de-listed.
      if (!row.isValid) continue;
      pairs.push({
        underlying: String(row.tokenAddress),
        confidential: String(row.confidentialTokenAddress),
      });
    }
  }

  pairsCache.set(chain.chainId, { pairs, at: Date.now() });
  return pairs;
}

// Discover confidential holdings for a set of owners on one chain.
//
// Returns one entry per (wrapper, owner) whose ciphertext handle is non-zero.
// A NON-ZERO HANDLE DOES NOT MEAN A NON-ZERO BALANCE — it only means a ciphertext
// exists for that account. The amount is unknowable without decrypting, which is
// why every entry starts in state 'encrypted' and carries no amount.
export async function discover({ owners, chain, stack, rpcOverride }) {
  const registry = stack?.discovery?.address || REGISTRY_BY_CHAIN[chain.chainId];
  if (!registry) return [];

  const pairs = await fetchPairs(chain, registry, rpcOverride);
  if (!pairs.length) return [];

  // One flat call list: per wrapper, four metadata reads then one
  // confidentialBalanceOf per owner. Owners are call ARGUMENTS, not targets, so a
  // multi-wallet cluster costs roughly the same as a single wallet.
  const perToken = 4 + owners.length;
  const calls = [];
  for (const p of pairs) {
    calls.push(call(ERC7984, p.confidential, 'symbol'));
    calls.push(call(ERC7984, p.confidential, 'name'));
    calls.push(call(ERC7984, p.confidential, 'decimals'));
    calls.push(call(ERC7984, p.confidential, 'underlying'));
    for (const o of owners) calls.push(call(ERC7984, p.confidential, 'confidentialBalanceOf', [o]));
  }

  const { results } = await multicall(chain, calls, rpcOverride);

  const out = [];
  pairs.forEach((p, i) => {
    const base = i * perToken;
    const symbol = decode(ERC7984, 'symbol', results[base], null);
    // No symbol ⇒ the whole metadata read failed (dead address, wrong chain).
    // Skip rather than emitting a nameless row.
    if (!symbol) return;
    const name = decode(ERC7984, 'name', results[base + 1], symbol);
    // The wrapper's own decimals already account for its `rate` — the
    // underlying-to-confidential scaling that keeps balances inside a euint64 —
    // so raw / 10**decimals is directly comparable to the UNDERLYING's unit price
    // and no rate math is needed here.
    //
    // Verified against mainnet rather than assumed:
    //   cUSDC  decimals=6, rate=1      underlying USDC (6dp)  → raw/1e6 = USD
    //   cWETH  decimals=6, rate=1e12   underlying WETH (18dp) → raw/1e6 = ETH
    // For cWETH: underlying wei = raw × 1e12, and 1e12/1e18 = 1e-6, so dividing
    // by 10**6 lands on whole ETH. Both cases collapse to raw / 10**decimals.
    const decimalsRaw = decode(ERC7984, 'decimals', results[base + 2], null);
    const decimals = decimalsRaw == null ? 18 : Number(decimalsRaw);
    // Prefer the wrapper's own underlying() over the registry's pairing — same
    // value in practice, but the token is the authority on what it wraps.
    const underlying = decode(ERC7984, 'underlying', results[base + 3], null) || p.underlying;

    owners.forEach((owner, j) => {
      const handle = decode(ERC7984, 'confidentialBalanceOf', results[base + 4 + j], null);
      if (!handle || handle === ZERO_HANDLE) return;
      out.push({
        stack: 'zama',
        chainId: chain.chainId,
        chainName: chain.name,
        wallet: owner,
        address: p.confidential,
        symbol,
        name,
        decimals,
        underlying: underlying ? String(underlying) : null,
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

// One SDK instance per chain, per page load.
const sdkCache = new Map();

async function getSdk({ chain, provider, signer }) {
  if (sdkCache.has(chain.chainId)) return sdkCache.get(chain.chainId);

  const chainKey = SDK_CHAIN_BY_ID[chain.chainId];
  if (!chainKey) throw new Error(`Zama Protocol is not deployed on ${chain.name}`);

  const [{ ZamaSDK }, { createConfig }, { web }, chains] = await Promise.all([
    import('@zama-fhe/sdk'),
    import('@zama-fhe/sdk/ethers'),
    import('@zama-fhe/sdk/web'),
    import('@zama-fhe/sdk/chains'),
  ]);

  const fheChain = chains[chainKey];
  if (!fheChain) throw new Error(`@zama-fhe/sdk has no chain descriptor "${chainKey}"`);

  const config = createConfig({
    chains: [fheChain],
    signer,
    provider,
    relayers: { [fheChain.id]: web() },
    // PRIVACY: the SDK defaults to IndexedDB here, which would persist decrypted
    // balances to disk. See memory-storage.js — this is deliberate.
    storage: memoryStorage,
    permitStorage: memoryStorage,
  });

  const sdk = new ZamaSDK(config);
  sdkCache.set(chain.chainId, sdk);
  return sdk;
}

// Decrypt one holding's balance. Prompts an EIP-712 signature the first time a
// permit is needed (once per token per page load, since permits are held in
// memory only). Returns the raw amount as a bigint — scaling by `decimals` is the
// caller's job.
export async function reveal({ token, owner, provider, signer, chain }) {
  if (!signer) throw new Error('Connect a wallet to reveal confidential balances');
  const sdk = await getSdk({ chain, provider, signer });
  const t = sdk.createToken(token.address);
  return t.balanceOf(owner);
}

// Drop cached SDK instances + their workers. Called when the wallet disconnects
// so a stale signer can't be reused, and to release the WASM worker.
export async function dispose() {
  for (const sdk of sdkCache.values()) {
    try {
      await sdk.dispose?.();
    } catch (err) {
      console.warn('[zama] dispose failed', err);
    }
  }
  sdkCache.clear();
}
