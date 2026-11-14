// Per-model reasoning params for NEAR AI (src/near/reasoningProfiles.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { reasoningProfile, reasoningParams } from '../src/near/reasoningProfiles.js';
import { nearAiRequestBody } from '../src/utils/outbound.js';

test('reasoningParams: each model gets the switch it actually honours', () => {
  // vLLM chat-template switch (NEAR TEE Qwen / DeepSeek V4.1, and unknown models)
  for (const m of ['Qwen/Qwen3.8-27B', 'deepseek-ai/DeepSeek-V4.1-Flash-1017', 'some/unknown-model']) {
    assert.deepEqual(reasoningParams(m, { thinking: false }), { chat_template_kwargs: { enable_thinking: false } }, m);
    assert.deepEqual(reasoningParams(m, { thinking: true }), { chat_template_kwargs: { enable_thinking: true } }, m);
  }
  // Kimi: `thinking`, not `enable_thinking`
  assert.deepEqual(reasoningParams('moonshotai/kimi-k3', { thinking: false }), { chat_template_kwargs: { thinking: false } });
  assert.deepEqual(reasoningParams('moonshotai/kimi-k3', { thinking: true }), {});
  // GLM-5.3 Flash: enable_thinking:false leaks reasoning into the answer → lowest effort instead
  assert.deepEqual(reasoningParams('z-ai/glm-5.3-flash', { thinking: false }), { reasoning_effort: 'low' });
  // DeepSeek V3.2 (Chutes) reasons only when an effort is sent
  assert.deepEqual(reasoningParams('deepseek/deepseek-v3.2', { thinking: false }), {});
  assert.deepEqual(reasoningParams('deepseek/deepseek-v3.2', { thinking: true }), { reasoning_effort: 'medium' });
  assert.deepEqual(reasoningParams('deepseek/deepseek-v3.2', { thinking: true, effort: 'high' }), { reasoning_effort: 'high' });
});

test('reasoningParams: effort is sent only when the model accepts that value', () => {
  assert.equal(reasoningParams('Qwen/Qwen3.8-27B', { thinking: true, effort: 'xhigh' }).reasoning_effort, 'xhigh');
  assert.equal(reasoningParams('Qwen/Qwen3.8-27B', { thinking: true, effort: 'high' }).reasoning_effort, undefined, 'high is a 400 on Qwen3.8');
  assert.equal(reasoningParams('deepseek-ai/DeepSeek-V4.1-Flash-1017', { thinking: true, effort: 'medium' }).reasoning_effort, undefined);
  assert.equal(reasoningParams('some/unknown-model', { thinking: true, effort: 'low' }).reasoning_effort, undefined);
  assert.equal(reasoningParams('Qwen/Qwen3.8-27B', { thinking: false, effort: 'low' }).reasoning_effort, undefined, 'no effort when off');
});

test('reasoningParams: a model with no off switch always reasons; budget maps to thinking_token_budget', () => {
  assert.equal(reasoningProfile('z-ai/glm-5.3').canDisable, false);
  assert.deepEqual(reasoningParams('z-ai/glm-5.3', { thinking: false, effort: 'low' }), { reasoning_effort: 'low' });
  assert.deepEqual(reasoningParams('z-ai/glm-5.3-flash', { thinking: true, budget: 32768 }), { thinking_token_budget: 32768 });
  assert.deepEqual(reasoningParams('z-ai/glm-5.3-flash', { thinking: true, budget: 0 }), { thinking_token_budget: null });
  assert.deepEqual(reasoningParams('z-ai/glm-5.3-flash', { thinking: true }), {});
  assert.equal(reasoningParams('Qwen/Qwen3.8-27B', { thinking: true, budget: 8192 }).thinking_token_budget, undefined);
  assert.equal(reasoningProfile('z-ai/glm-5.3-flash').canDisable, true);
  assert.deepEqual(reasoningProfile('moonshotai/kimi-k2.6').efforts, []);
});

test('nearAiRequestBody carries the per-model reasoning params', () => {
  const b = nearAiRequestBody('moonshotai/kimi-k3', [], { thinking: false, maxTokens: 4096 });
  assert.deepEqual(b.chat_template_kwargs, { thinking: false });
  assert.equal(b.max_tokens, 4096);
  const c = nearAiRequestBody('Qwen/Qwen3.8-27B', [], { thinking: true, effort: 'low' });
  assert.equal(c.reasoning_effort, 'low');
  assert.equal('max_tokens' in c, false);
});
