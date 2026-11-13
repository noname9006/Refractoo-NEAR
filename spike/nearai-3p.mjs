// Spike: 3P TEE models (Tinfoil/Chutes) — gateway-verified + OHTTP, no model E2EE.
// Run: node spike/nearai-3p.mjs [model]
import fs from 'node:fs';
import { InferenceClient } from '@nearai/inference-sdk';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const model = process.argv[2] || 'z-ai/glm-5.3';
const client = new InferenceClient({ apiKey: env.NEARAI_API_KEY, e2ee: false, ohttp: true });
const att = await client.verify(model);
console.log('verify:', { gatewayTcb: att.gateway.tcbStatus, models: att.models.length });
const c = await client.chat.completions.create({
  model, messages: [{ role: 'user', content: 'Reply with exactly: private hello' }], max_tokens: 300,
});
console.log('answer:', JSON.stringify(c.choices[0]?.message?.content ?? ''));
try {
  const v = await client.verifyResponse(c.id);
  console.log('verifyResponse:', { kind: v.signatureKind });
} catch (e) { console.log('verifyResponse failed:', e?.failure?.code || e.message); }
