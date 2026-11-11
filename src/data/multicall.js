// Generic chunked Multicall3 aggregate3 helper.
//
// balances.js has its own copy of this pattern specialised to ERC-20
// balanceOf probes over (token, owner) pairs. Confidential-token discovery needs
// the same chunk/retry/limiter behaviour but for heterogeneous calls (registry
// reads, then metadata + encrypted balances), so the mechanism lives here in a
// call-shape-agnostic form.
//
// Chunk size rationale is the same as balances.js: a single multicall with
// thousands of sub-calls gets a 503 from public RPCs (response too large / gas
// cap). ~500 per batch stays well inside the limit.

import { Contract } from 'ethers';
import { MULTICALL3 } from './tokens.js';
import { createChainProvider } from './public.js';
import { rpcLimitFor } from '../utils/limit.js';

const MULTICALL3_ABI = [
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)',
];

const CHUNK = 500;

// Run `calls` ([{ target, allowFailure, callData }]) through Multicall3 on one
// chain. Returns { results, ok } where results is index-aligned with `calls`
// (a failed chunk leaves undefined holes rather than shifting later results onto
// the wrong call) and ok is false if any chunk failed after its retries.
export async function multicall(chain, calls, rpcOverride) {
  if (!calls.length) return { results: [], ok: true };

  const provider = createChainProvider(chain, rpcOverride);
  const mc = new Contract(MULTICALL3, MULTICALL3_ABI, provider);
  const limit = rpcLimitFor(chain.chainId, !!rpcOverride);

  const results = new Array(calls.length);
  let failedChunks = 0;

  const chunks = [];
  for (let i = 0; i < calls.length; i += CHUNK) {
    chunks.push({ start: i, calls: calls.slice(i, i + CHUNK) });
  }

  async function runChunk({ start, calls: c }) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await limit(() => mc.aggregate3.staticCall(c));
        for (let j = 0; j < r.length; j++) results[start + j] = r[j];
        return;
      } catch (err) {
        if (attempt === 3) {
          failedChunks += 1;
          console.warn(`[multicall] chunk @${start} failed on ${chain.name}:`, err?.message || err);
          return;
        }
        await new Promise((res) => setTimeout(res, 350 * (attempt + 1)));
      }
    }
  }

  // The per-chain limiter caps real concurrency, so hand it every chunk at once.
  await Promise.all(chunks.map(runChunk));
  return { results, ok: failedChunks === 0 };
}

// Convenience: build a call descriptor from an ethers Interface.
export const call = (iface, target, fn, args = []) => ({
  target,
  allowFailure: true,
  callData: iface.encodeFunctionData(fn, args),
});

// Decode one aggregate3 result, returning `fallback` for a failed/absent call or
// a value that doesn't decode. Confidential-token discovery probes contracts
// that may not implement every optional getter, so a miss must never throw.
export function decode(iface, fn, result, fallback = null) {
  if (!result || !result.success) return fallback;
  try {
    const out = iface.decodeFunctionResult(fn, result.returnData);
    return out.length === 1 ? out[0] : out;
  } catch {
    return fallback;
  }
}
