// The "hotlist": the handful of models the user wants one click away from the
// Wallet Assistant header. Chosen in Settings → AI model from every model the
// app can run, across the three inference tiers.
//
// An entry is a string key "<tier>:<model id>" so it round-trips through prefs
// (localStorage JSON) without any schema:
//   nearai:<NEAR AI model id>   local:<registry model id>   external:<model name>

import { getModel } from './registry.js';
import { NEARAI_DEFAULT_MODEL } from '../near/nearAiContext.js';

export const hotKey = (tier, id) => `${tier}:${id}`;

export function parseHotKey(key) {
  const i = String(key).indexOf(':');
  return i < 0 ? { tier: '', id: String(key) } : { tier: key.slice(0, i), id: key.slice(i + 1) };
}

// The model the current prefs would use, as a hotlist key (null = local "Auto",
// where the concrete model is only known once one is picked/loaded).
export function currentHotKey(prefs, loadedLocalId = null) {
  const tier = prefs.inference || 'nearai';
  if (tier === 'nearai') return hotKey('nearai', prefs.nearAi?.model || NEARAI_DEFAULT_MODEL);
  if (tier === 'external') return prefs.externalApi?.model ? hotKey('external', prefs.externalApi.model) : null;
  const id = prefs.modelOverride || loadedLocalId;
  return id ? hotKey('local', id) : null;
}

// Until the user curates the list, offer the model in use plus the NEAR AI
// default, so the dropdown is never empty or a dead end.
export function effectiveHotlist(prefs, loadedLocalId = null) {
  if (Array.isArray(prefs.hotModels)) return prefs.hotModels;
  return [...new Set([currentHotKey(prefs, loadedLocalId), hotKey('nearai', NEARAI_DEFAULT_MODEL)].filter(Boolean))];
}

// Human label for a key. `naiModels` is the (cached) NEAR AI catalog, if loaded.
export function hotLabel(key, naiModels) {
  const { tier, id } = parseHotKey(key);
  if (tier === 'local') return getModel(id)?.name || id;
  if (tier === 'nearai') return (naiModels || []).find((m) => m.id === id)?.name || id;
  return id;
}

export const TIER_LABELS = { nearai: 'NEAR AI TEE', local: 'On device', external: 'External API' };
