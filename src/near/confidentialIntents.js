// NEAR Confidential Intents — read the user's PRIVATE-SHARD balances.
//
// Since 2026-08-29 NEAR Intents runs confidential by default: balances held in
// the private shard are not visible to block explorers or public RPC. The only
// way to read them is as the owner, through the Intents API (operated by Aurora):
//
//   1. the user signs a no-op intent (ERC-191 from an EVM wallet here; NEP-413
//      from a NEAR wallet is the other accepted standard),
//   2. POST /api/auth/authenticate/{apiKey} exchanges it for a session JWT,
//   3. GET  /api/account/balances/{apiKey} returns the private balances.
//
// The signed payload carries `intents: []` — it authorizes NOTHING on-chain and
// moves no funds. It only proves control of the address.
//
// PRIVACY (same rules as src/fhe/): the session token and every amount live in
// memory for this page load only. Nothing here touches localStorage/IndexedDB.
// Who sees what is stated in the UI, not hidden:
//   • the Intents API (Aurora) serves the balances, so it sees address + amounts;
//   • the private shard's permissioned validators run in TEEs and see the state;
//   • block explorers and the public see nothing.
//
// The API key is a partner key (it identifies this app as the integrator, not the
// user). It is a VITE_ value, so it is bundled into the client like
// VITE_ETHERSCAN_KEY — calls go browser → Intents API directly, and this app's
// own server never sees the session token or the balances.
//
// Docs: https://docs.intents.aurora.dev/intents-swap/confidential-swaps
//       https://docs.near-intents.org (signing standards)

import { encodeBase58, getBytes } from 'ethers';

const BASE = 'https://intents-api.aurora.dev';
const API_KEY = String(import.meta.env.VITE_AURORA_INTENTS_API_KEY || '').trim();
const VERIFYING_CONTRACT = 'intents.near';
const DEADLINE_MS = 5 * 60_000;

export const STACK_ID = 'near-intents';
export const CHAIN_NAME = 'NEAR private shard';

export const intentsConfigured = () => !!API_KEY;

// In-memory session, keyed by signer address. Never persisted.
const sessions = new Map();

// Token metadata + USD prices, shared by every user. Cached for the page load.
let tokensPromise = null;

