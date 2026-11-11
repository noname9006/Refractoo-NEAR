// Spike: NEAR Confidential Intents API (Aurora) — what works before a user signs.
// Key comes from AURORA_INTENTS_API_KEY in .env (gitignored). Never printed:
// it sits in the URL path by the API's design, so URLs are redacted in output.
// Run: node spike/intents-node.mjs
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const KEY = env.AURORA_INTENTS_API_KEY;
if (!KEY) throw new Error('AURORA_INTENTS_API_KEY missing in .env');

const BASE = 'https://intents-api.aurora.dev';
const ORIGIN = 'http://localhost:5173';
const redact = (s) => String(s).split(KEY).join('<key>');

async function call(label, path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Origin: ORIGIN, ...(init.headers || {}) },
  });
  const acao = res.headers.get('access-control-allow-origin');
  const text = await res.text();
  console.log(`== ${label}: HTTP ${res.status} | ACAO=${acao ?? '-'}`);
  return { res, text };
}

// 1. CORS preflights for the two calls the browser will make.
for (const [label, path, method, hdrs] of [
  ['preflight authenticate', `/api/auth/authenticate/${KEY}`, 'POST', 'content-type'],
  ['preflight balances', `/api/account/balances/${KEY}`, 'GET', 'authorization'],
  ['preflight history', `/api/account/history/${KEY}`, 'GET', 'authorization'],
]) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'OPTIONS',
    headers: { Origin: ORIGIN, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': hdrs },
  });
  console.log(`== ${label}: HTTP ${res.status} | ACAO=${res.headers.get('access-control-allow-origin') ?? '-'} | headers=${res.headers.get('access-control-allow-headers') ?? '-'}`);
}

// 2. Supported tokens — validates the key and gives USD prices for valuation.
{
  const { text } = await call('tokens (validates key)', `/api/tokens/${KEY}`);
  try {
    const j = JSON.parse(text);
    if (!j.tokens) console.log(redact(text.slice(0, 300)));
    else {
      console.log(`tokens: ${j.tokens.length}, chains: ${new Set(j.tokens.map((t) => t.blockchain)).size}`);
      for (const t of j.tokens.filter((t) => /^(USDC|NEAR|wNEAR|ETH|BTC)$/.test(t.symbol)).slice(0, 8)) {
        console.log(`  ${t.symbol.padEnd(5)} ${t.blockchain.padEnd(6)} ${t.assetId}  $${t.price}`);
      }
    }
  } catch { console.log(redact(text.slice(0, 300))); }
}

// 3. Balances without a session — expect 401.
{
  const { text } = await call('balances without session', `/api/account/balances/${KEY}`);
  console.log('  ' + redact(text.slice(0, 300)));
}

// 4. Authenticate with an empty body — expect 400 and the validation shape.
{
  const { text } = await call('authenticate with empty body', `/api/auth/authenticate/${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  console.log('  ' + redact(text.slice(0, 400)));
}
