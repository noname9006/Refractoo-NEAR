// Theme + display attributes live on <html> (data-theme/density/texture/logo),
// matching the Quiet design system. The light⇄dark swap uses the View
// Transitions API so text is never re-rasterized mid-change (no flicker);
// falls back to an instant swap where unsupported or when reduced-motion is on.

import { getPrefs, setPrefs } from '../storage/local.js';

const root = () => document.documentElement;

export function initTheme() {
  const p = getPrefs();
  const r = root();
  r.setAttribute('data-theme', p.theme || 'light');
  r.setAttribute('data-density', p.density || 'compact');
  r.setAttribute('data-texture', p.texture || 'paper');
  r.setAttribute('data-logo', p.logo || 'prism');
  r.setAttribute('data-effects', p.reduceEffects ? 'reduced' : 'full');
}

// Toggle the heavy visual layers (backdrop blur + paper textures) on/off. The
// pref itself is written by the caller (updatePref); this just mirrors it to
// <html> so the CSS in [data-effects="reduced"] applies immediately.
export function applyEffects(reduced) {
  root().setAttribute('data-effects', reduced ? 'reduced' : 'full');
}

export function getTheme() {
  return root().getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme) {
  const apply = () => {
    root().setAttribute('data-theme', theme);
    setPrefs({ theme });
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduce) document.startViewTransition(apply);
  else apply();
}

export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}
