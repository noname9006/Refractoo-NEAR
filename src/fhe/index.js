// Confidential-token stack registry.
//
// Three FHE stacks (Fhenix CoFHE, Zama Protocol, Inco Lightning) all present the
// same frontend shape — authorize once, read an encrypted handle, decrypt in the
// browser — so they sit behind one adapter interface and the rest of the app
// never branches on which stack a holding came from.
//
// ADAPTER CONTRACT — each module in this directory exports:
//
//   meta      { id, name, trust, relayer, docs }
//   discover  ({ owners, chain, stack, rpcOverride }) → ShieldedToken[]
//   reveal    ({ token, owner, provider, signer, chain }) → bigint  (raw units)
//
// Two rules every adapter must honour:
//
//   1. discover() NEVER DECRYPTS. It returns ciphertext handles only, so the
//      dashboard can show "there is something confidential here" with no wallet
//      signature and no relayer round-trip. Revealing is always an explicit,
//      per-holding user action.
//
//   2. Decrypted amounts are returned, never stored. Adapters must hand their
//      SDK the in-memory storage backend from ./memory-storage.js so plaintext
//      never lands in IndexedDB or localStorage.
//
// Adapters are DYNAMICALLY IMPORTED. Each SDK ships a multi-megabyte TFHE WASM
// blob, and this app already loads wllama + transformers.js; static imports here
// would put all of that on the critical path for a dashboard that may never
// reveal anything.

import { FHE_STACKS } from '../config/networks.js';

// How a stack's decryption is trusted. Shown to the user rather than averaged
// into one generic "encrypted" badge, because these are materially different
// assumptions and the difference is the user's to weigh.
export const TRUST = {
  'threshold-fhe': {
    short: 'Threshold FHE',
    detail:
      'Decryption is split across a threshold committee of key holders. No single ' +
      'operator can read your balance, and the plaintext is produced in your browser.',
  },
  tee: {
    short: 'TEE nodes',
    detail:
      'Decryption runs inside trusted execution environments (secure hardware) ' +
      'operated by a node network. This is a hardware trust assumption, not a ' +
      'cryptographic one — weaker than threshold FHE.',
  },
};

// Adapter loaders. Static keys, dynamic bodies: Vite can code-split each SDK
// into its own chunk, and nothing is fetched until a stack is actually used.
const LOADERS = {
  zama: () => import('./zama.js'),
  cofhe: () => import('./cofhe.js'),
  inco: () => import('./inco.js'),
};

// Optional env allowlist, so a stack whose SDK is misbehaving can be switched
// off without a code change. Empty/unset ⇒ every stack the profile declares.
const ENABLED = String(import.meta.env.VITE_FHE_STACKS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// The (stack, chain) pairs to probe on the active network profile. A stack whose
// discovery config is incomplete (no registry address, empty token list) is kept
// but flagged `configured: false`, so the UI can say "not configured" instead of
// silently showing nothing.
export function activeStacks() {
  return FHE_STACKS.filter((s) => LOADERS[s.id] && (!ENABLED.length || ENABLED.includes(s.id))).map(
    (s) => ({ ...s, configured: isConfigured(s) })
  );
}

function isConfigured(stack) {
  const d = stack.discovery || {};
  if (d.type === 'registry') return !!d.address;
  if (d.type === 'list') return (d.tokens || []).length > 0;
  return false;
}

const cache = new Map();

export async function getAdapter(id) {
  if (!LOADERS[id]) throw new Error(`Unknown confidential-token stack "${id}"`);
  if (!cache.has(id)) cache.set(id, LOADERS[id]());
  return cache.get(id);
}
