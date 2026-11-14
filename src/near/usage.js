// Token usage helpers for the assistant: context-window fill and a cost
// estimate. Pure — no network. NEAR AI streams a final `usage` chunk when the
// request sets stream_options.include_usage (see utils/outbound.js).
//
// A NEAR AI *inference* key cannot read the account balance or its spend limit
// (those endpoints need a cloud.near.ai session token — verified live with
// spike/key-info-probe.mjs), so cost here is computed from the token counts and
// the public per-model price, and is an estimate.

// 950 → "950", 12 400 → "12.4k", 131 072 → "131k", 1 048 576 → "1.05M".
export function fmtTokens(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1000) return String(Math.round(n));
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
}

// OpenAI-style usage object → { prompt, completion, reasoning } or null.
export function normalizeUsage(u) {
  if (!u || !Number.isFinite(u.prompt_tokens)) return null;
  return {
    prompt: u.prompt_tokens,
    completion: Number.isFinite(u.completion_tokens) ? u.completion_tokens : 0,
    reasoning: u.completion_tokens_details?.reasoning_tokens ?? u.reasoning_tokens ?? 0,
  };
}

// USD for one request, or null when the model's price is unknown.
// `price` = { inUsdPerM, outUsdPerM } (a listConfidentialModels row).
export function usageCostUsd(usage, price) {
  if (!usage || price?.inUsdPerM == null || price?.outUsdPerM == null) return null;
  return (usage.prompt * price.inUsdPerM + usage.completion * price.outUsdPerM) / 1e6;
}

// How full the context window is, from the conversation's most recent answer
// that reported usage: everything the model read plus what it wrote is what the
// next question will carry. → { used, max, pct } (used/pct null before the
// first answer; max null when the window size is unknown).
export function contextFill(msgs, contextLength) {
  const max = Number.isFinite(contextLength) && contextLength > 0 ? contextLength : null;
  let used = null;
  for (let i = (msgs || []).length - 1; i >= 0; i--) {
    const u = msgs[i]?.usage;
    if (u && Number.isFinite(u.prompt)) { used = u.prompt + (u.completion || 0); break; }
  }
  return { used, max, pct: used != null && max ? Math.min(100, (used / max) * 100) : null };
}

// Sum of the per-answer cost estimates in a conversation (null if none).
export function conversationCostUsd(msgs) {
  let sum = 0, any = false;
  for (const m of msgs || []) if (Number.isFinite(m?.usage?.costUsd)) { sum += m.usage.costUsd; any = true; }
  return any ? sum : null;
}

// "$0.0042" for small amounts, "$1.27" otherwise.
export function fmtUsdSmall(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v > 0 && v < 0.0001) return '<$0.0001';
  return `$${v < 1 ? v.toFixed(4) : v.toFixed(2)}`;
}
