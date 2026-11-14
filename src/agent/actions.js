// Agent actions: the model PROPOSES, the user APPROVES, the app EXECUTES.
//
// Trust rules (see THREAT_MODEL.md, "Agent actions"):
//  1. The model's output is untrusted text. Proposals are parsed from fenced
//     ```action JSON blocks and validated against a closed allowlist; any
//     unknown kind or extra field is rejected, never "best-effort" applied.
//  2. Every allowed action is local view state only: no network, no signing,
//     no transfer, no storage outside the layout. Money-moving kinds are on an
//     explicit deny list so they are refused with a reason, not silently dropped.
//  3. Execution requires an approval bound to the exact proposal bytes
//     (sha256 of its canonical JSON). Approving one proposal cannot execute
//     another, and a proposal edited after approval does not execute.
//  4. Execution is a pure function (state, proposal, approval) → new state and
//     an undo record, so every action is reversible.
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export const DENIED_KINDS = Object.freeze([
  'transfer', 'send', 'sign', 'sign_message', 'approve_token', 'swap', 'bridge',
  'deposit', 'withdraw', 'stake', 'unstake', 'call_contract', 'fetch', 'export',
]);

const LABEL = /^[\p{L}\p{N} ._\-]{1,32}$/u;
const SYMBOL = /^[A-Za-z0-9.\-]{1,16}$/;
const CHAINS = new Set(['ethereum', 'arbitrum', 'base', 'optimism', 'polygon', 'bsc', 'near']);
const PLACEHOLDER = /^(WALLET|ADDR)_\d{1,3}$/;

// kind → { fields: {name: validator}, apply(state, args) → state }
export const ALLOWED = Object.freeze({
  hide_token: {
    fields: { symbol: (v) => typeof v === 'string' && SYMBOL.test(v) },
    apply: (s, a) => ({ ...s, hiddenTokens: [...new Set([...(s.hiddenTokens || []), a.symbol])] }),
  },
  show_token: {
    fields: { symbol: (v) => typeof v === 'string' && SYMBOL.test(v) },
    apply: (s, a) => ({ ...s, hiddenTokens: (s.hiddenTokens || []).filter((x) => x !== a.symbol) }),
  },
  select_chain: {
    fields: { chain: (v) => typeof v === 'string' && CHAINS.has(v) },
    apply: (s, a) => ({ ...s, chain: a.chain }),
  },
  set_label: {
    // Labels target placeholders only: the model never sees real addresses.
    fields: {
      target: (v) => typeof v === 'string' && PLACEHOLDER.test(v),
      label: (v) => typeof v === 'string' && LABEL.test(v),
    },
    apply: (s, a) => ({ ...s, labels: { ...(s.labels || {}), [a.target]: a.label } }),
  },
});

const BLOCK = /```action\s*\n([\s\S]*?)```/g;
export const MAX_PROPOSALS = 5;

export function canonical(p) {
  const keys = Object.keys(p.args || {}).sort();
  const args = {};
  for (const k of keys) args[k] = p.args[k];
  return JSON.stringify({ kind: p.kind, args });
}

export function proposalHash(p) {
  return bytesToHex(sha256(new TextEncoder().encode(canonical(p))));
}

/** Validate one candidate. Returns { ok, proposal?, reason? }. */
export function validate(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, reason: 'not_object' };
  const extra = Object.keys(c).filter((k) => k !== 'kind' && k !== 'args');
  if (extra.length) return { ok: false, reason: 'extra_top_field' };
  if (typeof c.kind !== 'string') return { ok: false, reason: 'no_kind' };
  if (DENIED_KINDS.includes(c.kind)) return { ok: false, reason: 'denied_kind' };
  const spec = Object.prototype.hasOwnProperty.call(ALLOWED, c.kind) ? ALLOWED[c.kind] : null;
  if (!spec) return { ok: false, reason: 'unknown_kind' };
  const args = c.args;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, reason: 'no_args' };
  const names = Object.keys(spec.fields);
  if (Object.keys(args).some((k) => !names.includes(k))) return { ok: false, reason: 'extra_arg' };
  for (const n of names) if (!spec.fields[n](args[n])) return { ok: false, reason: `bad_arg:${n}` };
  const proposal = { kind: c.kind, args: { ...args } };
  return { ok: true, proposal: { ...proposal, hash: proposalHash(proposal) } };
}

/** Extract proposals from model text. Never throws; rejects are reported. */
export function parseProposals(text) {
  const proposals = [];
  const rejected = [];
  if (typeof text !== 'string') return { proposals, rejected };
  for (const m of text.matchAll(BLOCK)) {
    if (proposals.length + rejected.length >= MAX_PROPOSALS) { rejected.push({ reason: 'too_many' }); break; }
    let c;
    try { c = JSON.parse(m[1]); } catch { rejected.push({ reason: 'bad_json' }); continue; }
    const r = validate(c);
    if (r.ok) proposals.push(r.proposal); else rejected.push({ kind: c?.kind, reason: r.reason });
  }
  return { proposals, rejected };
}

/** The user's click: binds approval to these exact bytes. */
export function approve(proposal) {
  return Object.freeze({ approved: true, hash: proposalHash(proposal) });
}

export class ActionError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Execute an approved proposal. Re-validates; returns { state, undo }. */
export function execute(state, proposal, approval) {
  if (!approval || approval.approved !== true) throw new ActionError('not_approved');
  const r = validate({ kind: proposal?.kind, args: proposal?.args });
  if (!r.ok) throw new ActionError(r.reason);
  if (approval.hash !== r.proposal.hash) throw new ActionError('approval_mismatch');
  const next = ALLOWED[r.proposal.kind].apply(state, r.proposal.args);
  return { state: next, undo: state };
}

/** Text for the system prompt: what the model may propose. */
export const ACTIONS_PROMPT = `You may PROPOSE (never perform) view changes. Put each in its own block:
\`\`\`action
{"kind":"hide_token","args":{"symbol":"XYZ"}}
\`\`\`
Allowed kinds: hide_token{symbol}, show_token{symbol}, select_chain{chain}, set_label{target: WALLET_n|ADDR_n, label}.
The user approves each one. You cannot move funds, sign, or fetch anything.`;
