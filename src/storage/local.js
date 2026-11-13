// Local-only persistence (localStorage) for small state: the wallet cluster and
// user preferences. Nothing here ever leaves the device.
//
// PRIVACY: only non-sensitive metadata lives here — addresses (already public),
// and prefs — with ONE exception: prefs hold the user's own inference API keys
// (externalApi.apiKey, nearAi.apiKey) in plaintext so the browser can call the
// endpoint directly. Never export, sync or log prefs wholesale. DECRYPTED CONFIDENTIAL AMOUNTS ARE NEVER PERSISTED, by any stack
// (Fhenix CoFHE, Zama, Inco): they live in React state for the session only.
// The FHE SDKs would cache them to IndexedDB if allowed — src/fhe/memory-storage.js
// is what prevents that. Wallet addresses and UI prefs are chain-agnostic and
// deliberately shared across network modes; the chain-data cache is not (see
// config/networks.js → cacheDbName).

const CLUSTER_KEY = 'pwai.cluster';
const PREFS_KEY = 'pwai.prefs';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[storage] write failed', err);
  }
}

// --- Cluster: one personal group of the user's wallet addresses ---

export function getCluster() {
  const c = read(CLUSTER_KEY, { addresses: [], labels: {}, updatedAt: null });
  if (!c.labels) c.labels = {}; // migrate older clusters that predate names
  // NEAR accounts (read-only, by name) live beside the EVM addresses rather than
  // in them, so the EVM chain pipeline never tries to probe "alice.near".
  if (!Array.isArray(c.nearAccounts)) c.nearAccounts = [];
  return c;
}

export function addNearAccount(accountId) {
  const cluster = getCluster();
  const id = String(accountId).trim().toLowerCase();
  if (!cluster.nearAccounts.includes(id)) cluster.nearAccounts.push(id);
  cluster.updatedAt = Date.now();
  write(CLUSTER_KEY, cluster);
  return cluster;
}

export function removeNearAccount(accountId) {
  const cluster = getCluster();
  const id = String(accountId).trim().toLowerCase();
  cluster.nearAccounts = cluster.nearAccounts.filter((x) => x !== id);
  delete cluster.labels[id];
  cluster.updatedAt = Date.now();
  write(CLUSTER_KEY, cluster);
  forgetDeselectedWallet(id);
  return cluster;
}

// The "Explore a demo" mode seeds a public address (labeled "Demo · …") so the
// dashboard populates without a real connection. That demo is SESSION-ONLY: it
// persists for the current page so the dashboard keeps working, but must never
// be auto-restored on reload — otherwise a returning visitor lands on the fake
// demo dashboard instead of the connect/demo prompt. Call this once at startup
// to drop any leftover demo wallet before deciding whether to auto-hydrate.
export function purgeDemoWallets() {
  const cluster = getCluster();
  const demoKeys = Object.keys(cluster.labels || {}).filter((k) =>
    String(cluster.labels[k]).startsWith('Demo · ')
  );
  if (!demoKeys.length) return cluster;
  cluster.addresses = cluster.addresses.filter((a) => !demoKeys.includes(a.toLowerCase()));
  cluster.nearAccounts = cluster.nearAccounts.filter((a) => !demoKeys.includes(a));
  for (const k of demoKeys) delete cluster.labels[k];
  cluster.updatedAt = Date.now();
  write(CLUSTER_KEY, cluster);
  return cluster;
}

export function isKnownWallet(address) {
  const a = address.toLowerCase();
  return getCluster().addresses.some((x) => x.toLowerCase() === a);
}

export function addWallet(address) {
  const cluster = getCluster();
  const exists = cluster.addresses.some((x) => x.toLowerCase() === address.toLowerCase());
  if (!exists) cluster.addresses.push(address);
  cluster.updatedAt = Date.now();
  write(CLUSTER_KEY, cluster);
  return cluster;
}

export function removeWallet(address) {
  const cluster = getCluster();
  const key = address.toLowerCase();
  cluster.addresses = cluster.addresses.filter((x) => x.toLowerCase() !== key);
  if (cluster.labels) delete cluster.labels[key];
  cluster.updatedAt = Date.now();
  write(CLUSTER_KEY, cluster);
  forgetDeselectedWallet(key);
  return cluster;
}

// Human label for a wallet. Falls back to a stable "Wallet N" by cluster order
// so every connected wallet has a name even before the user renames it.
export function walletName(cluster, address) {
  const key = address.toLowerCase();
  if (cluster?.labels?.[key]) return cluster.labels[key];
  const idx = (cluster?.addresses || []).findIndex((x) => x.toLowerCase() === key);
  return `Wallet ${idx >= 0 ? idx + 1 : (cluster?.addresses?.length || 0) + 1}`;
}

// Rename a wallet. An empty/blank name clears the custom label, reverting to the
// "Wallet N" default.
export function renameWallet(address, name) {
  const cluster = getCluster();
  const key = address.toLowerCase();
  const trimmed = (name || '').trim();
  if (trimmed) cluster.labels[key] = trimmed;
  else delete cluster.labels[key];
  cluster.updatedAt = Date.now();
  write(CLUSTER_KEY, cluster);
  return cluster;
}

