// A REAL NEAR AI receipt, verified offline. fixtures/nearai-receipt/ was
// captured once from NEAR AI Cloud by spike/capture-receipt.mjs (the app's own
// NearAiContext). Unlike claims.test.mjs A1–A5, the key here is not ours: it is
// the signer NEAR AI's attested enclave used for this answer.
//
// Established here: these exact bytes were signed by that pinned key, and any
// one flipped byte fails. NOT established here: that the key is in a genuine
// TDX enclave now (live-only; see the fixture README and LIMITS.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyReceiptBundle, RECEIPT_TYPE } from '../src/near/receiptBundle.js';

const load = (f) => JSON.parse(fs.readFileSync(new URL(`../fixtures/nearai-receipt/${f}`, import.meta.url), 'utf8'));
const bundle = load('receipt.json');
const plaintext = load('request-plaintext.json');
const att = load('attestation.json');
// Pinned: the enclave signer recorded at capture. A different key must not pass.
const PINNED = '5a0210f2442c79355784f9de021985429561da5bacc3a4424b01ac52b7e0caff';
const sha = (s) => createHash('sha256').update(s).digest('hex');

test('real receipt: NEAR AI enclave signature over the exact bytes verifies offline, signer pinned', async () => {
  assert.equal(bundle.type, RECEIPT_TYPE);
  assert.equal(bundle.kind, 'provider_tee');
  const r = await verifyReceiptBundle(bundle, { pinnedSigner: PINNED });
  assert.equal(r.signature.ok, true, r.signature.code);
  assert.equal(r.hashes.ok, true);
  assert.equal(r.ok, true);
  // The signed text is model:sha256(request):sha256(response) of these bytes.
  assert.equal(bundle.signature.signedText, `${bundle.model}:${bundle.sha256.requestBody}:${bundle.sha256.responseBody}`);
});

test('real receipt: one flipped byte of the answer or the request is rejected', async () => {
  const r = await verifyReceiptBundle(bundle);
  assert.equal(r.tamper.ok, false);
  assert.equal(r.tamper.code, 'signature.payload_mismatch');
  const req = Buffer.from(bundle.requestBody, 'base64'); req[req.length >> 1] ^= 1;
  const bad = await verifyReceiptBundle({ ...bundle, requestBody: req.toString('base64'), sha256: { ...bundle.sha256, requestBody: sha(req) } });
  assert.equal(bad.signature.ok, false);
  assert.equal(bad.signature.code, 'signature.payload_mismatch');
});

test('real receipt: a different pinned signer, a swapped signer or a forged signature is rejected', async () => {
  assert.equal((await verifyReceiptBundle(bundle, { pinnedSigner: 'ab'.repeat(32) })).signature.code, 'signer.not_pinned');
  const swapped = await verifyReceiptBundle({ ...bundle, signer: { ...bundle.signer, signingAddress: 'ab'.repeat(32) } });
  assert.equal(swapped.ok, false);
  const s = bundle.signature.signature;
  const forged = await verifyReceiptBundle({ ...bundle, signature: { ...bundle.signature, signature: (s[0] === '0' ? '1' : '0') + s.slice(1) } });
  assert.equal(forged.ok, false);
  assert.equal((await verifyReceiptBundle({ ...bundle, type: 'x' })).signature.code, 'bundle.wrong_type');
});

test('real receipt: what was asked carries no real identifier (only hashes of them are kept)', () => {
  const wire = JSON.stringify(plaintext.messages);
  assert.doesNotMatch(wire, /0x[0-9a-fA-F]{8}/);
  assert.doesNotMatch(wire, /[a-z0-9_-]+\.(near|tg)\b/i);
  assert.match(wire, /WALLET_1/);
  // Every 0x… / *.near token in the plaintext would hash to a real one if leaked.
  const tokens = wire.toLowerCase().match(/0x[0-9a-f]{40}|[a-z0-9_-]+\.near/g) || [];
  for (const t of tokens) assert.ok(!plaintext.realIdentifiersHashed.includes('sha256:' + sha(t)), `leaked ${t}`);
  // The signed request is the E2EE wire form: message content is ciphertext, not prose.
  const signedReq = JSON.parse(Buffer.from(bundle.requestBody, 'base64').toString('utf8'));
  for (const m of signedReq.messages) assert.match(m.content, /^[0-9a-f]+$/, 'E2EE content is hex ciphertext');
});

test('real receipt: the live checks at capture are recorded, all passed, and labelled not re-proven offline', () => {
  assert.equal(att.liveChecks.length, 6);
  for (const c of att.liveChecks) assert.equal(c.ok, true, `${c.id}: ${c.detail}`);
  assert.match(att.note, /not re-verifiable offline/i);
});

// LIVE, no API key: closes the offline gap above. Fresh model attestations
// (new nonce), TDX + NVIDIA verified, and the pinned signer must be among them.
test('live: the receipt signer is an attested NEAR AI enclave key right now (fresh nonce, no API key)', { timeout: 120_000 }, async () => {
  const { checkSignerLive } = await import('../src/near/receiptBundle.js');
  const r = await checkSignerLive(bundle);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.match.gpuEvidence, 'verified');
  assert.match(r.nonce, /^[0-9a-f]{64}$/);
  const swapped = await checkSignerLive({ ...bundle, signer: { ...bundle.signer, signingAddress: 'ab'.repeat(32) } });
  assert.equal(swapped.ok, false);
});
