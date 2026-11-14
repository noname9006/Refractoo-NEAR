// Live probe: what can a NEAR AI *inference* API key read about itself?
// (balance, spend limit, usage, per-request cost). Prints status + field NAMES
// only — never values that could identify the account.
//   node spike/key-info-probe.mjs
import fs from 'node:fs';
const BASE = 'https://cloud-api.near.ai/v1';
function apiKey() {
  if (process.env.NEARAI_API_KEY) return process.env.NEARAI_API_KEY.trim();
  try {
    const line = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).find((l) => l.startsWith('NEARAI_API_KEY='));
    return line ? line.slice('NEARAI_API_KEY='.length).trim() : '';
  } catch { return ''; }
}
const key = apiKey();
if (!key) { console.error('NEARAI_API_KEY is not set'); process.exit(1); }
const H = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const shape = (v, d = 0) => {
  if (Array.isArray(v)) return v.length ? [shape(v[0], d + 1)] : [];
  if (v && typeof v === 'object') return d > 2 ? '{…}' : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, d + 1)]));
  return typeof v;
};
async function get(path, init) {
  try {
    const r = await fetch(BASE + path, { headers: H, signal: AbortSignal.timeout(30_000), ...init });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch { /* not JSON */ }
    const info = r.ok ? JSON.stringify(shape(j)).slice(0, 400) : String(j?.error?.message || j?.message || t).replace(/\s+/g, ' ').slice(0, 120);
    console.log(`${String(r.status).padEnd(4)} ${(init?.method || 'GET').padEnd(5)}${path.padEnd(44)} ${info}`);
    return { r, j };
  } catch (e) { console.log(`ERR  ${path} ${e.message}`); return {}; }
}
for (const p of ['/users/me', '/users/me/organizations', '/organizations', '/workspaces', '/api-keys', '/api-keys/me', '/key', '/auth/key', '/me', '/usage', '/usage/balance', '/balance', '/credits', '/billing/balance', '/billing/usage', '/limits', '/rate-limits']) await get(p);

// One tiny completion: rate-limit headers, usage in the stream, inference-id → cost.
const r = await fetch(`${BASE}/chat/completions`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ model: 'Qwen/Qwen3.6-35B-A3B-FP8', messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 8, stream: true, stream_options: { include_usage: true }, chat_template_kwargs: { enable_thinking: false } }),
});
console.log(`\ncompletion ${r.status}; response headers:`);
for (const [k, v] of r.headers) if (/limit|remaining|reset|inference|request|usage|credit|balance|cost|retry/i.test(k)) console.log(`  ${k}: ${/id$/i.test(k) ? '<id>' : v}`);
const text = await r.text();
const usageLine = text.split('\n').filter((l) => l.includes('"usage"') && !l.includes('"usage":null')).pop();
console.log('usage chunk:', usageLine ? JSON.stringify(JSON.parse(usageLine.replace(/^data:\s*/, '')).usage) : 'none');
const id = r.headers.get('inference-id');
if (id) {
  await new Promise((s) => setTimeout(s, 6000));
  const { j } = await get('/billing/costs', { method: 'POST', body: JSON.stringify({ requestIds: [id] }) });
  console.log('cost of that request (nano-USD):', j?.requests?.[0]?.costNanoUsd, j?.requests?.[0]?.warning || '');
}
