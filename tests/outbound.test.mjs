// "Review before sending": the preview must be the exact request the backend
// sends. Checked by intercepting what each backend actually puts on the wire
// (fetch for the external API, chat.completions.create for NEAR AI) and
// comparing it with previewRequest() for the same arguments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExternalContext } from '../src/utils/external-context.js';
import { NearAiContext } from '../src/near/nearAiContext.js';
import { describeOutbound, markPlaceholders } from '../src/utils/outbound.js';
import { pseudonymizeForRemote } from '../src/utils/pseudonymize.js';
import { buildAnalysisMessages } from '../src/prompts/wallet-analysis.js';

const W1 = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const r = pseudonymizeForRemote({ addresses: [W1], usdPortfolio: { totalUsd: 140439.79 } }, `is ${W1} safe?`, { sigFigs: 4 });
const MESSAGES = buildAnalysisMessages(r.facts, r.question);

const sse = () => new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 });

test('external: previewRequest body is byte-identical to what analyze() POSTs', async () => {
  const ctx = new ExternalContext();
  await ctx.initialize({ baseUrl: 'https://llm.example.com/v1', apiKey: 'sk-test-not-real', model: 'some-model' });
  let wire = null;
  globalThis.fetch = async (url, init) => { wire = { url, init }; return sse(); };
  await ctx.analyze(MESSAGES, () => {}, null, { thinking: false });
  const preview = ctx.previewRequest(MESSAGES);
  assert.equal(wire.init.body, JSON.stringify(preview.body));
  assert.equal(preview.baseUrl, 'https://llm.example.com/v1');
  assert.ok(!JSON.stringify(preview).includes('sk-test-not-real'), 'the API key is not part of the preview');
  assert.equal(wire.init.headers['x-llm-api-key'], 'sk-test-not-real', 'it goes in a header');
});

test('NEAR AI: previewRequest body deep-equals what is handed to the SDK (Think on and off)', async () => {
  for (const thinking of [false, true]) {
    for (const reasoningBudget of [undefined, 0, 2000]) {
      const ctx = new NearAiContext();
      let sent = null;
      ctx.modelLoaded = true;
      ctx.config = { model: 'z-ai/glm-5.3-flash' };
      ctx.client = {
        verify: async () => ({}),
        chat: { completions: { create: async (body) => { sent = body; return (async function* () {})(); } } },
        verifyResponse: async () => ({}),
      };
      try { await ctx.analyze(MESSAGES, () => {}, null, { thinking, reasoningBudget }); } catch { /* receipt summary may reject the stub */ }
      assert.ok(sent, 'request reached the SDK');
      assert.deepEqual(ctx.previewRequest(MESSAGES, { thinking, reasoningBudget }).body, sent, `thinking=${thinking} budget=${reasoningBudget}`);
    }
  }
});

test('describeOutbound: counts placeholders, states who can read it, shows the sent question', () => {
  const ctx = new ExternalContext();
  ctx.config = { baseUrl: 'https://llm.example.com/v1', model: 'm' };
  const d = describeOutbound({ mode: 'external', request: ctx.previewRequest(MESSAGES), question: r.question, redacted: { labels: r.labels, sigFigs: 4 } });
  assert.equal(d.destination, 'llm.example.com');
  assert.equal(d.readable, 'operator');
  assert.equal(d.question, 'is WALLET_1 safe?');
  assert.equal(d.placeholders, 1);
  assert.equal(d.sigFigs, 4);
  assert.ok(!d.json.includes(W1.toLowerCase().slice(2, 10)) && !d.json.includes(W1.slice(2, 10)));
  assert.ok(d.json.includes('140400'));
  const off = describeOutbound({ mode: 'nearai', request: { body: { model: 'x', messages: [] } }, question: 'q', redacted: null });
  assert.equal(off.pseudonymized, false);
  assert.equal(off.readable, 'enclave');
});

test('markPlaceholders splits text into highlighted runs', () => {
  assert.deepEqual(markPlaceholders('send WALLET_1 to ADDR_12.'), [
    { text: 'send ', mark: false }, { text: 'WALLET_1', mark: true }, { text: ' to ', mark: false }, { text: 'ADDR_12', mark: true }, { text: '.', mark: false },
  ]);
  assert.deepEqual(markPlaceholders('none here'), [{ text: 'none here', mark: false }]);
});
