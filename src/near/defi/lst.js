// NEAR liquid staking: Meta Pool (stNEAR), LiNEAR, RHEA LST (rNEAR).
//
// The LST tokens themselves arrive as ordinary FTs from FastNEAR; this module
// says which contracts are LSTs (so the holding is shown as a staking position)
// and reads NEAR the account has unstaked inside each contract. That NEAR sits
// in the protocol, not in the wallet, so no other read sees it.
//
//   meta-pool.near        get_account_info  → available (withdrawable), unstaked (pending), can_withdraw
//   linear-protocol.near  get_account       → unstaked_balance, can_withdraw
//   lst.rhealab.near      get_account       → same interface as LiNEAR

import { rpcView, pool, posInt } from '../rpc.js';

export const LST_CONTRACTS = {
  'meta-pool.near': { protocol: 'Meta Pool', method: 'get_account_info' },
  'linear-protocol.near': { protocol: 'LiNEAR', method: 'get_account' },
  'lst.rhealab.near': { protocol: 'RHEA LST', method: 'get_account' },
};

export const lstProtocol = (contract) => LST_CONTRACTS[contract]?.protocol || null;

// → [{ contract, protocol, yocto, withdrawable }] (only non-zero rows)
export async function fetchLstUnstakes(accountId, { fetchImpl }) {
  const ids = Object.keys(LST_CONTRACTS);
  const res = await pool(ids, 3, (c) => rpcView(fetchImpl, c, LST_CONTRACTS[c].method, { account_id: accountId }));
  const out = [];
  ids.forEach((contract, i) => {
    const r = res[i];
    if (!r || typeof r !== 'object') return;
    const protocol = LST_CONTRACTS[contract].protocol;
    const ready = r.can_withdraw === true;
    if (contract === 'meta-pool.near') {
      // `available` is already withdrawable; `unstaked` waits for its unlock epoch.
      const avail = posInt(r.available);
      if (avail) out.push({ contract, protocol, yocto: avail, withdrawable: true });
      const pending = posInt(r.unstaked);
      if (pending) out.push({ contract, protocol, yocto: pending, withdrawable: ready });
    } else {
      const pending = posInt(r.unstaked_balance);
      if (pending) out.push({ contract, protocol, yocto: pending, withdrawable: ready });
    }
  });
  return out;
}
