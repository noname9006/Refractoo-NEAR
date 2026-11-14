#!/usr/bin/env node
// Guard-removal matrix: proves the tests check the guards, not just go green.
// For each guard: apply ONE source mutation that removes or weakens it, run
// the named test file(s), and require that at least one of the named tests
// FAILS. Then restore the file byte-for-byte (also on Ctrl-C / crash).
//
//   npm run verify:guards            → table on stdout + evidence/guards-<date>.json
//   npm run verify:guards -- G3      → one guard only
// A mutation whose search text is not found counts as a failure of this script
// (the guard moved; update the matrix), never as a silent pass.
import { spawnSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const GUARDS = [
  { id: 'G1', guard: 'Model-signature check: verify against the attested signer', file: 'src/near/receiptBundle.js',
    find: "try { verify({ requestBody: req, responseBody, signature: bundle.signature, attestation }); return { ok: true, code: null }; }",
    replace: "try { return { ok: true, code: null }; }",
    tests: ['tests/receipt.test.mjs'], mustFail: ['real receipt: one flipped byte of the answer or the request is rejected'] },
  { id: 'G2', guard: 'Tamper demo uses the real SDK verifier', file: 'src/near/nearAiContext.js',
    find: 'verify({ requestBody: e.requestBody, responseBody, signature: e.signature, attestation: e.attestation });',
    replace: '/* verification removed */',
    tests: ['tests/tamper.test.mjs'], mustFail: ['tamper test: real bytes verify, every flipped byte of the answer is rejected'] },
  { id: 'G3', guard: 'Receipt: GPU evidence link required', file: 'src/near/nearAiContext.js',
    find: "ok: models.length ? gpuAll : false,", replace: 'ok: true,',
    tests: ['tests/nearai.test.mjs'], mustFail: ['verificationChecks: any weak link fails the receipt'] },
  { id: 'G4', guard: 'Receipt: E2EE link required', file: 'src/near/nearAiContext.js',
    find: 'ok: receipt?.e2ee === true,', replace: 'ok: true,',
    tests: ['tests/nearai.test.mjs'], mustFail: ['verificationChecks: any weak link fails the receipt'] },
  { id: 'G5', guard: 'NVIDIA verdict: nonce must match', file: 'src/near/nrasVerifier.js',
    find: "if (normHex(claims.eat_nonce) !== normHex(expectedNonce)) throw new GpuEvidenceError('nonce_mismatch');", replace: '',
    tests: ['tests/nearai.test.mjs'], mustFail: ['checkClaims rejects nonce mismatch, negative verdict, malformed claims'] },
  { id: 'G6', guard: 'NVIDIA verdict: clock tolerance is bounded', file: 'src/near/nrasVerifier.js',
    find: "if (claims.iat > nowS + tol) throw new GpuEvidenceError('not_yet_valid');", replace: '',
    tests: ['tests/nearai.test.mjs'], mustFail: ['checkClaims tolerates a lagging client clock within the bound only'] },
  { id: 'G7', guard: 'Pseudonymize: full 0x addresses', file: 'src/utils/pseudonymize.js',
    find: ".replace(EVM_FULL, (m) => labelFor(m, cluster.includes(m.toLowerCase()) ? 'WALLET' : 'ADDR', shortAddr(m)))", replace: '',
    tests: ['tests/claims.test.mjs', 'tests/pseudonymize.test.mjs'], mustFail: ['B1. external tier: the exact messages sent contain no real identifier'] },
  { id: 'G8', guard: 'Pseudonymize: tx hashes', file: 'src/utils/pseudonymize.js',
    find: ".replace(TX_HASH, (m) => labelFor(m, 'TX', `${m.slice(0, 10)}…`))", replace: '',
    tests: ['tests/claims.test.mjs'], mustFail: ['B1. external tier: the exact messages sent contain no real identifier'] },
  { id: 'G9', guard: 'Amounts rounded to N significant figures', file: 'src/utils/pseudonymize.js',
    find: "return !sigFigs || KEEP_EXACT.test(key) ? v : roundSig(v, sigFigs);", replace: 'return v;',
    tests: ['tests/claims.test.mjs'], mustFail: ['B2. external tier: amounts reach the API at 4 significant figures, never exact'] },
  { id: 'G10', guard: 'Injection detection on chain-data strings', file: 'src/prompts/untrusted.js',
    find: 'return INJECTION.some((re) => re.test(t));', replace: 'return false;',
    tests: ['tests/untrusted.test.mjs'], mustFail: ['buildAnalysisMessages: hostile chain data never reaches the prompt'] },
  { id: 'G11', guard: 'Prompt is built from sanitized facts only', file: 'src/prompts/wallet-analysis.js',
    find: '${JSON.stringify(body, null, 2)}', replace: '${JSON.stringify(facts, null, 2)}',
    tests: ['tests/untrusted.test.mjs'], mustFail: ['buildAnalysisMessages: hostile chain data never reaches the prompt'] },
  { id: 'G12', guard: 'FHE balances stay words, never a number', file: 'src/analytics/portfolio.js',
    find: "amount: 'ENCRYPTED — amount unknown',", replace: 'amount: 0,',
    tests: ['tests/confidentialBalances.test.mjs'], mustFail: ['encrypted (FHE) entries stay words, not numbers, after pseudonymization'] },
  { id: 'G13', guard: 'NEP-413 signature verified before anything is sent', file: 'src/near/confidentialIntents.js',
    find: 'if (!verifyNep413(p, signed?.publicKey, signed?.signature)) {', replace: 'if (false) {',
    tests: ['tests/intents.test.mjs'], mustFail: ['nearIdentity refuses a signature that does not verify (nothing sent)'] },
  { id: 'G14', guard: 'No new same-origin endpoint (server never sees a wallet)', file: 'src/utils/system-info.js',
    find: "const r = await fetch('/api/sysinfo');", replace: "const r = await fetch('/api/sysinfo'); fetch(`/api/wallet?a=${globalThis.addr}`);",
    tests: ['tests/trustBoundaries.test.mjs'], mustFail: ['hosting row: the page calls exactly these same-origin endpoints, none carrying a wallet address'] },
  { id: 'G15', guard: 'Preview is the wire: analyze() POSTs the same body the preview shows', file: 'src/utils/external-context.js',
    find: 'body: JSON.stringify(externalRequestBody(this.config.model, messages)),',
    replace: "body: JSON.stringify({ ...externalRequestBody(this.config.model, messages), user: 'unseen-extra-field' }),",
    tests: ['tests/outbound.test.mjs'], mustFail: ['external: previewRequest body is byte-identical to what analyze() POSTs'] },
  { id: 'G16', guard: 'restore(): placeholders in the answer map back to real identifiers locally', file: 'src/utils/pseudonymize.js',
    find: 'return s.replace(LABEL_RE, (m, w, kind, n) => fromLabel.get(`${(w || kind).toUpperCase()}_${n}`) ?? m);',
    replace: 'return s;',
    tests: ['tests/claims.test.mjs', 'tests/pseudonymize.test.mjs'],
    mustFail: ["B3. the answer is mapped back locally to the user's real identifiers", 'restore() maps placeholders back, tolerant of model spelling, no prefix collisions'] },
  { id: 'G17', guard: 'Untrusted token symbol: plain charset, 16 chars max', file: 'src/prompts/untrusted.js',
    find: "return String(s ?? '').replace(/[^A-Za-z0-9$._-]/g, '').slice(0, 16) || '?';",
    replace: "return String(s ?? '') || '?';",
    tests: ['tests/untrusted.test.mjs'], mustFail: ['guardString: detection runs on raw text, cleaning keeps a plain short charset'] },
  { id: 'G18', guard: 'Intents session tokens are memory-only', file: 'src/near/confidentialIntents.js',
    find: 'sessions.set(session.key, session);',
    replace: "sessions.set(session.key, session); globalThis.localStorage?.setItem('pwai.intents', JSON.stringify(session));",
    tests: ['tests/confidentialBalances.test.mjs'], mustFail: ['memory-only: Intents session tokens and balances never reach localStorage, sessionStorage or IndexedDB'] },
];

const only = process.argv.slice(2).filter((a) => /^G\d+$/.test(a));
const todo = only.length ? GUARDS.filter((g) => only.includes(g.id)) : GUARDS;

let pending = null; // { path, original } to restore on exit
const restore = () => { if (pending) { writeFileSync(pending.path, pending.original); pending = null; } };
process.on('exit', restore);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { restore(); process.exit(130); });

