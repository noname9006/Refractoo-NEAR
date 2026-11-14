// applyAgentAction: approved proposals reach real state; everything else does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProposals, validate, approve } from '../src/agent/actions.js';
import { applyAgentAction, resolveChainId } from '../src/agent/apply.js';

const META = { 1: { name: 'Ethereum' }, 56: { name: 'BNB Chain' }, near: { name: 'NEAR' } };
const REAL = '0x2222222222222222222222222222222222222222';

function env(over = {}) {
  const calls = [];
  return {
    calls,
    hiddenTokens: [], labels: {}, selectedChains: new Set([1, 56]), chainIds: [1, 56, 'near'], chainMeta: META,
    resolvePlaceholder: (ph) => (ph === 'ADDR_1' ? REAL : null),
    setHiddenTokens: (v) => calls.push(['hidden', v]),
    setLabels: (v) => calls.push(['labels', v]),
    setChains: (v) => calls.push(['chains', [...v]]),
    ...over,
  };
}
const P = (kind, args) => validate({ kind, args }).proposal;

test('apply: approved hide_token updates state and undo restores it', () => {
  const e = env({ hiddenTokens: ['A'] });
  const p = P('hide_token', { symbol: 'SCAM' });
  const r = applyAgentAction(p, approve(p), e);
  assert.deepEqual(e.calls[0], ['hidden', ['A', 'SCAM']]);
  r.undo();
  assert.deepEqual(e.calls[1], ['hidden', ['A']]);
});

test('apply: no setter is called without a matching approval', () => {
  const e = env();
  const p = P('hide_token', { symbol: 'SCAM' });
  assert.equal(applyAgentAction(p, null, e).error, 'not_approved');
  assert.equal(applyAgentAction(p, approve(P('hide_token', { symbol: 'X' })), e).error, 'approval_mismatch');
  const transfer = parseProposals('```action\n{"kind":"transfer","args":{"to":"x","amount":1}}\n```');
  assert.equal(transfer.proposals.length, 0);
  assert.equal(applyAgentAction({ kind: 'transfer', args: {} }, { approved: true, hash: 'x' }, e).error, 'denied_kind');
  assert.equal(e.calls.length, 0);
});

test('apply: select_chain resolves names locally; unknown chain is refused', () => {
  assert.equal(resolveChainId('bsc', [1, 56], META), 56);
  assert.equal(resolveChainId('near', [1, 'near'], META), 'near');
  const e = env();
  const p = P('select_chain', { chain: 'ethereum' });
  const r = applyAgentAction(p, approve(p), e);
  assert.deepEqual(e.calls[0], ['chains', [1]]);
  r.undo();
  assert.deepEqual(e.calls[1], ['chains', [1, 56]]);
  const q = P('select_chain', { chain: 'polygon' });
  assert.equal(applyAgentAction(q, approve(q), env()).error, 'chain_not_in_view');
});

test('apply: set_label resolves the placeholder on this device only', () => {
  const e = env();
  const p = P('set_label', { target: 'ADDR_1', label: 'exchange' });
  applyAgentAction(p, approve(p), e);
  assert.deepEqual(e.calls[0], ['labels', { [REAL]: 'exchange' }]);
  const q = P('set_label', { target: 'ADDR_9', label: 'x' });
  assert.equal(applyAgentAction(q, approve(q), env()).error, 'unknown_placeholder');
});
