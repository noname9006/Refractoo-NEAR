#!/usr/bin/env node
// Runs the offline suite, checks every claim in evidence/manifest.json against
// the TAP results, and writes a self-describing evidence file:
// commit, dirty flag, Node version, SHA-256 of every input, per-claim status.
// A test the manifest names that does not appear in the run is a FAILURE.
//
//   npm run verify:evidence                         → evidence/run-<date>.json, exit 1 on any failed claim
//   node scripts/verify-evidence.mjs --check <file> → re-hashes the inputs and compares with that run
import { spawnSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (buf) => 'sha256:' + createHash('sha256').update(buf).digest('hex');
const git = (a) => execSync(`git ${a}`, { cwd: root, encoding: 'utf8' }).trim();
// Normalise line endings so a Windows checkout (CRLF) hashes like a Linux one.
const readNorm = (f) => readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n');
// Canonical JSON: sorted keys, no whitespace, so the printed hash is reproducible.
const canon = (v) => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  : JSON.stringify(v);

const manifest = JSON.parse(readNorm('evidence/manifest.json'));
const testFiles = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `tests/${f}`);
const inputFiles = [...new Set(['evidence/manifest.json', 'scripts/verify-evidence.mjs', 'package-lock.json', ...testFiles, ...manifest.claims.flatMap((c) => c.files)])].sort();
const hashInputs = () => Object.fromEntries(inputFiles.map((f) => [f, sha(readNorm(f))]));

if (process.argv[2] === '--check') {
  const run = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const now = hashInputs();
  const diff = Object.keys(run.inputs).filter((f) => run.inputs[f] !== now[f]);
  console.log(diff.length ? `inputs changed since that run:\n  ${diff.join('\n  ')}` : `all ${Object.keys(run.inputs).length} inputs match that run (commit ${run.commit.slice(0, 7)})`);
  process.exit(diff.length ? 1 : 0);
}

const r = spawnSync(process.execPath, ['--test', '--test-skip-pattern=^live', '--test-reporter=tap', ...testFiles], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
const results = new Map();
for (const m of r.stdout.matchAll(/^(not ok|ok) \d+ - (.+?)(?: # (SKIP|TODO).*)?$/gm)) {
  results.set(m[2].replace(/\\#/g, '#'), m[3] ? m[3].toLowerCase() : m[1] === 'ok' ? 'pass' : 'fail');
}
const total = (k) => Number((r.stdout.match(new RegExp(`^# ${k} (\\d+)$`, 'm')) || [])[1] ?? NaN);

const claims = manifest.claims.map((c) => {
  const tests = c.tests.map((t) => {
    const hits = t.endsWith('*') ? [...results].filter(([n]) => n.startsWith(t.slice(0, -1))) : results.has(t) ? [[t, results.get(t)]] : [];
    const status = hits.length === 0 ? 'missing' : hits.every(([, s]) => s === 'pass') ? 'pass' : 'fail';
    return { name: t, status, matched: hits.length };
  });
  return { id: c.id, claim: c.claim, ok: tests.every((t) => t.status === 'pass'), tests };
});

// This script's own outputs (and the guard matrix's) do not make the tree dirty.
const dirty = git('status --porcelain').split('\n').filter((l) => l && !/ evidence\/(run|guards)-[^/]*\.json$/.test(l)).join('\n');
const body = {
  version: 1,
  commit: git('rev-parse HEAD'),
  dirty: dirty.length > 0,
  dirtyFiles: dirty ? dirty.split('\n').map((l) => l.slice(3)) : [],
  ranAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  command: manifest.suite,
  suite: { tests: total('tests'), pass: total('pass'), fail: total('fail'), skipped: total('skipped'), exitCode: r.status },
  complete: { claimsExpected: manifest.claims.length, claimsChecked: claims.length, claimsOk: claims.filter((c) => c.ok).length },
  inputs: hashInputs(),
  claims,
  notEstablished: manifest.notEstablished,
};
const out = canon(body);
const i = process.argv.indexOf('--out');
const name = i > 0 ? process.argv[i + 1] : `evidence/run-${body.ranAt.slice(0, 10)}.json`;
writeFileSync(join(root, name), JSON.stringify(JSON.parse(out), null, 2) + '\n');

for (const c of claims) {
  console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.id}  ${c.claim}`);
  for (const t of c.tests.filter((t) => t.status !== 'pass')) console.log(`        ${t.status}: ${t.name}`);
}
const allOk = claims.every((c) => c.ok) && r.status === 0;
console.log(`\n${body.complete.claimsOk}/${body.complete.claimsExpected} claims ok · suite ${body.suite.pass}/${body.suite.tests} pass · commit ${body.commit.slice(0, 7)}${body.dirty ? ' (dirty)' : ''}`);
console.log(`wrote ${name}\nsha256(canonical) = ${createHash('sha256').update(out).digest('hex')}`);
process.exit(allOk ? 0 : 1);
