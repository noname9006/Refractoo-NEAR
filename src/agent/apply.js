// Bridges an approved proposal to the app's real state. Pure: it receives the
// current view state and the setters, and returns { undo } or { error }.
// execute() (actions.js) re-validates and checks the hash-bound approval first;
// nothing here runs unless that passes.
import { execute } from './actions.js';

const ALIAS = { bsc: 'bnb' };

/** Map an allowlisted chain name to a view chain id using display names. */
export function resolveChainId(name, chainIds, chainMeta) {
  const want = ALIAS[name] || name;
  return chainIds.find((id) => String(chainMeta[id]?.name || id).toLowerCase().split(' ')[0] === want) ?? null;
}

/**
 * @param p          proposal (from parseProposals)
 * @param approval   approve(p) — the user's click
 * @param env        { hiddenTokens, labels, selectedChains:Set, chainIds, chainMeta,
 *                     resolvePlaceholder(ph) → real id | null,
 *                     setHiddenTokens(arr), setLabels(obj), setChains(Set) }
 */
export function applyAgentAction(p, approval, env) {
  const s0 = { hiddenTokens: env.hiddenTokens || [], labels: env.labels || {} };
  let r;
  try { r = execute(s0, p, approval); } catch (e) { return { error: e.code || 'refused' }; }
  switch (p.kind) {
    case 'hide_token':
    case 'show_token':
      env.setHiddenTokens(r.state.hiddenTokens);
      return { undo: () => env.setHiddenTokens(s0.hiddenTokens) };
    case 'select_chain': {
      const id = resolveChainId(p.args.chain, env.chainIds, env.chainMeta);
      if (id == null) return { error: 'chain_not_in_view' };
      const before = new Set(env.selectedChains);
      env.setChains(new Set([id]));
      return { undo: () => env.setChains(before) };
    }
    case 'set_label': {
      // The model only ever names a placeholder; it is resolved to the real
      // identifier here, on this device, at execution time.
      const real = env.resolvePlaceholder?.(p.args.target);
      if (!real) return { error: 'unknown_placeholder' };
      const key = String(real).toLowerCase();
      env.setLabels({ ...s0.labels, [key]: p.args.label });
      return { undo: () => env.setLabels(s0.labels) };
    }
    default:
      return { error: 'not_wired' };
  }
}
