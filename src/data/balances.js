// ERC-20 balance reads via Multicall3 — one chunked round-trip per chain
// regardless of how many tokens or wallets we probe.
//
// A single multicall probes balanceOf(owner) for EVERY (token, owner) pair on a
// chain. owner is a call argument, not the call target, so several wallets in a
// cluster collapse into one batched set of sub-calls instead of one full pass
// per wallet — a 3-wallet cluster is ~1× the calls, not 3×.

import { Contract, Interface } from 'ethers';
import { MULTICALL3 } from './tokens.js';
import { createChainProvider } from './public.js';
import { rpcLimitFor } from '../utils/limit.js';

const MULTICALL3_ABI = [
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)',
];
const ERC20 = new Interface([
  'function balanceOf(address) view returns (uint256)',
]);

// Chunk size. A single multicall with thousands of sub-calls gets a 503 from the
// public RPCs (response too large / gas cap). ~500 calls per batch stays well
// within limits (verified: 800 OK, 2371 → 503). Every chunk is routed through
// the chain's limiter so concurrent chunks never burst the endpoint.
const CHUNK = 500;

// Probe balanceOf for every (token, owner) pair on one chain.
//   owners: [address]
//   tokens: normalized token objects (must carry address, decimals + display
//           metadata: symbol, name, glyph, color, kind, protocol, label)
// Returns { byOwner: Map<ownerLowercase, balances[]>, ok }. `ok` is false if any
// chunk failed after retries (the list is incomplete — the caller may prefer
// cached balances for this chain).
export async function probeBalances(owners, chain, tokens, rpcOverride) {
  const byOwner = new Map(owners.map((o) => [o.toLowerCase(), []]));
  if (!owners.length || !tokens.length) return { byOwner, ok: true };

  const provider = createChainProvider(chain, rpcOverride);
  const multicall = new Contract(MULTICALL3, MULTICALL3_ABI, provider);
  const limit = rpcLimitFor(chain.chainId, !!rpcOverride);

  // One sub-call per (token, owner). Flattened so chunk boundaries can fall
  // anywhere; idx → token = floor(idx / nOwners), owner = idx % nOwners.
  const nOwners = owners.length;
  const calls = new Array(tokens.length * nOwners);
  for (let t = 0; t < tokens.length; t++) {
    const target = tokens[t].address;
    for (let o = 0; o < nOwners; o++) {
      calls[t * nOwners + o] = {
        target,
        allowFailure: true,
        callData: ERC20.encodeFunctionData('balanceOf', [owners[o]]),
      };
    }
  }

  // Pre-size results so a failed middle chunk leaves correctly-indexed holes
  // rather than shifting later tokens onto the wrong metadata.
  const results = new Array(calls.length);
  let failedChunks = 0;
  const chunks = [];
  for (let i = 0; i < calls.length; i += CHUNK) chunks.push({ start: i, calls: calls.slice(i, i + CHUNK) });

  async function runChunk({ start, calls: c }) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await limit(() => multicall.aggregate3.staticCall(c));
        for (let j = 0; j < r.length; j++) results[start + j] = r[j];
        return;
      } catch (err) {
        if (attempt === 3) {
          failedChunks += 1;
          console.warn(`[balances] chunk @${start} failed on ${chain.name}:`, err?.message || err);
          return; // leave this chunk's slots undefined; handled below
        }
        await new Promise((res) => setTimeout(res, 350 * (attempt + 1)));
      }
    }
  }

  // The per-chain limiter caps real concurrency, so hand it every chunk at once.
  await Promise.all(chunks.map(runChunk));

  results.forEach((r, i) => {
    if (!r || !r.success) return;
    let raw;
    try {
      [raw] = ERC20.decodeFunctionResult('balanceOf', r.returnData);
    } catch {
      return;
    }
    if (raw === 0n) return;
    const tk = tokens[Math.floor(i / nOwners)];
    const owner = owners[i % nOwners];
    const amount = Number(raw) / 10 ** tk.decimals;
    if (!(amount > 0)) return;
    byOwner.get(owner.toLowerCase()).push({
      chainId: chain.chainId,
      address: tk.address,
      symbol: tk.symbol,
      name: tk.name,
      decimals: tk.decimals,
      amount,
      kind: tk.kind,
      protocol: tk.protocol || null,
      label: tk.label || null,
      glyph: tk.glyph,
      color: tk.color,
    });
  });

  return { byOwner, ok: failedChunks === 0 };
}
