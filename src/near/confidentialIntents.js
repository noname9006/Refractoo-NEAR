// NEAR Confidential Intents — read the user's PRIVATE-SHARD balances.
//
// Since 2026-08-29 NEAR Intents runs confidential by default: balances held in
// the private shard are not visible to block explorers or public RPC. The only
// way to read them is as the owner, through the Intents API (operated by Aurora):
//
//   1. the user signs a no-op intent — ERC-191 from an EVM wallet or NEP-413
//      from a NEAR wallet (see evmIdentity / nearIdentity below),
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
import {
  intentsMessage, nep413Hash, normalizeSignature, verifyNep413, b64encode, INTENTS_RECIPIENT,
  versionedNonce, fetchIntentsSalt,
} from './nep413.js';

const BASE = 'https://intents-api.aurora.dev';
// `?.` keeps the module importable outside Vite (Node tests set the key below).
let API_KEY = String(import.meta.env?.VITE_AURORA_INTENTS_API_KEY || '').trim();
const VERIFYING_CONTRACT = 'intents.near';
const DEADLINE_MS = 5 * 60_000;

export const STACK_ID = 'near-intents';
export const CHAIN_NAME = 'NEAR private shard';

export const intentsConfigured = () => !!API_KEY;
export function setIntentsApiKeyForTests(k) { API_KEY = String(k || '').trim(); }

// In-memory session, keyed by "<kind>:<account>". Never persisted.
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

// Every sign-in needs a versioned nonce bound to the intents.near salt and to
// the message deadline (see nep413.js → versionedNonce). The salt rotates
// rarely; cache it for a minute.
let saltCache = { at: 0, salt: null };
let saltProvider = () => fetchIntentsSalt();
export function setSaltProviderForTests(fn) { saltProvider = fn || (() => fetchIntentsSalt()); saltCache = { at: 0, salt: null }; }
async function freshNonce() {
  if (!saltCache.salt || Date.now() - saltCache.at > 60_000) saltCache = { at: Date.now(), salt: await saltProvider() };
  const deadline = new Date(Date.now() + DEADLINE_MS);
  return { deadline, nonce: versionedNonce(saltCache.salt, deadline) };
}

// --- Identities --------------------------------------------------------------
// Two ways to prove ownership, one shape: { kind, id, signedData() }.
//   evm  — ERC-191 personal_sign from an EVM wallet (ethers v6 Signer)
//   near — NEP-413 signMessage from a NEAR wallet (near-connect)
// Both sign an EMPTY intent list: no transfer, no on-chain effect.

// ERC-191: personal_sign over the exact payload string; the verifier expects the
// 65-byte r||s||v signature with v normalized to {0,1}, base58 with a
// "secp256k1:" prefix.
export async function evmIdentity(signer) {
  const address = (await signer.getAddress()).toLowerCase();
  return {
    kind: 'evm',
    id: address,
    async signedData() {
      const { nonce, deadline } = await freshNonce();
      const payload = JSON.stringify({
        signer_id: address,
        verifying_contract: VERIFYING_CONTRACT,
        deadline: deadline.toISOString(),
        nonce: b64encode(nonce),
        intents: [],
      });
      const sig = getBytes(await signer.signMessage(payload));
      if (sig.length !== 65) throw new Error(`Unexpected signature length ${sig.length}`);
      if (sig[64] >= 27) sig[64] -= 27;
      return { standard: 'erc191', signature: `secp256k1:${encodeBase58(sig)}`, payload };
    },
  };
}

// NEP-413: `signMessage({ message, recipient, nonce })` is the wallet's call
// (near-connect's wallet.signMessage, or a local key in tests) and must return
// { accountId?, publicKey: "ed25519:…", signature: base64 | "ed25519:…" }.
// The signature is checked locally before it is sent anywhere.
//
// signerPrefix: optional namespace for the signer_id (unused by default).
export function nearIdentity({ accountId, signMessage, signerPrefix = '' }) {
  const walletId = String(accountId).toLowerCase();
  const id = `${signerPrefix}${walletId}`;
  return {
    kind: 'near',
    id,
    async signedData() {
      const { nonce, deadline } = await freshNonce();
      const message = intentsMessage(id, deadline);
      const signed = await signMessage({ message, recipient: INTENTS_RECIPIENT, nonce });
      if (signed?.accountId && String(signed.accountId).toLowerCase() !== walletId) {
        throw new Error(`Wallet signed as ${signed.accountId}, expected ${walletId}`);
      }
      const p = { message, nonce, recipient: INTENTS_RECIPIENT };
      if (!verifyNep413(p, signed?.publicKey, signed?.signature)) {
        throw new Error('The wallet returned a NEP-413 signature that does not verify — nothing was sent.');
      }
      return {
        standard: 'nep413',
        public_key: signed.publicKey,
        signature: normalizeSignature(signed.signature).encoded,
        payload: { recipient: INTENTS_RECIPIENT, nonce: b64encode(nonce), message },
      };
    },
  };
}
export { nep413Hash };

async function authenticate(identity) {
  const signedData = await identity.signedData();
  // DEV-ONLY debugging aid: the exact sign-in payload (a public key, a
  // signature over an empty intent list, a nonce) so a failing sign-in can be
  // replayed and diagnosed. Stripped from production builds.
  if (import.meta.env?.DEV && typeof window !== 'undefined') window.__lastIntentsAuth = signedData;
  const res = await api('/api/auth/authenticate/{key}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedData }),
  });
  const session = {
    key: `${identity.kind}:${identity.id}`,
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
    expiresAt: Date.now() + (Number(res.expiresIn) || 0) * 1000,
  };
  sessions.set(session.key, session);
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

// A usable session for `identity`: reuse → refresh → sign again, in that order,
// so the wallet only prompts when it has to.
async function sessionFor(identity) {
  const key = `${identity.kind}:${identity.id}`;
  const s = sessions.get(key);
  if (s && s.expiresAt - Date.now() > 30_000) return s;
  if (s?.refreshToken) {
    try { return await refresh(s); } catch { sessions.delete(key); }
  }
  return authenticate(identity);
}

async function authed(identity, path) {
  let s = await sessionFor(identity);
  try {
    return await api(path, { headers: { Authorization: `Bearer ${s.accessToken}` } });
  } catch (e) {
    if (e.status !== 401) throw e;
    sessions.delete(s.key);
    s = await authenticate(identity);
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
// `who` is an identity from evmIdentity()/nearIdentity(), or (back-compat) an
// ethers Signer, which is wrapped as an EVM identity.
export async function loadConfidentialHoldings(who) {
  const identity = typeof who?.getAddress === 'function' ? await evmIdentity(who) : who;
  const address = identity.id; // EVM address or NEAR account id
  const [balances, tokens] = await Promise.all([
    authed(identity, '/api/account/balances/{key}'),
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
        // The NEAR view chain, so the dashboard's chain filter keeps these rows
        // (an unknown chainId was filtered out of every view). `stack` still
        // marks them as private-shard balances.
        chainId: 'near',
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
    const h = await authed(identity, `/api/account/history/{key}?${HISTORY_QUERY}`);
    history = h?.items || [];
  } catch (e) {
    console.warn('[near-intents] history unavailable', e);
  }

  return { address, kind: identity.kind, tokens: rows, history };
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
