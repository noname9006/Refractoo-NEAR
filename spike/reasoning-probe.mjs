// Live probe: which reasoning controls does each NEAR AI Cloud model honour?
//
//   node spike/reasoning-probe.mjs                 → the undocumented models below
//   node spike/reasoning-probe.mjs <model> [...]   → specific model ids
//
// Key: NEARAI_API_KEY from the environment, else from .env (same as the live
// tests). Sends one tiny fixed prompt per variant — no wallet data. Plain HTTPS
// to the gateway (no E2EE/OHTTP): only the parameter handling is under test.
// Every request is capped at MAX_TOKENS, so a full run costs a few cents.
import fs from 'node:fs';

const BASE = 'https://cloud-api.near.ai/v1';
const MAX_TOKENS = 2048;
const PROMPT = 'How many prime numbers are there between 1 and 200? Reply with just the number.';

const DEFAULT_MODELS = [
  'moonshotai/kimi-k3',                    // 3P TEE (Chutes) — undocumented
  'deepseek/deepseek-v3.2',                // 3P TEE (Chutes) — undocumented
  'z-ai/glm-5.3',                          // 3P TEE (Tinfoil) — Tinfoil docs only
  'Qwen/Qwen3.8-27B',                      // NEAR TEE — undocumented
  'deepseek-ai/DeepSeek-V4.1-Flash-1017',  // NEAR TEE — undocumented
];

const VARIANTS = [
  ['baseline (no params)', {}],
  ...['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((e) => [`reasoning_effort=${e}`, { reasoning_effort: e }]),
  ['enable_thinking=false', { chat_template_kwargs: { enable_thinking: false } }],
  ['enable_thinking=true', { chat_template_kwargs: { enable_thinking: true } }],
  ['ctk.thinking=false', { chat_template_kwargs: { thinking: false } }],
  ['thinking_token_budget=64', { thinking_token_budget: 64 }],
  ['reasoning.effort=low', { reasoning: { effort: 'low' } }],
  ['reasoning.enabled=false', { reasoning: { enabled: false } }],
];

function apiKey() {
  if (process.env.NEARAI_API_KEY) return process.env.NEARAI_API_KEY.trim();
  try {
    const line = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).find((l) => l.startsWith('NEARAI_API_KEY='));
    return line ? line.slice('NEARAI_API_KEY='.length).trim() : '';
  } catch { return ''; }
}

async function probe(key, model, extra) {
  const t0 = Date.now();
  let r, body;
  try {
    r = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: PROMPT }], max_tokens: MAX_TOKENS, temperature: 0, ...extra }),
      signal: AbortSignal.timeout(180_000),
    });
    body = await r.text();
  } catch (e) {
    return { status: 'ERR', note: String(e?.message || e).slice(0, 90) };
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  let j = null;
  try { j = JSON.parse(body); } catch { /* non-JSON error body */ }
  if (!r.ok) {
    const msg = j?.error?.message || j?.message || j?.detail || body;
    return { status: r.status, secs, note: String(typeof msg === 'string' ? msg : JSON.stringify(msg)).replace(/\s+/g, ' ').slice(0, 110) };
  }
  const m = j?.choices?.[0]?.message || {};
  const u = j?.usage || {};
  const trace = String(m.reasoning_content ?? m.reasoning ?? '');
  const content = String(m.content ?? '');
  return {
    status: 200,
    secs,
    rTok: u.completion_tokens_details?.reasoning_tokens ?? u.reasoning_tokens ?? '-',
    cTok: u.completion_tokens ?? '-',
    traceLen: trace.length,
    inline: /<think>/i.test(content) ? 'yes' : '',   // reasoning leaked into the answer text
    finish: j?.choices?.[0]?.finish_reason ?? '',
    note: content.replace(/\s+/g, ' ').slice(0, 40),
  };
}

const key = apiKey();
if (!key) { console.error('NEARAI_API_KEY is not set (environment or .env).'); process.exit(1); }
const models = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_MODELS;

// Models in parallel, variants sequentially (gentle on rate limits).
const results = await Promise.all(models.map(async (model) => {
  const rows = [];
  for (const [label, extra] of VARIANTS) rows.push([label, await probe(key, model, extra)]);
  return [model, rows];
}));

const pad = (s, n) => String(s ?? '').padEnd(n);
for (const [model, rows] of results) {
  console.log(`\n=== ${model}`);
  console.log(`${pad('variant', 26)}${pad('http', 6)}${pad('sec', 7)}${pad('r_tok', 7)}${pad('c_tok', 7)}${pad('trace', 7)}${pad('inline', 8)}${pad('finish', 8)}answer / error`);
  for (const [label, x] of rows) {
    console.log(`${pad(label, 26)}${pad(x.status, 6)}${pad(x.secs, 7)}${pad(x.rTok, 7)}${pad(x.cTok, 7)}${pad(x.traceLen, 7)}${pad(x.inline, 8)}${pad(x.finish, 8)}${x.note ?? ''}`);
  }
}
console.log('\nr_tok = reasoning tokens, c_tok = completion tokens (incl. reasoning), trace = chars of reasoning_content,');
console.log('inline = <think> leaked into the answer. A variant "works" if it changes r_tok/trace vs. baseline; 4xx = value rejected.');