function runTests(files) {
  const r = spawnSync(process.execPath, ['--test', '--test-skip-pattern=^live', '--test-reporter=tap', ...files], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  const res = new Map();
  for (const m of r.stdout.matchAll(/^(not ok|ok) \d+ - (.+?)(?: # .*)?$/gm)) res.set(m[2], m[1] === 'ok');
  return res;
}

const rows = [];
for (const g of todo) {
  const path = join(root, g.file);
  const original = readFileSync(path);
  const text = original.toString('utf8');
  const n = text.split(g.find).length - 1;
  if (n !== 1) { rows.push({ ...g, status: n ? 'ambiguous' : 'not-found', failed: [] }); continue; }
  // Baseline first: the named tests must pass on the unmutated code.
  const base = runTests(g.tests);
  const baseOk = g.mustFail.every((t) => base.get(t) === true);
  pending = { path, original };
  writeFileSync(path, text.replace(g.find, () => g.replace));
  let after;
  try { after = runTests(g.tests); } finally { restore(); }
  const failed = [...after].filter(([, ok]) => !ok).map(([t]) => t);
  const caught = g.mustFail.some((t) => after.get(t) === false);
  rows.push({ ...g, status: !baseOk ? 'baseline-failing' : caught ? 'caught' : 'NOT CAUGHT', failed });
  console.log(`${caught && baseOk ? 'caught ' : 'MISSED '} ${g.id.padEnd(4)} ${g.guard}  →  ${failed.length} test(s) failed`);
}

// The tree must be exactly as before.
const dirtyAfter = execSync('git status --porcelain -- ' + [...new Set(todo.map((g) => g.file))].join(' '), { cwd: root, encoding: 'utf8' }).trim();

const allCaught = rows.every((r) => r.status === 'caught');
const out = {
  version: 1,
  commit: execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim(),
  ranAt: new Date().toISOString(),
  node: process.version,
  guards: rows.map(({ id, guard, file, find, replace, mustFail, status, failed }) => ({ id, guard, file, mutation: { find, replace }, mustFail, status, failedTests: failed })),
  summary: { guards: rows.length, caught: rows.filter((r) => r.status === 'caught').length },
  sourceFilesAfterRun: dirtyAfter || 'unchanged by this run (see git status)',
};
if (!only.length) writeFileSync(join(root, 'evidence', `guards-${out.ranAt.slice(0, 10)}.json`), JSON.stringify(out, null, 2) + '\n');
console.log(`\n${out.summary.caught}/${out.summary.guards} guard removals caught by the tests`);
for (const r of rows.filter((r) => r.status !== 'caught')) console.log(`  ${r.id}: ${r.status}`);
process.exit(allCaught ? 0 : 1);
