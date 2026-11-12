// NEP-413 off-chain message signing — the NEAR-wallet way to prove control of
// an account, used here to sign in to the NEAR Intents API.
//
// Spec (https://github.com/near/NEPs/blob/master/neps/nep-0413.md):
//   payload = { message: string, nonce: [u8; 32], recipient: string, callbackUrl?: string }
//   hash    = sha256( u32_le(2^31 + 413) ‖ borsh(payload) )
//   the wallet signs `hash` with an ed25519 access key of the account.
//
// For Intents, `message` is the JSON string {"signer_id", "deadline", "intents"}
// and `recipient` is "intents.near" (replay protection: the signature is
// useless for any other contract). With `intents: []` the signature authorizes
// NOTHING on-chain — it only proves account control.
//
// Wallets return the signature as base64 (spec) — some as "ed25519:<base58>".
// The Intents API wants "ed25519:<base58>". normalizeSignature() handles both.
// We verify the signature locally before sending, so a wrong wallet response
// fails here with a clear message rather than as an opaque 401.

import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { encodeBase58, decodeBase58, toBeArray } from 'ethers';

export const NEP413_TAG = 2 ** 31 + 413;
export const INTENTS_RECIPIENT = 'intents.near';

const enc = new TextEncoder();
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const borshString = (s) => { const b = enc.encode(s); return [u32(b.length), b]; };
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

export const b64encode = (bytes) => btoa(String.fromCharCode(...bytes));
export const b64decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Base58 ↔ bytes (ethers' helpers work on big integers, so keep leading zeros).
export function base58ToBytes(s, expectedLen) {
  const n = decodeBase58(s);
  const raw = n === 0n ? new Uint8Array(0) : toBeArray(n);
  const zeros = (s.match(/^1*/)?.[0].length) || 0;
  const bytes = concat([new Uint8Array(zeros), raw]);
  if (expectedLen && bytes.length !== expectedLen) {
    if (bytes.length > expectedLen) throw new Error(`base58 value longer than ${expectedLen} bytes`);
    return concat([new Uint8Array(expectedLen - bytes.length), bytes]);
  }
  return bytes;
}
export const bytesToBase58 = (bytes) => {
  const zeros = bytes.findIndex((b) => b !== 0);
  const lead = zeros === -1 ? bytes.length : zeros;
  return '1'.repeat(lead) + (lead === bytes.length ? '' : encodeBase58(bytes.slice(lead)));
};

// The Intents sign-in message (stringified JSON, field order as in the docs).
export function intentsMessage(accountId, deadlineMs) {
  return JSON.stringify({
    signer_id: accountId,
    deadline: new Date(deadlineMs).toISOString(),
    intents: [],
  });
}

// borsh(NEP-413 payload), prefixed with the tag, hashed.
export function nep413Hash({ message, nonce, recipient, callbackUrl = null }) {
  if (!(nonce instanceof Uint8Array) || nonce.length !== 32) throw new Error('NEP-413 nonce must be 32 bytes');
  const parts = [
    u32(NEP413_TAG),
    ...borshString(message),
    nonce,
    ...borshString(recipient),
    callbackUrl == null ? new Uint8Array([0]) : concat([new Uint8Array([1]), ...borshString(callbackUrl)]),
  ];
  return sha256(concat(parts));
}

// Wallet signature (base64 or "ed25519:<base58>") → { bytes, encoded: "ed25519:<base58>" }.
export function normalizeSignature(sig) {
  const s = String(sig || '').trim();
  let bytes;
  if (s.startsWith('ed25519:')) bytes = base58ToBytes(s.slice(8), 64);
  else bytes = b64decode(s);
  if (bytes.length !== 64) throw new Error(`Unexpected ed25519 signature length ${bytes.length}`);
  return { bytes, encoded: `ed25519:${bytesToBase58(bytes)}` };
}

export function publicKeyBytes(pk) {
  const s = String(pk || '').trim();
  if (!s.startsWith('ed25519:')) throw new Error('Only ed25519 NEAR keys can sign NEP-413 messages');
  return base58ToBytes(s.slice(8), 32);
}

export function verifyNep413(payload, publicKey, signature) {
  try {
    return ed25519.verify(normalizeSignature(signature).bytes, nep413Hash(payload), publicKeyBytes(publicKey));
  } catch {
    return false;
  }
}

// Implicit accounts are the hex of their own ed25519 public key.
export const implicitAccountId = (publicKey) =>
  Array.from(publicKeyBytes(publicKey), (b) => b.toString(16).padStart(2, '0')).join('');