async function api(path, init = {}) {
  if (!API_KEY) throw new Error('NEAR Intents API key is not configured (VITE_AURORA_INTENTS_API_KEY)');
  const res = await fetch(`${BASE}${path.replace('{key}', encodeURIComponent(API_KEY))}`, init);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const err = new Error(body?.message || `Intents API HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function randomNonceBase64() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b));
}

// ERC-191 sign-in. `signer` is an ethers v6 Signer (the connected EVM wallet).
// personal_sign over the exact payload string; the verifier expects the 65-byte
// r||s||v signature with v normalized to {0,1}, base58-encoded with a
// "secp256k1:" prefix.
async function authenticateErc191(signer) {
  const address = (await signer.getAddress()).toLowerCase();
  const payload = JSON.stringify({
    signer_id: address,
    verifying_contract: VERIFYING_CONTRACT,
    nonce: randomNonceBase64(),
    deadline: new Date(Date.now() + DEADLINE_MS).toISOString(),
    intents: [],
  });
  const sigHex = await signer.signMessage(payload);
  const sig = getBytes(sigHex);
  if (sig.length !== 65) throw new Error(`Unexpected signature length ${sig.length}`);
  if (sig[64] >= 27) sig[64] -= 27;

  const res = await api('/api/auth/authenticate/{key}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signedData: { standard: 'erc191', signature: `secp256k1:${encodeBase58(sig)}`, payload },
    }),
  });
  const session = {
    address,
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
    expiresAt: Date.now() + (Number(res.expiresIn) || 0) * 1000,
  };
  sessions.set(address, session);
  return session;
}

async function refresh(session) {
  const res = await api('/api/auth/refresh/{key}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  session.accessToken = res.accessToken;
  session.expiresAt = Date.now() + (Number(res.expiresIn) || 0) * 1000;
  return session;
}

// A usable session for `signer`: reuse → refresh → sign again, in that order,
// so the wallet only prompts when it has to.
async function sessionFor(signer) {
  const address = (await signer.getAddress()).toLowerCase();
  const s = sessions.get(address);
  if (s && s.expiresAt - Date.now() > 30_000) return s;
  if (s?.refreshToken) {
    try { return await refresh(s); } catch { sessions.delete(address); }
  }
  return authenticateErc191(signer);
}

async function authed(signer, path) {
  let s = await sessionFor(signer);
  try {
    return await api(path, { headers: { Authorization: `Bearer ${s.accessToken}` } });
  } catch (e) {
    if (e.status !== 401) throw e;
    sessions.delete(s.address);
    s = await authenticateErc191(signer);
    return api(path, { headers: { Authorization: `Bearer ${s.accessToken}` } });
  }
}

export function fetchIntentsTokens() {
  if (!tokensPromise) {
    tokensPromise = api('/api/tokens/{key}')
      .then((r) => new Map((r.tokens || []).map((t) => [t.assetId, t])))
      .catch((e) => { tokensPromise = null; throw e; });
  }
  return tokensPromise;
}

const HISTORY_QUERY = new URLSearchParams([
  ...['PENDING_DEPOSIT', 'INCOMPLETE_DEPOSIT', 'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED'].map((v) => ['status', v]),
  ...['ORIGIN_CHAIN', 'INTENTS', 'CONFIDENTIAL_INTENTS'].map((v) => ['depositType', v]),
  ...['DESTINATION_CHAIN', 'INTENTS', 'CONFIDENTIAL_INTENTS'].map((v) => ['recipientType', v]),
  ...['ORIGIN_CHAIN', 'INTENTS', 'CONFIDENTIAL_INTENTS'].map((v) => ['refundType', v]),
  ['limit', '50'],
]).toString();

// Read the signer's private-shard holdings. Returns ShieldedToken-shaped rows
// (see data/shielded.js) already in the 'revealed' state — the signature IS the
// reveal — plus the swap history, which callers may use or ignore.
export async function loadConfidentialHoldings(signer) {
  const address = (await signer.getAddress()).toLowerCase();
  const [balances, tokens] = await Promise.all([
    authed(signer, '/api/account/balances/{key}'),
    fetchIntentsTokens().catch(() => new Map()),
  ]);

  const rows = (balances?.balances || [])
    .filter((b) => b.available && b.available !== '0')
    .map((b) => {
      const meta = tokens.get(b.tokenId);
      const decimals = meta?.decimals ?? null;
      const amount = decimals != null ? Number(BigInt(b.available)) / 10 ** decimals : null;
      return {
        stack: STACK_ID,
        chainId: STACK_ID,
        chainName: CHAIN_NAME,
        wallet: address,
        address: b.tokenId,
        symbol: meta?.symbol || shortTokenId(b.tokenId),
        name: meta ? `${meta.symbol} (${meta.blockchain})` : b.tokenId,
        decimals,
        originChain: meta?.blockchain || null,
        underlying: null,
        handle: null,
        state: amount != null ? 'revealed' : 'error',
        amount,
        priceUsd: meta?.price ?? null,
        rawAmount: b.available,
        error: amount == null ? 'Unknown token — amount shown in raw units only' : null,
        key: `${STACK_ID}:${b.tokenId}:${address}`,
      };
    });

  let history = null;
  try {
    const h = await authed(signer, `/api/account/history/{key}?${HISTORY_QUERY}`);
    history = h?.items || [];
  } catch (e) {
    console.warn('[near-intents] history unavailable', e);
  }

  return { address, tokens: rows, history };
}

// Forget every session (e.g. on disconnect). Amounts held by callers are theirs
// to drop.
export function clearIntentsSessions() {
  sessions.clear();
}

const shortTokenId = (id) => {
  const s = String(id).replace(/^nep\d+:/, '');
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
};
