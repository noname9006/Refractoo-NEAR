// Spike: E2EE chat + response-signature check against NEAR AI Cloud.
// Key comes from NEARAI_API_KEY in .env (gitignored). Never printed.
// Uses the generic (browser) entry, same code path as the web app.
// Run: node spike/nearai-node.mjs [model]
import fs from 'node:fs';
import { InferenceClient } from '@nearai/inference-sdk';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const apiKey = env.NEARAI_API_KEY;
if (!apiKey) throw new Error('NEARAI_API_KEY missing in .env');

// The SDK verifies NVIDIA's NRAS JWT with no clock tolerance, so a local
// clock that lags by even a few seconds fails with "not_yet_valid". Measure
// the offset against the gateway's Date header and shift Date.now in this
// process only (spike workaround; the system clock is not touched).
{
  const r = await fetch('https://cloud-api.near.ai/v1/models', { method: 'HEAD' });
  const skewMs = Date.parse(r.headers.get('date')) + 500 - Date.now();
  if (Math.abs(skewMs) > 1000) {
    const RealDate = Date;
    const realNow = RealDate.now.bind(RealDate);
    // jose reads the clock via `new Date()`, so shift the no-arg constructor too.
    globalThis.Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [realNow() + skewMs])); }
      static now() { return realNow() + skewMs; }
    };
    console.log(`clock skew vs server: ${Math.round(skewMs / 1000)} s (compensated in-process)`);
  }
}

const model = process.argv[2] || 'Qwen/Qwen3.8-27B';
const t0 = performance.now();
const ms = () => `${Math.round(performance.now() - t0)} ms`;

const client = new InferenceClient({ apiKey, e2ee: true });

const att = await client.verify(model);
console.log('verify():', {
  gatewayTcb: att.gateway.tcbStatus,
  models: att.models.length,
  modelTcb: att.models.map((m) => m.tcbStatus),
  gpu: att.models.map((m) => m.gpuEvidence?.status ?? m.gpuEvidenceStatus ?? 'n/a'),
}, ms());

const completion = await client.chat.completions.create({
  model,
  messages: [{ role: 'user', content: 'Reply with exactly: private hello' }],
  max_tokens: 200,
});
console.log('answer:', JSON.stringify(completion.choices[0]?.message?.content ?? ''), ms());
console.log('usage:', completion.usage);

const verified = await client.verifyResponse(completion.id);
console.log('verifyResponse:', { kind: verified.signatureKind, id: verified.id }, ms());
