// Confidential-token discovery + reveal, across every FHE stack the active
// network profile declares. This is to src/fhe/ what enrich.js is to the public
// data sources: it fans out, tolerates per-stack failure, and returns one flat
// list the portfolio builder can consume.
//
// SHIELDED TOKEN SHAPE — one entry per (stack, chain, wrapper, wallet):
//
//   {
//     stack, chainId, chainName, wallet,
//     address,            confidential token contract
//     symbol, name, decimals,
//     underlying,         ERC-20 the wrapper wraps (for pricing); null if none
//     handle,             ciphertext handle — proof something exists, not an amount
//     state,              'encrypted' | 'revealed' | 'error'
//     amount,             number, only when revealed
//     usd, change24h,     only when revealed AND the underlying has a price
//     error,              string, only when state === 'error'
//   }
//
// PRIVACY: a revealed `amount` exists in memory for the session only. It must
// never reach localStorage or IndexedDB — that is why discovery results are not
// written to the chain-data cache the way enrich.js writes balances.

import { CHAINS } from './public.js';
import { activeStacks, getAdapter } from '../fhe/index.js';

const keyOf = (t) => `${t.stack}:${t.chainId}:${t.address.toLowerCase()}:${t.wallet.toLowerCase()}`;

// Stable identity for a holding, so the UI can address one row for reveal and
// the portfolio can merge revealed values back onto the right entry.
export const shieldedKey = keyOf;

// Probe every (stack, chain) pair for confidential holdings belonging to
// `owners`. Never decrypts. Returns { tokens, stacks } where `stacks` reports
// per-stack status so the card can distinguish "nothing held" from "not
// configured" from "probe failed" — three very different messages.
export async function discoverShielded(owners, { rpcOverrides = {} } = {}) {
  const stacks = activeStacks();
  if (!owners.length || !stacks.length) return { tokens: [], stacks: [] };

  const chainById = new Map(CHAINS.map((c) => [c.chainId, c]));

  const results = await Promise.all(
    stacks.map(async (stack) => {
      const chain = chainById.get(stack.chainId);
      const status = {
        id: stack.id,
        name: stack.name,
        chainId: stack.chainId,
        chainName: chain?.name || `Chain ${stack.chainId}`,
        configured: stack.configured,
        ok: false,
        error: null,
        found: 0,
      };
      // A stack on a chain the active profile doesn't include is not an error —
      // it just isn't reachable in this mode.
      if (!chain) return { status: { ...status, error: 'chain not in this network mode' }, tokens: [] };
      if (!stack.configured) return { status, tokens: [] };

      try {
        const adapter = await getAdapter(stack.id);
        const tokens = await adapter.discover({
          owners,
          chain,
          stack,
          rpcOverride: rpcOverrides[stack.chainId],
        });
        return { status: { ...status, ok: true, found: tokens.length }, tokens };
      } catch (err) {
        console.warn(`[shielded] ${stack.id} discovery failed on ${chain.name}:`, err);
        return { status: { ...status, error: String(err?.message || err) }, tokens: [] };
      }
    })
  );

  // Dedupe defensively: in testnet mode CoFHE is registered once per chain with
  // the same contract list, so the same (chain, contract, wallet) can be reached
  // from more than one stack entry.
  const seen = new Set();
  const tokens = [];
  for (const r of results) {
    for (const t of r.tokens) {
      const k = keyOf(t);
      if (seen.has(k)) continue;
      seen.add(k);
      // Stamp the stable identity onto the entry so React keys and the reveal
      // actions don't each have to recompute it.
      tokens.push({ ...t, key: k });
    }
  }

  return { tokens, stacks: results.map((r) => r.status) };
}

// Decrypt one holding. Returns a NEW token object — the caller replaces its entry
// rather than mutating, so React state updates cleanly.
//
// A failure is recorded on the entry (state: 'error') instead of thrown, because
// a rejected signature or a relayer hiccup on one token must not blank the whole
// card. The one exception is a missing signer, which is a precondition.
export async function revealShielded(token, { provider, signer } = {}) {
  const chain = CHAINS.find((c) => c.chainId === token.chainId);
  if (!chain) throw new Error(`${token.chainName} is not part of the current network mode`);
  if (!signer) throw new Error('Connect a wallet to reveal confidential balances');

  try {
    const adapter = await getAdapter(token.stack);
    const raw = await adapter.reveal({ token, owner: token.wallet, provider, signer, chain });
    const amount = Number(raw) / 10 ** (token.decimals ?? 0);
    return { ...token, state: 'revealed', amount, error: null };
  } catch (err) {
    // "No ciphertext" means the account never shielded this token — a real,
    // non-error answer that reads better as a zero than as a failure.
    const msg = String(err?.message || err);
    if (/NoCiphertext|no ciphertext/i.test(msg) || err?.name === 'NoCiphertextError') {
      return { ...token, state: 'revealed', amount: 0, error: null };
    }
    console.warn(`[shielded] reveal failed for ${token.symbol} (${token.stack})`, err);
    return { ...token, state: 'error', amount: null, error: friendlyError(msg) };
  }
}

function friendlyError(msg) {
  if (/user rejected|rejected the request|ACTION_REJECTED|SigningRejected/i.test(msg)) {
    return 'Signature declined — the balance stays encrypted.';
  }
  if (/network|fetch|relayer|timeout/i.test(msg)) {
    return 'Could not reach the decryption relayer. Try again in a moment.';
  }
  return msg;
}

// Price keys needed to value the REVEALED shielded holdings. A wrapper has no
// price of its own; its value comes from the ERC-20 it wraps, which the existing
// mainnet price path already covers.
export function shieldedPriceTargets(tokens = []) {
  const keys = new Set();
  for (const t of tokens) {
    if (t.underlying) keys.add(`${t.chainId}:${t.underlying}`);
  }
  return [...keys];
}
