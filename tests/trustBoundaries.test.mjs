// The trust-boundary table (data/trustBoundaries.js) checked against the code,
// so a code change that moves data to a new party breaks a test instead of
// silently making the table wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { trustRows } from '../src/data/trustBoundaries.js';

const SRC = new URL('../src/', import.meta.url);
function sources(dir = SRC.pathname.replace(/^\/([A-Za-z]:)/, '$1')) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (/\.(js|jsx)$/.test(e.name)) out.push({ file: path.relative(dir, p), text: fs.readFileSync(p, 'utf8') });
  }
  return out;
}
const ALL = sources();
const row = (rows, id) => rows.find((r) => r.id === id);

test('hosting row: the page calls exactly these same-origin endpoints, none carrying a wallet address', () => {
  const calls = new Set();
  for (const { file, text } of ALL) {
    // confidentialIntents.js's '/api/…' paths go to the Intents API host (BASE), checked below.
    if (file.endsWith('confidentialIntents.js')) {
      assert.match(text, /fetch\(`\$\{BASE\}\$\{path/, 'Intents paths are prefixed with BASE');
      continue;
    }
    for (const m of text.matchAll(/['`](\/api\/[a-z]+)/g)) calls.add(m[1]);
  }
  assert.deepEqual([...calls].sort(), ['/api/coinicon', '/api/llm', '/api/sysinfo', '/api/tokenlist']);
  // /api/coinicon carries a TOKEN contract address (stated in the row), never a wallet.
  const icon = ALL.find((s) => s.text.includes('/api/coinicon/')).text;
  assert.match(icon, /\/api\/coinicon\/\$\{chainId\}\/\$\{address\.toLowerCase\(\)\}/);
  const r = row(trustRows({}), 'hosting');
  assert.equal(r.ids.v, 'no');
  assert.match(r.other, /coinicon/);
});

test('hosting row: the external-tier relay is stated only when that tier is active', () => {
  assert.equal(row(trustRows({ inference: 'external' }), 'hosting').question.v, 'part');
  assert.match(row(trustRows({ inference: 'external' }), 'hosting').question.t, /\/api\/llm/);
  assert.equal(row(trustRows({ inference: 'nearai' }), 'hosting').question.v, 'no');
  assert.equal(row(trustRows({ inference: 'local' }), 'hosting').question.v, 'no');
  // …and the relay really is same-origin /api/llm.
  assert.ok(ALL.some((s) => s.file.endsWith('external-context.js') && s.text.includes("PROXY_URL = '/api/llm'")));
});

test('private shard: the Intents API sees account + amounts; validators are TEE (partial); public chain sees nothing', () => {
  const rows = trustRows({});
  assert.deepEqual([row(rows, 'intents-api').ids.v, row(rows, 'intents-api').amounts.v], ['yes', 'yes']);
  assert.deepEqual([row(rows, 'shard-validators').ids.v, row(rows, 'shard-validators').amounts.v], ['part', 'part']);
  assert.match(row(rows, 'shard-validators').other, /hardware trust/);
  assert.deepEqual([row(rows, 'public-chain').ids.v, row(rows, 'public-chain').amounts.v], ['no', 'no']);
  // The only host that receives balances requests is the Intents API.
  const ci = ALL.find((s) => s.file.endsWith('confidentialIntents.js')).text;
  assert.match(ci, /const BASE = 'https:\/\/intents-api\.aurora\.dev'/);
});

test('AI rows follow the settings: placeholders vs real ids, precision per tier', () => {
  const def = trustRows({ inference: 'external' });
  assert.equal(row(def, 'external-operator').ids.v, 'part');
  assert.match(row(def, 'external-operator').amounts.t, /4 significant figures/);
  assert.match(row(def, 'nearai-enclave').amounts.t, /exact/);
  const off = trustRows({ inference: 'external', redactRemote: false });
  assert.equal(row(off, 'external-operator').ids.v, 'yes');
  assert.match(row(off, 'external-operator').amounts.t, /exact/);
  const r2 = trustRows({ inference: 'nearai', roundRemote: { nearai: 2 } });
  assert.match(row(r2, 'nearai-enclave').amounts.t, /2 significant figures/);
});

test('rows for the tier not in use are marked, and nothing says the gateway reads plaintext', () => {
  const rows = trustRows({ inference: 'nearai' });
  assert.equal(row(rows, 'external-operator').offTier, true);
  assert.equal(row(rows, 'nearai-enclave').offTier, false);
  assert.equal(row(rows, 'hosting').offTier, false);
  const gw = row(rows, 'nearai-gateway');
  for (const k of ['ids', 'amounts', 'question']) assert.match(gw[k].t, /Ciphertext/);
});

test('every row has every cell, with a known value', () => {
  for (const r of trustRows({})) {
    for (const k of ['ids', 'amounts', 'question']) assert.ok(['yes', 'no', 'part'].includes(r[k]?.v), `${r.id}.${k}`);
    assert.ok(r.party && r.other, r.id);
  }
});
