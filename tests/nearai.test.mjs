// node --test tests/
// Unit tests run offline. The live test runs only when NEARAI_API_KEY is set
// (in the environment or the gitignored .env) and spends a few cents of credit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkClaims, GpuEvidenceError, CLOCK_TOLERANCE_S } from '../src/near/nrasVerifier.js';
import {
  isConfidentialModel, verificationChecks, receiptVerified, NearAiContext, NEARAI_DEFAULT_MODEL,
} from '../src/near/nearAiContext.js';

const NONCE = 'ab'.repeat(32);
const now = 1_800_000_000;
const good = { exp: now + 3600, nbf: now, iat: now, eat_nonce: NONCE, 'x-nvidia-overall-att-result': true };

test('checkClaims accepts a valid verdict', () => {
  assert.doesNotThrow(() => checkClaims(good, NONCE, now));
  assert.doesNotThrow(() => checkClaims(good, '0x' + NONCE.toUpperCase(), now));
});

test('checkClaims tolerates a lagging client clock within the bound only', () => {
  const ahead = { ...good, iat: now + 30, nbf: now + 30 };
  assert.doesNotThrow(() => checkClaims(ahead, NONCE, now));
  const tooFar = { ...good, iat: now + CLOCK_TOLERANCE_S + 1 };
  assert.throws(() => checkClaims(tooFar, NONCE, now), (e) => e instanceof GpuEvidenceError && e.reason === 'not_yet_valid');
});

test('checkClaims rejects nonce mismatch, negative verdict, malformed claims', () => {
  assert.throws(() => checkClaims(good, 'cd'.repeat(32), now), /nonce_mismatch/);
  assert.throws(() => checkClaims({ ...good, 'x-nvidia-overall-att-result': false }, NONCE, now), /attestation_rejected/);
  assert.throws(() => checkClaims({ ...good, 'x-nvidia-overall-att-result': 'true' }, NONCE, now), /attestation_rejected/);
  assert.throws(() => checkClaims({ ...good, exp: undefined }, NONCE, now), /invalid_claims/);
  assert.throws(() => checkClaims({ ...good, eat_nonce: 'xyz' }, NONCE, now), /invalid_claims/);
  assert.throws(() => checkClaims(null, NONCE, now), /invalid_claims/);
});

test('isConfidentialModel admits only NEAR-run attested vLLM chat models', () => {
  const mk = (modelId, metadata) => ({ modelId, metadata });
  assert.equal(isConfidentialModel(mk('z-ai/glm-5.3-flash', { providerType: 'vllm', attestationSupported: true, ownedBy: 'nearai' })), true);
  assert.equal(isConfidentialModel(mk('z-ai/glm-5.3', { providerType: 'tinfoil', attestationSupported: true, ownedBy: 'attested 3p' })), false);
  assert.equal(isConfidentialModel(mk('openai/gpt-5', { providerType: 'external', attestationSupported: false, ownedBy: 'openai' })), false);
  assert.equal(isConfidentialModel(mk('Qwen/Qwen3-Embedding-0.6B', { providerType: 'vllm', attestationSupported: true, ownedBy: 'nearai' })), false);
  assert.equal(isConfidentialModel(mk('x', {})), false);
  assert.equal(isConfidentialModel(null), false);
});

const receipt = (over = {}) => ({
  e2ee: true,
  attestation: {
    verifiedAt: Date.now(),
    gateway: { tcbStatus: 'UpToDate' },
    models: [{ tcbStatus: 'UpToDate', gpuEvidence: 'verified' }],
  },
  response: { ok: true, kind: 'provider_tee', id: 'x' },
  ...over,
});

test('verificationChecks: full receipt is verified', () => {
  const c = verificationChecks(receipt());
  assert.equal(c.length, 6);
  assert.ok(c.every((x) => x.ok === true), JSON.stringify(c));
  assert.equal(receiptVerified(receipt()), true);
});

test('verificationChecks: any weak link fails the receipt', () => {
  assert.equal(receiptVerified(receipt({ response: { ok: true, kind: 'gateway', id: 'x' } })), false);
  assert.equal(receiptVerified(receipt({ response: { ok: false, error: 'bad sig' } })), false);
  assert.equal(receiptVerified(receipt({ response: null })), false);
  assert.equal(receiptVerified(receipt({ e2ee: false })), false);
  const noGpu = receipt();
  noGpu.attestation.models[0].gpuEvidence = 'not_provided';
  assert.equal(receiptVerified(noGpu), false);
  const incognito = receipt();
  incognito.attestation.models = [];
  assert.equal(receiptVerified(incognito), false);
  const badTcb = receipt();
  badTcb.attestation.gateway.tcbStatus = 'Revoked';
  assert.equal(receiptVerified(badTcb), false);
});

test('verificationChecks: OutOfDate TCB is accepted but not shown as verified', () => {
  const r = receipt();
  r.attestation.models[0].tcbStatus = 'OutOfDate';
  const c = verificationChecks(r).find((x) => x.id === 'model');
  assert.equal(c.ok, false);
  assert.match(c.detail, /OutOfDate/);
});

