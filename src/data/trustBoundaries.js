// Trust boundaries: every party this app talks to, and what each one can see.
// Rendered in the tier panel ("Every party, and what it sees") and mirrored in
// README → Privacy model. tests/trustBoundaries.test.mjs checks the rows that
// can be checked against the code (same-origin endpoints, Intents API host,
// what the external tier sends).
//
// Columns:
//   ids      — your wallet addresses / NEAR account names
//   amounts  — balances and amounts
//   question — what you ask the AI
//   other    — what else it learns (metadata)
// Each cell: { v: 'yes' | 'no' | 'part', t: text }. 'part' = a limited or
// transformed view (placeholders, ciphertext, public-only data).
//
// Copy rule: say what actually happens, including what is not private.

import { precisionFor } from '../utils/pseudonymize.js';

const yes = (t) => ({ v: 'yes', t });
const no = (t = 'No') => ({ v: 'no', t });
const part = (t) => ({ v: 'part', t });

// prefs → rows. `tier` is the active inference tier, so its rows are marked.
export function trustRows(prefs = {}) {
  const tier = prefs.inference || 'nearai';
  const redact = prefs.redactRemote !== false;
  const sig = (t) => (!redact ? 'exact' : precisionFor(prefs, t) ? `rounded to ${precisionFor(prefs, t)} significant figures` : 'exact');
  const ids = redact ? part('Placeholders only (WALLET_1, NEAR_2…)') : yes('Real addresses (pseudonymization is off)');

  return [
    {
      id: 'browser', group: 'you', party: 'This browser (you)',
      ids: yes('Everything'), amounts: yes('Everything, incl. revealed private balances — kept in memory only'), question: yes('Yes'),
      other: 'Nothing leaves it unless a row below says so.',
    },
    {
      id: 'hosting', group: 'app', party: 'App hosting (the server that serves this page)',
      ids: no('No — the page never sends your addresses to its own server'),
      amounts: no(),
      question: tier === 'external'
        ? part('External-API tier only: the request passes through this server’s /api/llm relay (pseudonymized), with your API key in a header')
        : no('Not on the on-device or NEAR AI tiers'),
      other: 'Your IP and page loads; token contract addresses whose icons are looked up (/api/coinicon) — i.e. which tokens appear in your portfolio. Self-hosted locally (npm run server), this is your own machine.',
    },
    {
      id: 'rpc', group: 'public', party: 'Public RPCs and explorers (publicnode, Etherscan, NearBlocks, FastNEAR, NEAR RPC)',
      ids: yes('Yes — every address or account you look up'),
      amounts: part('Only public on-chain balances, which anyone can read'),
      question: no(),
      other: 'Your IP. For a NEAR account, the NEAR RPC endpoints also see which DeFi contracts are asked about it (Meta Pool, LiNEAR, RHEA LST, intents.near, Rhea Lend) — read-only view calls, the same for every account. FastNEAR is tried first; when it throttles, the official NEAR RPC (rpc.mainnet.near.org, run by NEAR) gets the same calls. The endpoints are fixed in src/near/rpc.js (there is no in-app RPC setting yet); self-hosters can change them there.',
    },
    {
      id: 'prices', group: 'public', party: 'Price and token-metadata APIs (DefiLlama)',
      ids: no(), amounts: no(), question: no(),
      other: 'Which token contracts you hold (to price them), and your IP.',
    },
    {
      id: 'wallet', group: 'near', party: 'Your NEAR wallet (HOT, Meteor, …) via near-connect',
      ids: yes('Your account — it is your wallet'), amounts: no(), question: no(),
      other: 'That this app asked you to sign an EMPTY intent list for intents.near (no transfer). The wallet list is fetched from GitHub / jsDelivr (IP only).',
    },
    {
      id: 'intents-api', group: 'near', party: 'NEAR Intents API (operated by Aurora)',
      ids: yes('Yes — the account or EVM address you sign in with'),
      amounts: yes('Yes — it serves your private-shard balances'),
      question: no(),
      other: 'Your swap history and IP. This is the one party outside a TEE that sees your private balances.',
    },
    {
      id: 'shard-validators', group: 'near', party: 'NEAR private-shard validators',
      ids: part('Inside TEEs — they hold the shard state'),
      amounts: part('Inside TEEs — they hold the shard state'),
      question: no(),
      other: 'A permissioned set run in trusted execution environments: a hardware trust assumption, not cryptography.',
    },
    {
      id: 'public-chain', group: 'near', party: 'Public NEAR chain and block explorers',
      ids: no('No — sign-in is off-chain, nothing is submitted'), amounts: no('No — private-shard balances are not on the public chain'), question: no(),
      other: 'Nothing about your private balances.',
    },
    {
      id: 'fhe', group: 'public', party: 'FHE decryption services (Zama relayer, Fhenix threshold network, Inco TEE nodes) — only when you reveal',
      ids: yes('Yes — your address'), amounts: no('No — re-encrypted to a key this page holds'), question: no(),
      other: 'Which confidential token you asked to reveal. Inco decrypts in TEEs (hardware trust); Zama and Fhenix use threshold cryptography.',
    },
    {
      id: 'nearai-gateway', group: 'ai', tier: 'nearai', party: 'NEAR AI gateway',
      ids: part('Ciphertext only'), amounts: part('Ciphertext only'), question: part('Ciphertext only'),
      other: 'Your NEAR AI API key (your NEAR AI account), IP, timing and request size.',
    },
    {
      id: 'nearai-enclave', group: 'ai', tier: 'nearai', party: 'NEAR AI model enclave (attested TEE)',
      ids, amounts: part(`Amounts ${sig('nearai')}; only code inside the attested enclave reads them`), question: part(redact ? 'Yes, pseudonymized' : 'Yes'),
      other: 'Which assets and chains you hold. Checked in this browser: TDX quote, NVIDIA GPU evidence, a signature on every answer.',
    },
    {
      id: 'nvidia-intel', group: 'ai', tier: 'nearai', party: 'NVIDIA NRAS and Intel attestation collateral',
      ids: no(), amounts: no(), question: no(),
      other: 'Attestation evidence and your IP — nothing about your wallets.',
    },
    {
      id: 'external-operator', group: 'ai', tier: 'external', party: 'External API operator',
      ids, amounts: part(`Amounts ${sig('external')}`), question: part(redact ? 'Yes, pseudonymized — readable by the operator' : 'Yes — readable by the operator'),
      other: 'Which assets and chains you hold, and whatever the provider logs. Use only an endpoint you trust or run yourself.',
    },
  ].map((r) => ({ ...r, active: !r.tier || r.tier === tier, offTier: !!r.tier && r.tier !== tier }));
}

export const TRUST_COLUMNS = [
  ['ids', 'Addresses / accounts'],
  ['amounts', 'Balances & amounts'],
  ['question', 'Your question'],
];
