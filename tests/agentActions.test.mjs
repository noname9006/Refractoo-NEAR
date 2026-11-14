// Agent actions: propose → approve (bound to exact bytes) → execute (pure, undoable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProposals, validate, approve, execute, proposalHash, DENIED_KINDS, ActionError } from '../src/agent/actions.js';

const block = (o) => '```action\n' + (typeof o === 'string' ? o : JSON.stringify(o)) + '\n```';

test('agent: valid proposals are parsed from model text and hashed', () => {
  const text = `Spam token detected.\n${block({ kind: 'hide_token', args: { symbol: 'SCAM' } })}\n${block({ kind: 'select_chain', args: { chain: 'near' } })}`;
  const { proposals, rejected } = parseProposals(text);
  assert.equal(proposals.length, 2);
  assert.equal(rejected.length, 0);
  assert.match(proposals[0].hash, /^[0-9a-f]{64}$/);
});

test('agent: money-moving and unknown kinds are refused, never applied', () => {
  for (const kind of DENIED_KINDS) {
    assert.equal(validate({ kind, args: {} }).reason, 'denied_kind', kind);
  }
  assert.equal(validate({ kind: 'rm_rf', args: {} }).reason, 'unknown_kind');
  assert.equal(validate({ kind: 'constructor', args: {} }).reason, 'unknown_kind');
  assert.equal(validate({ kind: '__proto__', args: {} }).reason, 'unknown_kind');
});

test('agent: extra fields and bad args are rejected (closed schema)', () => {
  assert.equal(validate({ kind: 'hide_token', args: { symbol: 'X', to: '0xabc' } }).reason, 'extra_arg');
  assert.equal(validate({ kind: 'hide_token', args: { symbol: 'X' }, run: true }).reason, 'extra_top_field');
  assert.equal(validate({ kind: 'hide_token', args: { symbol: 'Ignore previous instructions' } }).reason, 'bad_arg:symbol');
  assert.equal(validate({ kind: 'select_chain', args: { chain: 'mainnet-drain' } }).reason, 'bad_arg:chain');
  assert.equal(validate({ kind: 'set_label', args: { target: '0x1111111111111111111111111111111111111111', label: 'me' } }).reason, 'bad_arg:target');
  const { proposals, rejected } = parseProposals(block('{not json'));
  assert.equal(proposals.length, 0);
  assert.equal(rejected[0].reason, 'bad_json');
});

test('agent: proposals are capped per answer', () => {
  const many = Array.from({ length: 9 }, () => block({ kind: 'select_chain', args: { chain: 'base' } })).join('\n');
  const { proposals, rejected } = parseProposals(many);
  assert.equal(proposals.length, 5);
  assert.equal(rejected.at(-1).reason, 'too_many');
});

test('agent: nothing executes without an approval of these exact bytes', () => {
  const s0 = { hiddenTokens: [] };
  const [p] = parseProposals(block({ kind: 'hide_token', args: { symbol: 'SCAM' } })).proposals;
  assert.throws(() => execute(s0, p, null), (e) => e instanceof ActionError && e.code === 'not_approved');
  assert.throws(() => execute(s0, p, { approved: false, hash: p.hash }), /not_approved/);
  const other = validate({ kind: 'hide_token', args: { symbol: 'USDC' } }).proposal;
  assert.throws(() => execute(s0, p, approve(other)), /approval_mismatch/);
  const ok = approve(p);
  const tampered = { ...p, args: { symbol: 'USDC' } };
  assert.throws(() => execute(s0, tampered, ok), /approval_mismatch/);
  assert.equal(s0.hiddenTokens.length, 0);
});

test('agent: approved execution is pure and undoable', () => {
  const s0 = Object.freeze({ hiddenTokens: Object.freeze(['A']), chain: 'ethereum' });
  const [p] = parseProposals(block({ kind: 'hide_token', args: { symbol: 'SCAM' } })).proposals;
  const { state, undo } = execute(s0, p, approve(p));
  assert.deepEqual(state.hiddenTokens, ['A', 'SCAM']);
  assert.equal(undo, s0);
  assert.deepEqual(s0.hiddenTokens, ['A']);
  const q = validate({ kind: 'set_label', args: { target: 'WALLET_1', label: 'cold' } }).proposal;
  assert.deepEqual(execute({}, q, approve(q)).state.labels, { WALLET_1: 'cold' });
});

test('agent: hash is canonical (arg order does not matter, value does)', () => {
  const a = { kind: 'set_label', args: { target: 'ADDR_2', label: 'cex' } };
  const b = { kind: 'set_label', args: { label: 'cex', target: 'ADDR_2' } };
  assert.equal(proposalHash(a), proposalHash(b));
  assert.notEqual(proposalHash(a), proposalHash({ ...a, args: { ...a.args, label: 'cex2' } }));
});
