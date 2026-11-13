// "Simulate tampered answer" on the Verified receipt: re-runs the SDK's real
// signature check on the answer's bytes, once as received and once with one
// byte flipped. Offline, with locally generated keys standing in for the
// enclave's (as in claims.test.mjs). With a real NEAR AI answer:
// nearai.test.mjs live "verified E2EE stream…".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, sha256 } from 'ethers';
import { ed25519 } from '@noble/curves/ed25519';
import {
  tamperTest, tamperedReceipt, hasTamperEvidence, _keepEvidenceForTest, verificationChecks, receiptVerified,
} from '../src/near/nearAiContext.js';

const enc = (o) => new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o));
const h = (b) => sha256(b).slice(2);
const MODEL = 'deepseek-ai/DeepSeek-V3.1';
const REQ = enc({ model: MODEL, messages: [{ role: 'user', content: 'what does WALLET_1 hold?' }] });
const RES = enc('data: {"choices":[{"delta":{"content":"WALLET_1 holds 1,235 USDC."}}]}\n\ndata: [DONE]\n\n');

async function providerTeeEvidence() {
  const key = Wallet.createRandom();
  const text = `${MODEL}:${h(REQ)}:${h(RES)}`;
  const signer = { signingAlgo: 'ecdsa', signingAddress: key.address };
  return {
    requestBody: REQ, responseBody: RES, kind: 'provider_tee',
    signature: { kind: 'provider_tee', signer, signedText: text, signature: await key.signMessage(text) },
    attestation: { signer },
  };
}

// A receipt that passes every check, as the panel gets it.
const goodReceipt = (id) => ({
  provider: 'NEAR AI Cloud', tier: 'tee', e2ee: true,
  attestation: { gateway: { tcbStatus: 'UpToDate' }, models: [{ tcbStatus: 'UpToDate', gpuEvidence: 'verified' }], verifiedAt: Date.now() },
  response: { ok: true, kind: 'provider_tee', id },
});

test('tamper test: real bytes verify, every flipped byte of the answer is rejected', async () => {
  _keepEvidenceForTest('chatcmpl-t1', await providerTeeEvidence());
  assert.equal(hasTamperEvidence('chatcmpl-t1'), true);
  const r = await tamperTest('chatcmpl-t1');
  assert.deepEqual(r.original, { ok: true, code: null });
  assert.equal(r.tampered.ok, false);
  assert.equal(r.tampered.code, 'signature.payload_mismatch');
  assert.equal(r.tampered.byteIndex, RES.length >> 1);
  assert.equal(r.tampered.length, RES.length);
  for (let i = 0; i < RES.length; i++) {
    const x = await tamperTest('chatcmpl-t1', i);
    assert.equal(x.tampered.code, 'signature.payload_mismatch', `byte ${i}`);
  }
});

test('tamper test: stored evidence is never modified by a run', async () => {
  const e = await providerTeeEvidence();
  const before = Uint8Array.from(e.responseBody);
  _keepEvidenceForTest('chatcmpl-t2', e);
  await tamperTest('chatcmpl-t2');
  assert.deepEqual(e.responseBody, before);
  assert.equal((await tamperTest('chatcmpl-t2')).original.ok, true, 'still verifies after a run');
});

test('tamper test: gateway (ed25519) signatures use the gateway verifier', async () => {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = Buffer.from(ed25519.getPublicKey(priv)).toString('hex');
  const text = `${h(REQ)}:${h(RES)}`;
  const signer = { signingAlgo: 'ed25519', signingAddress: pub };
  _keepEvidenceForTest('chatcmpl-g1', {
    requestBody: REQ, responseBody: RES, kind: 'gateway', attestation: { signer },
    signature: { kind: 'gateway', signer, signedText: text, signature: Buffer.from(ed25519.sign(enc(text), priv)).toString('hex') },
  });
  const r = await tamperTest('chatcmpl-g1');
  assert.equal(r.original.ok, true);
  assert.equal(r.tampered.code, 'signature.payload_mismatch');
});

test('tampered receipt fails through the same verificationChecks(); the real one is untouched', async () => {
  _keepEvidenceForTest('chatcmpl-t3', await providerTeeEvidence());
  const real = goodReceipt('chatcmpl-t3');
  assert.equal(receiptVerified(real), true);
  const fake = tamperedReceipt(real, await tamperTest('chatcmpl-t3'));
  assert.equal(receiptVerified(fake), false);
  const sig = verificationChecks(fake).find((c) => c.id === 'signature');
  assert.equal(sig.ok, false);
  assert.match(sig.detail, /signature\.payload_mismatch \(simulated: byte \d+ of \d+ flipped\)/);
  assert.equal(real.response.ok, true, 'real receipt not mutated');
});

test('tamper test: unknown answer (e.g. from before a reload) says so', async () => {
  assert.equal(hasTamperEvidence('nope'), false);
  await assert.rejects(() => tamperTest('nope'), /No evidence for this answer/);
});

test('tamper test: keeps only the most recent 20 answers in memory', async () => {
  const e = await providerTeeEvidence();
  for (let i = 0; i < 25; i++) _keepEvidenceForTest(`cap-${i}`, e);
  assert.equal(hasTamperEvidence('cap-0'), false);
  assert.equal(hasTamperEvidence('cap-24'), true);
});
