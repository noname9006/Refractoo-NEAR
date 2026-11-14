// Per-model reasoning controls for NEAR AI Cloud.
//
// There is no single switch: each model (and each provider behind the gateway)
// honours a different parameter, and a wrong one is silently ignored — or, on
// GLM, moves the reasoning into the answer text. Every profile below was
// verified live with spike/reasoning-probe.mjs (2026-11-14); see also
// https://docs.near.ai/cloud/reasoning-models.
//
// Profile shape:
//   off      body params that switch reasoning off, or null when it cannot be
//            switched off (the Think toggle is then locked on)
//   on       body params that switch reasoning on ({} = on by default)
//   efforts  accepted `reasoning_effort` values, lowest → highest ([] = none)
//   onEffort effort sent when Think is on and the user picked "Default"
//            (only for models that reason ONLY when an effort is sent)
//   budget   true if `thinking_token_budget` caps the reasoning tokens
const ENABLE_THINKING = (v) => ({ chat_template_kwargs: { enable_thinking: v } });
const KIMI_THINKING = (v) => ({ chat_template_kwargs: { thinking: v } });

const PROFILES = [
  // NEAR TEE. enable_thinking:false leaks the reasoning into `content`; the
  // lowest effort is the only real "off" (~10–20 reasoning tokens).
  { re: /^z-ai\/glm-5\.3-flash/i, off: { reasoning_effort: 'low' }, on: {}, efforts: [], budget: true },
  // 3P TEE (Tinfoil). Always reasons; `none`/enable_thinking:false leak into
  // the answer. low ≈ 10 tokens, high ≈ 130, max ≈ 600 on the probe prompt.
  { re: /^z-ai\/glm-5\.3$/i, off: null, on: {}, efforts: ['low', 'high', 'max'], budget: true },
  // 3P TEE (Chutes). enable_thinking is ignored; `thinking` is the switch.
  { re: /^moonshotai\/kimi-k3/i, off: KIMI_THINKING(false), on: {}, efforts: ['low', 'high', 'xhigh'] },
  { re: /^moonshotai\/kimi-k2/i, off: KIMI_THINKING(false), on: {}, efforts: [] },
  // 3P TEE (Chutes). Does not reason unless an effort is sent.
  { re: /^deepseek\/deepseek-v3\.2/i, off: {}, on: {}, efforts: ['low', 'medium', 'high'], onEffort: 'medium' },
  // NEAR TEE. Other effort values are rejected with a 400.
  { re: /^qwen\/qwen3\.8/i, off: ENABLE_THINKING(false), on: ENABLE_THINKING(true), efforts: ['low', 'medium', 'xhigh'] },
  { re: /^deepseek-ai\/deepseek-v4\.1/i, off: ENABLE_THINKING(false), on: ENABLE_THINKING(true), efforts: ['low', 'high', 'xhigh', 'max'] },
];

// Unknown model: the vLLM chat-template switch most NEAR-hosted models honour.
const FALLBACK = { off: ENABLE_THINKING(false), on: ENABLE_THINKING(true), efforts: [] };

export function reasoningProfile(model) {
  const id = String(model || '');
  const p = PROFILES.find((x) => x.re.test(id)) || FALLBACK;
  return { canDisable: p.off !== null, efforts: p.efforts, budget: !!p.budget };
}

// Body params for one request. `thinking` is the Think toggle, `effort` the
// user's pick ('' / unknown / not accepted by this model ⇒ model default),
// `budget` the reasoning budget in tokens (0 = unlimited, undefined = unset).
export function reasoningParams(model, { thinking = true, effort = '', budget } = {}) {
  const id = String(model || '');
  const p = PROFILES.find((x) => x.re.test(id)) || FALLBACK;
  if (!thinking && p.off !== null) return { ...p.off };
  const out = { ...p.on };
  const e = p.efforts.includes(effort) ? effort : (p.onEffort || '');
  if (e) out.reasoning_effort = e;
  if (p.budget && budget != null) {
    const b = Number(budget);
    // null lifts the provider's default cap (8192 on GLM-5.3 Flash).
    if (b === 0) out.thinking_token_budget = null;
    else if (Number.isFinite(b) && b > 0) out.thinking_token_budget = Math.round(b);
  }
  return out;
}
