// Public NEAR Intents balances (intents.near, NEP-245 multi-token).
//
// These are on the public verifier contract and readable by account name —
// unlike the private shard (confidentialIntents.js), which needs a signature.
//
//   intents.near  mt_tokens_for_owner  → [{ token_id }]   ("nep141:<contract>", "nep245:…", "nep171:…")
//   intents.near  mt_batch_balance_of  → ["<u128>", …]
//
// Only nep141 entries are returned: they wrap an ordinary FT, which the account
// reader can size and price like any other. NFTs and nested multi-tokens are
// counted so the AI can mention them, but not valued.

import { rpcView, posInt } from '../rpc.js';

export const INTENTS_CONTRACT = 'intents.near';
const PAGE = 100;
const MAX_TOKENS = 200;

// → { tokens: [{ contract, raw }], otherCount }
export async function fetchIntentsBalances(accountId, { fetchImpl }) {
  const ids = [];
  for (let from = 0; from < MAX_TOKENS; from += PAGE) {
    const page = await rpcView(fetchImpl, INTENTS_CONTRACT, 'mt_tokens_for_owner', {
      account_id: accountId, from_index: String(from), limit: PAGE,
    });
    if (!Array.isArray(page)) break;
    for (const t of page) if (typeof t?.token_id === 'string') ids.push(t.token_id);
    if (page.length < PAGE) break;
  }
  if (!ids.length) return { tokens: [], otherCount: 0 };

  const bals = await rpcView(fetchImpl, INTENTS_CONTRACT, 'mt_batch_balance_of', { account_id: accountId, token_ids: ids });
  const tokens = [];
  let otherCount = 0;
  ids.forEach((id, i) => {
    const raw = posInt(Array.isArray(bals) ? bals[i] : null);
    if (!raw) return;
    if (id.startsWith('nep141:')) tokens.push({ contract: id.slice(7), raw });
    else otherCount++;
  });
  return { tokens, otherCount };
}
