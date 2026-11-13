// EVM wallet discovery via EIP-6963 (multi-injected provider discovery). Every
// installed wallet announces itself, so the user picks one explicitly instead
// of us grabbing whichever extension won the race for `window.ethereum`.
// A legacy `window.ethereum` with no 6963 announcement is offered as a fallback.

const wallets = new Map(); // rdns → { info: { uuid, name, icon, rdns }, provider }
const listeners = new Set();
let active = null; // EIP-1193 provider the user picked last

function emit() { listeners.forEach((fn) => fn(listWallets())); }

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e) => {
    const { info, provider } = e.detail || {};
    if (!info?.rdns || !provider) return;
    wallets.set(info.rdns, { info, provider });
    emit();
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

export function refreshWallets() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('eip6963:requestProvider'));
}

export function listWallets() {
  const list = [...wallets.values()];
  const legacy = typeof window !== 'undefined' ? window.ethereum : null;
  if (legacy && !list.some((w) => w.provider === legacy)) {
    list.push({ info: { uuid: 'injected', rdns: 'injected', name: 'Browser wallet', icon: null }, provider: legacy });
  }
  return list;
}

export function subscribeWallets(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setActiveProvider(p) { active = p; }

// The provider for signing (revoke, Inco…): the one the user picked, else the legacy global.
export function getActiveProvider() {
  return active || (typeof window !== 'undefined' ? window.ethereum : null) || null;
}
