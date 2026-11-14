// Token usage helpers (src/near/usage.js): context fill + cost estimate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtTokens, normalizeUsage, usageCostUsd, contextFill, conversationCostUsd, fmtUsdSmall } from '../src/near/usage.js';
import { nearAiRequestBody } from '../src/utils/outbound.js';

test('fmtTokens: compact token counts', () => {
  assert.equal(fmtTokens(950), '950');
  assert.equal(fmtTokens(12400), '12.4k');
  assert.equal(fmtTokens(32000), '32k');
  assert.equal(fmtTokens(131072), '131k');
  assert.equal(fmtTokens(1048576), '1.05M');
  assert.equal(fmtTokens(null), '—');
});

test('normalizeUsage: reads the stream usage chunk; rejects junk', () => {
  assert.deepEqual(
    normalizeUsage({ prompt_tokens: 14, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 1 } }),
    { prompt: 14, completion: 2, reasoning: 1 },
  );
  assert.deepEqual(normalizeUsage({ prompt_tokens: 5, reasoning_tokens: 3 }), { prompt: 5, completion: 0, reasoning: 3 });
  assert.equal(normalizeUsage(null), null);
  assert.equal(normalizeUsage({ completion_tokens: 3 }), null);
});

test('usageCostUsd: tokens × public price; unknown price ⇒ null, never 0', () => {
  const u = { prompt: 1_000_000, completion: 500_000, reasoning: 0 };
  assert.equal(usageCostUsd(u, { inUsdPerM: 0.2, outUsdPerM: 0.8 }), 0.6);
  assert.equal(usageCostUsd(u, null), null);
  assert.equal(usageCostUsd(u, { inUsdPerM: 0.2, outUsdPerM: null }), null);
  assert.equal(usageCostUsd(null, { inUsdPerM: 1, outUsdPerM: 1 }), null);
});

test('contextFill: last answer with usage against the model window', () => {
  const msgs = [
    { role: 'user', text: 'a' },
    { role: 'ai', usage: { prompt: 1000, completion: 200 } },
    { role: 'user', text: 'b' },
    { role: 'ai', usage: { prompt: 3000, completion: 1000 } },
    { role: 'ai', text: 'Not sent — cancelled' }, // no usage: skipped
  ];
  assert.deepEqual(contextFill(msgs, 40000), { used: 4000, max: 40000, pct: 10 });
  assert.deepEqual(contextFill([], 40000), { used: null, max: 40000, pct: null }, 'max shown before the first answer');
  assert.deepEqual(contextFill(msgs, null), { used: 4000, max: null, pct: null }, 'unknown window: no percentage');
  assert.equal(contextFill([{ usage: { prompt: 90000, completion: 20000 } }], 100000).pct, 100, 'capped at 100%');
});

test('conversationCostUsd sums per-answer estimates; fmtUsdSmall', () => {
  assert.equal(conversationCostUsd([{ usage: { costUsd: 0.001 } }, { usage: { costUsd: null } }, { usage: { costUsd: 0.002 } }, {}]), 0.003);
  assert.equal(conversationCostUsd([{ usage: { costUsd: null } }]), null);
  assert.equal(fmtUsdSmall(0.00421), '$0.0042');
  assert.equal(fmtUsdSmall(1.268), '$1.27');
  assert.equal(fmtUsdSmall(0.00000458), '<$0.0001');
  assert.equal(fmtUsdSmall(0), '$0.0000');
});

test('nearAiRequestBody asks NEAR AI for the usage chunk', () => {
  assert.deepEqual(nearAiRequestBody('z-ai/glm-5.3-flash', []).stream_options, { include_usage: true });
});