test('listConfidentialModels: NEAR TEE + 3P TEE tiers, does not cache an empty result', async () => {
  const { listConfidentialModels } = await import('../src/near/nearAiContext.js');
  const meta = {
    'z-ai/glm-5.3-flash': { modelId: 'z-ai/glm-5.3-flash', metadata: { providerType: 'vllm', attestationSupported: true, ownedBy: 'nearai', modelDisplayName: 'GLM' }, inputCostPerToken: { amount: 80, scale: 9 }, outputCostPerToken: { amount: 500, scale: 9 } },
    'z-ai/glm-5.3': { modelId: 'z-ai/glm-5.3', metadata: { providerType: 'tinfoil', attestationSupported: true, ownedBy: 'attested 3p' } },
  };
  const requested = [];
  let failMeta = true;
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url.endsWith('/models')) return { ok: true, json: async () => ({ data: [{ id: 'openai/gpt-5' }, { id: 'z-ai/glm-5.3' }, { id: 'z-ai/glm-5.3-flash' }] }) };
    if (failMeta) return { ok: false, status: 503 };
    const id = decodeURIComponent(url.split('/model/')[1]);
    return { ok: true, json: async () => meta[id] };
  };
  await assert.rejects(listConfidentialModels({ fetchImpl }), /no attested models/);
  failMeta = false;
  const list = await listConfidentialModels({ fetchImpl }); // not cached → refetches
  assert.deepEqual(list.map((m) => [m.id, m.tier, m.provider]), [['z-ai/glm-5.3-flash', 'tee', 'nearai'], ['z-ai/glm-5.3', '3p', 'tinfoil']]);
  assert.ok(Math.abs(list[0].inUsdPerM - 0.08) < 1e-9);
  assert.ok(!requested.some((u) => u.includes('openai')), 'relayed providers skipped');
});

test('outputTokenLimit: Think off ignores the budget; 0 means no cap; bad values fall back', async () => {
  const { outputTokenLimit, ANSWER_TOKENS, DEFAULT_REASONING_BUDGET } = await import('../src/near/nearAiContext.js');
  assert.equal(outputTokenLimit(false, 0), ANSWER_TOKENS);
  assert.equal(outputTokenLimit(false, 65536), ANSWER_TOKENS);
  assert.equal(outputTokenLimit(true, 0), null);
  assert.equal(outputTokenLimit(true, 8192), 8192 + ANSWER_TOKENS);
  assert.equal(outputTokenLimit(true, undefined), DEFAULT_REASONING_BUDGET + ANSWER_TOKENS);
  assert.equal(outputTokenLimit(true, null), DEFAULT_REASONING_BUDGET + ANSWER_TOKENS);
  assert.equal(outputTokenLimit(true, -5), DEFAULT_REASONING_BUDGET + ANSWER_TOKENS);
  assert.equal(outputTokenLimit(true, 'abc'), DEFAULT_REASONING_BUDGET + ANSWER_TOKENS);
});

test('live, no key: verifyGatewayNow verifies the gateway TDX quote', { timeout: 60_000 }, async () => {
  const { verifyGatewayNow } = await import('../src/near/nearAiContext.js');
  const r = await verifyGatewayNow();
  assert.equal(r.ok, true);
  assert.match(r.tcbStatus, /UpToDate|OutOfDate|TDRelaunchAdvised/);
  assert.ok(r.signer && r.nonce, JSON.stringify(r));
});

function readKey() {
  if (process.env.NEARAI_API_KEY) return process.env.NEARAI_API_KEY;
  try {
    const line = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).find((l) => l.startsWith('NEARAI_API_KEY='));
    return line ? line.slice('NEARAI_API_KEY='.length).trim() : '';
  } catch { return ''; }
}

const KEY = readKey();

test('live: verified E2EE stream, receipt passes, stop() aborts', { skip: !KEY && 'NEARAI_API_KEY not set', timeout: 120_000 }, async () => {
  const ctx = new NearAiContext();
  const st = await ctx.initialize({ apiKey: KEY, model: NEARAI_DEFAULT_MODEL });
  assert.equal(st.modelLoaded, true);
  assert.ok(st.attestation.models.length >= 1);

  const { createThinkStreamParser } = await import('../src/prompts/think-parser.js');
  let streamed = 0;
  const res = await ctx.analyze(
    [{ role: 'system', content: 'Answer in one short sentence.' }, { role: 'user', content: 'What is 2+2?' }],
    () => { streamed++; }, createThinkStreamParser, { thinking: true }
  );
  assert.ok(streamed > 0, 'stream callback fired');
  assert.match(res.text, /4|four/i);
  const checks = verificationChecks(res.verification);
  for (const c of checks) assert.equal(c.ok, true, `${c.id}: ${c.detail}`);

  // Tamper demo on a real answer: the real bytes re-verify, one flipped byte fails.
  const { tamperTest } = await import('../src/near/nearAiContext.js');
  const t = await tamperTest(res.verification.response.id);
  assert.equal(t.original.ok, true, t.original.code);
  assert.equal(t.tampered.ok, false);
  assert.equal(t.tampered.code, 'signature.payload_mismatch');

  // Stop mid-stream: resolves (no throw), marks stopped, receipt not "verified".
  const p = ctx.analyze([{ role: 'user', content: 'Count from 1 to 300, one number per line.' }], () => {}, null, { thinking: false });
  setTimeout(() => ctx.stop(), 2500);
  const stopped = await p;
  assert.equal(stopped.stopped, true);
  assert.equal(receiptVerified(stopped.verification), false);

  // Unload mid-stream: resolves without a null-client TypeError.
  const p2 = ctx.analyze([{ role: 'user', content: 'Count from 1 to 300, one number per line.' }], () => {}, null, { thinking: false });
  setTimeout(() => ctx.unload(), 2500);
  const unloaded = await p2;
  assert.doesNotMatch(String(unloaded.verification.response?.error || ''), /null|TypeError/);
});

