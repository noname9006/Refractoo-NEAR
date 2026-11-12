// Public NEAR transactions for an account, from NearBlocks API v3 (public,
// CORS-enabled, no key). Mapped to the Activity feed's native-tx shape.
const BASE = 'https://api.nearblocks.io/v3';
// yocto (10^-24) → NEAR via BigInt: a float divide turns 2.5 into 2.5000000000000004.
// Kept to 6 decimals; anything smaller is a security deposit, not a transfer.
const yoctoToNear = (y) => { try { return Number(BigInt(String(y || 0).split('.')[0]) / 10n ** 18n) / 1e6; } catch { return 0; } };
const cache = new Map(); // accountId → { at, txs }

export async function fetchNearTxs(accountId, { limit = 25 } = {}) {
  const hit = cache.get(accountId);
  if (hit && Date.now() - hit.at < 50_000) return hit.txs;
  const res = await fetch(`${BASE}/accounts/${encodeURIComponent(accountId)}/txns?limit=${limit}`);
  if (!res.ok) throw new Error(`NearBlocks HTTP ${res.status}`);
  const j = await res.json();
  const txs = (j?.data || []).map((t) => {
    const fn = (t.actions || []).find((a) => a.action === 'FUNCTION_CALL');
    const deposit = yoctoToNear(t.actions_agg?.deposit);
    return {
      hash: t.transaction_hash,
      timestamp: Math.round(Number(t.block_timestamp) / 1e6),
      from: t.signer_account_id,
      to: t.receiver_account_id,
      // 1-yocto deposits are NEP-141 security attachments, not transfers.
      valueNear: deposit >= 1e-6 ? deposit : 0,
      method: fn?.method || ((t.actions || []).some((a) => a.action === 'TRANSFER') ? '' : String(t.actions?.[0]?.action || '').toLowerCase().replace(/_/g, ' ')),
      failed: t.outcomes?.status === false,
    };
  });
  cache.set(accountId, { at: Date.now(), txs });
  return txs;
}
