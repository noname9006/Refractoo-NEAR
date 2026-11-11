// Fhenix CoFHE adapter.
//
// This is the app's original src/data/sealed.js flow, restructured to the shared
// adapter interface (see src/fhe/index.js). The cryptographic flow is unchanged:
// create a client for the CoFHE-enabled chain → connect through the Ethers6
// adapter → self permit (one wallet signature) → read the encrypted handle from
// the contract → decryptForView IN THE BROWSER.
//
// TESTNET ONLY, by necessity: CoFHE has no mainnet deployment. It is live on
// Ethereum Sepolia, Arbitrum Sepolia and Base Sepolia, which is the whole reason
// the app has a testnet mode at all.
//
// NO TOKEN STANDARD: unlike Zama's ERC-7984 wrappers, CoFHE ships no
// confidential-token standard and no registry, so there is nothing to enumerate.
// "Confidential holdings" here are whatever contracts the network profile points
// at — each declaring its own getter and FHE type. contracts/ConfidentialDemo.sol
// is one such entry, deliberately just an item in a list.

import { Interface } from 'ethers';
import { multicall, call, decode } from '../data/multicall.js';
import { memoryStorage } from './memory-storage.js';

export const meta = {
  id: 'cofhe',
  name: 'Fhenix CoFHE',
  trust: 'threshold-fhe',
  relayer: 'Fhenix CoFHE threshold network',
  docs: 'https://cofhe-docs.fhenix.zone',
};

// Each configured contract declares its own getter name, so this Interface is
// built per entry rather than shared.
const getterIface = (getter) =>
  new Interface([`function ${getter}(address user) view returns (uint256)`]);

const ZERO = 0n;

// Probe every configured contract for a non-zero ciphertext handle.
//
// CoFHE handles are uint256 ctHashes rather than bytes32 euint handles, but the
// semantics match every other stack: a non-zero handle proves a ciphertext
// exists, NOT that the value is non-zero.
export async function discover({ owners, chain, stack, rpcOverride }) {
  const contracts = stack?.discovery?.tokens || [];
  if (!contracts.length) return [];

  const calls = [];
  const plan = [];
  for (const c of contracts) {
    const getter = c.getter || 'getSealedBalance';
    const iface = getterIface(getter);
    for (const owner of owners) {
      calls.push(call(iface, c.address, getter, [owner]));
      plan.push({ contract: c, owner, iface, getter });
    }
  }

  const { results } = await multicall(chain, calls, rpcOverride);

  const out = [];
  plan.forEach((p, i) => {
    const handle = decode(p.iface, p.getter, results[i], null);
    if (handle == null || BigInt(handle) === ZERO) return;
    out.push({
      stack: 'cofhe',
      chainId: chain.chainId,
      chainName: chain.name,
      wallet: p.owner,
      address: p.contract.address,
      symbol: p.contract.symbol || 'SEALED',
      name: p.contract.name || 'CoFHE sealed value',
      // A CoFHE sealed value is a raw encrypted number, not a token balance, so
      // its profile entry declares decimals explicitly (0 for the demo counter).
      decimals: p.contract.decimals ?? 0,
      // No wrapped ERC-20 ⇒ no price feed. The revealed amount shows as a plain
      // number with no USD value, which is the honest presentation.
      underlying: null,
      handle: String(handle),
      fheType: p.contract.fheType || 'uint128',
      state: 'encrypted',
      amount: null,
      usd: null,
      change24h: null,
      error: null,
    });
  });

  return out;
}

// --- reveal ------------------------------------------------------------------

// One client per chain, per page load.
const clients = new Map();

async function getClient({ chain, provider, signer }) {
  if (clients.has(chain.chainId)) return clients.get(chain.chainId);

  const [{ createCofheConfig, createCofheClient }, { Ethers6Adapter }, { getChainById }] =
    await Promise.all([
      import('@cofhe/sdk/web'),
      import('@cofhe/sdk/adapters'),
      import('@cofhe/sdk/chains'),
    ]);

  // Resolved by the SDK rather than a local name map — @cofhe/sdk exports its
  // Sepolia descriptor as `sepolia` (not `ethSepolia`), and getChainById keeps us
  // from having to track names like that at all.
  const sdkChain = getChainById(chain.chainId);
  if (!sdkChain) throw new Error(`CoFHE is not deployed on ${chain.name}`);

  const config = createCofheConfig({
    environment: 'web',
    supportedChains: [sdkChain],
    // fheKeyStorage caches the FHE public key + CRS — public parameters, not
    // secrets. But @cofhe/sdk's DEFAULT web backend is a third-party
    // cross-origin iframe (iframe-shared-storage.vercel.app), which this app
    // must not embed: it is an unnecessary third-party origin in a
    // privacy-first app, and under our COEP: credentialless header a
    // cross-origin iframe without CORP headers gets blocked — the SDK would
    // then sit on its 30s iframeReadyTimeoutMs before failing.
    //
    // Passing our own in-memory store sidesteps both. The cost is re-fetching
    // the public key + CRS once per page load; the alternative is an embedded
    // third-party frame that probably doesn't work here anyway.
    fheKeyStorage: memoryStorage,
  });
  const client = createCofheClient(config);
  const { publicClient, walletClient } = await Ethers6Adapter(provider, signer);
  await client.connect(publicClient, walletClient);

  // One self-permit per client covers every sealed value the user can read.
  await client.permits.getOrCreateSelfPermit();

  clients.set(chain.chainId, client);
  return client;
}

const FHE_TYPE = {
  uint8: 'Uint8',
  uint16: 'Uint16',
  uint32: 'Uint32',
  uint64: 'Uint64',
  uint128: 'Uint128',
  uint256: 'Uint256',
  bool: 'Bool',
  address: 'Address',
};

export async function reveal({ token, provider, signer, chain }) {
  if (!signer) throw new Error('Connect a wallet to reveal confidential balances');
  const [client, { FheTypes }] = await Promise.all([
    getClient({ chain, provider, signer }),
    import('@cofhe/sdk'),
  ]);
  const typeKey = FHE_TYPE[token.fheType || 'uint128'] || 'Uint128';
  const fheType = FheTypes[typeKey];
  if (fheType == null) throw new Error(`Unsupported CoFHE type "${token.fheType}"`);
  const value = await client.decryptForView(BigInt(token.handle), fheType);
  return BigInt(value);
}

// Encrypt a value client-side and store it in a CoFHE demo contract, so there is
// something to discover and reveal. Ported from the pre-refactor data/sealed.js —
// CoFHE has no confidential-token standard, so unlike Zama/Inco there is no
// existing on-chain balance to find unless you write one yourself.
//
// Not wired to any UI; kept because it is the only way to exercise the CoFHE path
// end to end against contracts/ConfidentialDemo.sol. Call it from the console:
//   const m = await import('/src/fhe/cofhe.js');
//   await m.writeSealedValue({ address, value: 4200n, provider, signer, chain });
export async function writeSealedValue({ address, value, provider, signer, chain }) {
  if (!signer) throw new Error('Connect a wallet first');
  const [client, { Encryptable }, { Contract }] = await Promise.all([
    getClient({ chain, provider, signer }),
    import('@cofhe/sdk'),
    import('ethers'),
  ]);
  const [encrypted] = await client
    .encryptInputs([Encryptable.uint128(BigInt(value))])
    .execute();
  const abi = [
    'function setSealedBalance((uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature) encrypted)',
  ];
  const tx = await new Contract(address, abi, signer).setSealedBalance(encrypted);
  await tx.wait();
  return tx.hash;
}

export async function dispose() {
  clients.clear();
}