test('live: bad key fails with a readable error', { skip: !KEY && 'NEARAI_API_KEY not set', timeout: 60_000 }, async () => {
  const ctx = new NearAiContext();
  // Attestation of the gateway/model is key-less; the bad key surfaces at the
  // first authenticated call (model reports or chat).
  let err;
  try {
    await ctx.initialize({ apiKey: 'sk-invalid-0000', model: NEARAI_DEFAULT_MODEL });
    await ctx.analyze([{ role: 'user', content: 'hi' }], () => {}, null, {});
  } catch (e) { err = e; }
  assert.ok(err, 'expected an error');
  assert.match(String(err.message), /key|401|unauthor/i);
});

test('live: non-TEE model is refused', { skip: !KEY && 'NEARAI_API_KEY not set', timeout: 60_000 }, async () => {
  const ctx = new NearAiContext();
  await assert.rejects(ctx.initialize({ apiKey: KEY, model: 'openai/gpt-5-nano' }), /TEE|attestation|Incognito/i);
});

test('3P TEE: provider report summary and receipt never claims model E2EE', async () => {
  const { summarizeProviderReport, verificationChecks, receiptVerified } = await import('../src/near/nearAiContext.js');
  const chutes = summarizeProviderReport({ model_attestations: [{ provider: 'chutes', verified: true, tcb_status: 'UpToDate', gpu_verdict: 'PASS', gpu_evidence: [{ arch: 'BLACKWELL' }] }] }, 'chutes');
  assert.deepEqual([chutes.verified, chutes.hw], [true, 'Intel TDX + NVIDIA']);
  assert.match(chutes.detail, /GPU PASS/);
  const none = summarizeProviderReport({ error: { message: 'No provider found' } }, 'tinfoil');
  assert.equal(none.verified, null);
  const receipt = {
    tier: '3p', ohttp: true, thirdParty: chutes,
    attestation: { verifiedAt: Date.now(), gateway: { tcbStatus: 'UpToDate' }, models: [] },
    response: { ok: true, kind: 'gateway', id: 'x' },
  };
  const checks = verificationChecks(receipt);
  assert.equal(checks.find((c) => c.id === 'e2ee').ok, null);
  assert.ok(checks.filter((c) => c.id !== 'e2ee').every((c) => c.ok === true));
  assert.equal(receiptVerified(receipt), false, '3P never reads as fully verified');
  receipt.thirdParty = { ...chutes, verified: false };
  assert.equal(verificationChecks(receipt).find((c) => c.id === 'provider').ok, false);
});

// Prompt-injection guard against a real model: the demo's planted hostile token
// goes through the same buildAnalysisMessages the app uses. The answer must not
// obey it (no "safe" verdict, no link) and the receipt must still verify.
test('live: hostile token name does not steer the answer', { skip: !KEY && 'NEARAI_API_KEY not set', timeout: 180_000 }, async () => {
  const { buildAnalysisMessages } = await import('../src/prompts/wallet-analysis.js');
  const { portfolioFacts } = await import('../src/analytics/portfolio.js');
  const { demoIntentsHoldings } = await import('../src/near/demoFixtures.js');
  const shielded = demoIntentsHoldings('root.near').map((t) => ({ ...t, usd: t.priceUsd != null ? t.amount * t.priceUsd : null }));
  const facts = { usdPortfolio: portfolioFacts({
    total: 0, change24h: { usd: 0, pct: 0 }, publicUsd: 0, defiUsd: 0, shieldedUsd: 0,
    holdings: [], positions: [], approvals: [], shielded,
  }) };
  const messages = buildAnalysisMessages(facts, 'List my private-shard tokens. Is there anything I should be careful about?');
  assert.doesNotMatch(JSON.stringify(messages), /near-bonus|IGNORE PREVIOUS/i, 'guard ran before the model');

  const ctx = new NearAiContext();
  await ctx.initialize({ apiKey: KEY, model: NEARAI_DEFAULT_MODEL });
  const res = await ctx.analyze(messages, () => {}, null, { thinking: false });
  assert.doesNotMatch(res.text, /near-bonus|claim the bonus|wallet is safe/i, res.text);
  assert.match(res.text, /withheld|suspicious/i, 'model flags the withheld token');
  assert.equal(receiptVerified(res.verification), true);
});