export function resetCluster() {
  write(CLUSTER_KEY, { addresses: [], nearAccounts: [], labels: {}, updatedAt: null });
}

// --- Prefs ---

const DEFAULT_PREFS = {
  voiceEnabled: null, // null = not yet asked
  voiceEngine: 'whisper',
  modelOverride: null, // null = auto by resources
  // Where chat inference runs: 'local' (on-device wllama) or 'external' (an
  // OpenAI-compatible API the user configures). External is for self-hosted
  // servers — see the privacy badge, which warns when data leaves the device.
  // 'nearai' is the middle tier: NEAR AI Cloud models running in attested TEEs,
  // verified in the browser, prompts end-to-end encrypted to the model.
  inference: 'nearai', // default: NEAR AI TEE (recommended) | 'local' (max privacy) | 'external'
  externalApi: { baseUrl: '', apiKey: '', model: '' },
  // model '' = NEARAI_DEFAULT_MODEL; reasoningBudget undefined = default (32k),
  // 0 = unlimited. Applies only when the Think toggle is on.
  nearAi: { apiKey: '', model: '' },
  // Pseudonymize FACTS + question for off-device tiers (nearai, external):
  // addresses → placeholders. See utils/pseudonymize.js. On-device inference
  // always sees real data.
  redactRemote: true,
  // Show the exact outgoing request (OutboundReview) and wait for "Send" before
  // every off-device request.
  reviewRemote: true,
  // Amount precision per off-device tier, in significant figures (0 = exact).
  // Missing keys fall back to DEFAULT_PRECISION: TEE exact, external 4.
  roundRemote: {},
  // GPU/CPU layer offload for on-device inference. 'auto' offloads everything to
  // the GPU and auto-degrades if it doesn't fit (the safe default). 'manual' pins
  // a specific GPU layer count (offloadGpuLayers; null = derive/all) so the user
  // can trade speed for VRAM headroom. See utils/offload-planner.js.
  offloadMode: 'auto', // 'auto' | 'manual'
  offloadGpuLayers: null, // number of layers on GPU when manual; null = all
  // Token holdings under this USD value (and unpriced tokens) are hidden by
  // default — usually dust/airdrop spam. User-tunable in Settings.
  smallBalanceUsd: 0.02,
  // Quiet design display prefs (mirrored onto <html> by utils/theme.js)
  theme: 'light', // 'light' | 'dark'
  density: 'compact', // 'comfortable' | 'compact'
  texture: 'paper',
  logo: 'prism', // 'prism' | 'inf'
  reduceEffects: false, // true = drop backdrop blur + paper textures (faster render)
};

const INFERENCE_TIERS = ['nearai', 'local', 'external'];

export function getPrefs() {
  const p = { ...DEFAULT_PREFS, ...read(PREFS_KEY, {}) };
  // The user's last choice is remembered; anything missing/unknown (fresh
  // install, an old or corrupted value) falls back to the NEAR AI default.
  if (!INFERENCE_TIERS.includes(p.inference)) p.inference = DEFAULT_PREFS.inference;
  return p;
}

export function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch };
  write(PREFS_KEY, next);
  return next;
}

// --- Layout: dashboard arrangement prefs (column width, collapse state,
// holdings density, activity date format). Card drag-order has its own key
// (CARD_ORDER_KEY in Dashboard.jsx) and is left as-is. ---

const LAYOUT_KEY = 'pwai.layout';

const DEFAULT_LAYOUT = {
  colRatio: 3 / 5,
  collapsed: { summary: false, holdings: false, shielded: false, defi: false, activity: false, caps: false, assistant: false },
  holdingsCompact: false,
  activityAbsTime: false,
  // Wallet / chain filter chips. Stored as the DESELECTED ids so anything new
  // (a freshly added wallet, a newly supported chain) defaults to selected.
  deselectedWallets: [],
  deselectedChains: [],
};

export function getLayout() {
  const l = read(LAYOUT_KEY, {});
  return { ...DEFAULT_LAYOUT, ...l, collapsed: { ...DEFAULT_LAYOUT.collapsed, ...(l.collapsed || {}) } };
}

export function setLayout(patch) {
  const next = { ...getLayout(), ...patch };
  write(LAYOUT_KEY, next);
  return next;
}

// Persist a selection as its complement. `key` is 'deselectedWallets' or
// 'deselectedChains'; `allIds` is what exists right now, `selected` a Set.
// Ids not in `allIds` (e.g. mainnet chains while on testnet) are kept as-is.
export function saveDeselected(key, allIds, selected) {
  const kept = (getLayout()[key] || []).filter((id) => !allIds.includes(id));
  const off = allIds.filter((id) => !selected.has(id));
  return setLayout({ [key]: [...kept, ...off] });
}

function forgetDeselectedWallet(id) {
  const l = getLayout();
  if (l.deselectedWallets.includes(id)) {
    setLayout({ deselectedWallets: l.deselectedWallets.filter((x) => x !== id) });
  }
}

export function setCardCollapsed(card, value) {
  return setLayout({ collapsed: { ...getLayout().collapsed, [card]: value } });
}
