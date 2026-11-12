import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519';
import {
  nep413Hash, normalizeSignature, verifyNep413, intentsMessage, implicitAccountId,
  bytesToBase58, base58ToBytes, b64encode, INTENTS_RECIPIENT, NEP413_TAG,
} from '../src/near/nep413.js';

const priv = ed25519.utils.randomPrivateKey();
const pubBytes = ed25519.getPublicKey(priv);
const publicKey = `ed25519:${bytesToBase58(pubBytes)}`;
const nonce = new Uint8Array(32).fill(7);
const payload = { message: intentsMessage('alice.near', Date.UTC(2026, 10, 13)), nonce, recipient: INTENTS_RECIPIENT };

test('tag is 2^31 + 413 and prefixes the borsh bytes (little-endian)', () => {
  assert.equal(NEP413_TAG, 2147484061);
  // Changing any field changes the hash.
  const h = nep413Hash(payload);
  assert.notDeepEqual(h, nep413Hash({ ...payload, recipient: 'evil.near' }));
  assert.notDeepEqual(h, nep413Hash({ ...payload, callbackUrl: 'https://x' }));
  assert.notDeepEqual(h, nep413Hash({ ...payload, nonce: new Uint8Array(32) }));
  assert.equal(h.length, 32);
});

test('intents message is the documented JSON with an empty intent list', () => {
  const m = JSON.parse(intentsMessage('alice.near', Date.UTC(2026, 10, 13)));
  assert.deepEqual(m, { signer_id: 'alice.near', deadline: '2026-11-13T00:00:00.000Z', intents: [] });
});

test('signatures verify in both wallet encodings; tampering fails', () => {
  const sig = ed25519.sign(nep413Hash(payload), priv);
  const asB64 = b64encode(sig);
  const asB58 = `ed25519:${bytesToBase58(sig)}`;
  assert.equal(verifyNep413(payload, publicKey, asB64), true);
  assert.equal(verifyNep413(payload, publicKey, asB58), true);
  assert.equal(normalizeSignature(asB64).encoded, asB58);
  assert.equal(verifyNep413({ ...payload, recipient: 'evil.near' }, publicKey, asB64), false);
  assert.equal(verifyNep413(payload, `ed25519:${bytesToBase58(ed25519.getPublicKey(ed25519.utils.randomPrivateKey()))}`, asB64), false);
  assert.equal(verifyNep413(payload, publicKey, 'garbage'), false);
});

test('versionedNonce matches the SDK layout', async () => {
  const { versionedNonce } = await import('../src/near/nep413.js');
  const deadline = new Date('2026-11-13T00:05:00.123Z');
  const now = Date.parse('2026-11-13T00:00:00.000Z');
  const n = Buffer.from(versionedNonce(Uint8Array.from([1, 2, 3, 4]), deadline, now));
  assert.equal(n.length, 32);
  assert.equal(n.subarray(0, 5).toString('hex'), '5628f6c600');
  assert.equal(n.subarray(5, 9).toString('hex'), '01020304');
  assert.equal(n.readBigUInt64LE(9), BigInt(deadline.getTime()) * 1000000n);
  assert.equal(n.readBigUInt64LE(17), BigInt(now) * 1000000n);
  assert.throws(() => versionedNonce(new Uint8Array(3), deadline), /4 bytes/);
});

test('base58 keeps leading zero bytes; implicit account = hex(pubkey)', () => {
  const b = new Uint8Array([0, 0, 1, 2, 255]);
  assert.deepEqual(base58ToBytes(bytesToBase58(b)), b);
  assert.equal(implicitAccountId(publicKey), Buffer.from(pubBytes).toString('hex'));
  assert.throws(() => normalizeSignature(b64encode(new Uint8Array(10))), /length/);
});
