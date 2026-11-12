import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchNearTxs } from '../src/near/nearTxs.js';

test('NearBlocks rows map to the Activity native-tx shape', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [
    { transaction_hash: 'H1', block_timestamp: '1763000000000000000', signer_account_id: 'a.near', receiver_account_id: 'b.near',
      actions: [{ action: 'TRANSFER' }], actions_agg: { deposit: '2500000000000000000000000' }, outcomes: { status: true } },
    { transaction_hash: 'H2', block_timestamp: '1763000001000000000', signer_account_id: 'a.near', receiver_account_id: 'usdt.tether-token.near',
      actions: [{ action: 'FUNCTION_CALL', method: 'ft_transfer' }], actions_agg: { deposit: '1' }, outcomes: { status: false } },
  ] }) });
  try {
    const [t1, t2] = await fetchNearTxs('a.near');
    assert.deepEqual(t1, { hash: 'H1', timestamp: 1763000000000, from: 'a.near', to: 'b.near', valueNear: 2.5, method: '', failed: false });
    assert.equal(t2.valueNear, 0); // 1 yocto security deposit is not a transfer
    assert.equal(t2.method, 'ft_transfer');
    assert.equal(t2.failed, true);
  } finally { globalThis.fetch = orig; }
});
