import { cacheDbName } from '../config/networks.js';
// Device-resource probing and per-category local-storage accounting for the
// Settings panel. Everything here reads the user's OWN machine/browser — nothing
// is sent anywhere. Numbers are best-effort: browsers deliberately fuzz or hide
// some of them (RAM is capped/rounded, VRAM is not exposed by WebGPU at all,
// "disk" is the browser's per-origin quota, not the physical drive).

import { detectGPU } from './gpu-detector.js';
import { estimateStorage } from './storage-quota.js';
import { clearCache } from '../storage/dataCache.js';
import { MODELS } from '../models/registry.js';

const GB = 1e9;
export function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1e6) return `${(n / 1e3).toFixed(1)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e9).toFixed(2)} GB`;
}

// RAM and VRAM are conventionally sized in binary GiB but labelled "GB" by
// every tool that reports them (Task Manager, GPU-Z, nvidia-smi) — a card
// with 8573157376 bytes of VRAM is a "8GB" card reporting 7.98 GiB (a small
// reserved firmware/BIOS carve-out under a clean 8 GiB), and showing it with
// decimal math (fmtBytes) inflates it to 8.57, further from the printed spec.
// Use this (not fmtBytes) for memory figures; keep fmtBytes for disk/storage,
// which browsers report in decimal.
export function fmtBytesBin(n) {
  if (n == null) return '—';
  const KiB = 1024, MiB = KiB * 1024, GiB = MiB * 1024;
  if (n < KiB) return `${n} B`;
  if (n < MiB) return `${(n / KiB).toFixed(1)} KB`;
  if (n < GiB) return `${(n / MiB).toFixed(1)} MB`;
  return `${(n / GiB).toFixed(2)} GB`;
}

// ── Device resources ──────────────────────────────────────────────────────────
// VRAM: WebGPU intentionally does not expose it. The closest signal is the
// adapter's maxBufferSize limit (a per-allocation cap, NOT total memory) — shown
// only as a rough hint, clearly labelled.
export async function detectResources() {
  const ram = navigator.deviceMemory || null; // GiB, approximate & capped (often ≤8)
  const cores = navigator.hardwareConcurrency || null;
  const est = await estimateStorage(); // browser per-origin quota, not the whole disk
  const gpu = await detectGPU();

  let gpuMaxBuffer = null;
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter?.limits?.maxBufferSize) gpuMaxBuffer = Number(adapter.limits.maxBufferSize);
    }
  } catch { /* ignore */ }

  return {
    ram, // GiB or null
    cores,
    disk: est.supported
      ? { quota: est.quota, usage: est.usage, free: est.free }
      : null,
    gpu: {
      hasWebGPU: gpu.hasWebGPU,
      vendor: gpu.vendor,
      architecture: gpu.architecture,
      isFallbackAdapter: gpu.isFallbackAdapter,
      maxBuffer: gpuMaxBuffer, // hint only — NOT total VRAM
    },
  };
}

// ── Host system info (from the local helper server) ───────────────────────────
// CPU model, physical cores, total/free RAM and per-GPU VRAM aren't exposed to
// web pages, so the local server reads them with Node's `os` module (+ a Windows
// PowerShell probe). Returns null if the server isn't reachable (e.g. static
// hosting without the helper) — the UI then falls back to the browser hints.
export async function fetchHostInfo() {
  try {
    const r = await fetch('/api/sysinfo');
    if (!r.ok) return null;
    const j = await r.json();
    return j?.ok ? j.info : null;
  } catch {
    return null;
  }
}

// ── Cached AI models (for the per-model delete submenu) ───────────────────────
// "AI model files" covers two stores: the wllama GGUFs (base/analysis + the
// Gemma audio model) cached in OPFS, and the Whisper voice model cached by
// transformers.js in the Cache Storage API. We surface both as one list so a
// user can delete a particular model rather than wiping every download.

// HF download URLs look like `…/<org>/<repo>/resolve/<rev>/<file>`. The
// `<org>/<repo>` pair is the model id we group transformers.js shards under.
function transformersModelId(u) {
  try {
    const p = new URL(u).pathname.split('/').filter(Boolean);
    const ri = p.indexOf('resolve');
    if (ri >= 2) return `${p[ri - 2]}/${p[ri - 1]}`;
    return p.slice(0, 2).join('/');
  } catch {
    return u;
  }
}

const TRANSFORMERS_CACHE = 'transformers-cache';

async function listTransformersModels() {
  if (typeof caches === 'undefined') return [];
  let cache;
  try {
    cache = await caches.open(TRANSFORMERS_CACHE);
  } catch {
    return [];
  }
  const reqs = await cache.keys();
  const groups = new Map(); // id -> { size, urls: [] }
  for (const req of reqs) {
    let size = 0;
    try {
      const res = await cache.match(req);
      const len = res?.headers.get('content-length');
      if (len) size = Number(len);
      else if (res) size = (await res.clone().blob()).size;
    } catch { /* unreadable entry — count it as 0 but still listable */ }
    const id = transformersModelId(req.url);
    const g = groups.get(id) || { size: 0, urls: [] };
    g.size += size;
    g.urls.push(req.url);
    groups.set(id, g);
  }
  return [...groups.entries()].map(([id, g]) => ({
    key: `transformers:${id}`,
    kind: 'transformers',
    name: id.split('/').pop().replace(/[-_]/g, ' '),
    role: 'Voice (speech-to-text)',
    voice: true,
    size: g.size || null,
    urls: g.urls,
  }));
}

async function listWllamaModels() {
  try {
    const { ModelManager } = await import('@wllama/wllama');
    const mm = new ModelManager();
    const models = await mm.getModels({ includeInvalid: true });
    return models.map((m) => {
      const reg = MODELS.find((r) => r.source?.url === m.url);
      const voice = !!(reg?.audioInput || /voice/i.test(reg?.role || ''));
      return {
        key: m.url,
        kind: 'wllama',
        name: reg?.name || (m.url.split('/').pop() || 'Model'),
        role: reg?.role || 'Model',
        voice,
        size: m.size > 0 ? m.size : null,
      };
    });
  } catch (e) {
    console.warn('[system-info] wllama model list failed', e);
    return [];
  }
}

// One flat list of every cached model (basic + voice), each with a stable `key`,
// human name, role and on-disk size. Sorted voice-last, biggest-first.
export async function listCachedModels() {
  const [wl, tf] = await Promise.all([listWllamaModels(), listTransformersModels()]);
  return [...wl, ...tf].sort(
    (a, b) => Number(a.voice) - Number(b.voice) || (b.size || 0) - (a.size || 0)
  );
}

// Deletes the given cached models (as returned by listCachedModels). wllama
// GGUFs are removed via its ModelManager (handles multi-shard models); Whisper
// shards are deleted straight from Cache Storage.
export async function deleteCachedModels(items) {
  const wllamaKeys = new Set(items.filter((i) => i.kind === 'wllama').map((i) => i.key));
  const tfUrls = items.filter((i) => i.kind === 'transformers').flatMap((i) => i.urls || []);

  if (wllamaKeys.size) {
    try {
      const { ModelManager } = await import('@wllama/wllama');
      const mm = new ModelManager();
      const models = await mm.getModels({ includeInvalid: true });
      for (const m of models) {
        if (wllamaKeys.has(m.url)) await m.remove();
      }
    } catch (e) {
      console.warn('[system-info] wllama model delete failed', e);
    }
  }
  if (tfUrls.length && typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(TRANSFORMERS_CACHE);
      for (const u of tfUrls) await cache.delete(u);
    } catch (e) {
      console.warn('[system-info] transformers cache delete failed', e);
    }
  }
}

// ── Local storage accounting, by category ─────────────────────────────────────
// Each category names the concrete browser stores it owns so "Delete" is exact.
// `models` (the multi-GB GGUF cache in OPFS) is measured by walking OPFS; the
// small caches are measured by serialised byte length.

const LS = {
  icons: ['cg_icons_v3'],
  registry: ['cg_tokenmap_v3'],
  dialogues: ['pwai.chats', 'pwai.chat'],
  settings: ['pwai.layout', 'card_order_v1', 'wllama_gpu_broken_v2', 'wllama_gpu_broken_v1'],
};

function lsBytes(keys) {
  let total = 0;
  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v != null) total += new Blob([v]).size + new Blob([k]).size;
  }
  return total;
}

// Sum of every value in the IndexedDB chainData store (balances + transactions +
// enriched token/DeFi/approval data). Opens the existing DB without forcing a
// version so it never collides with dataCache's own upgrade.
async function idbChainBytes() {
  try {
    if (!('indexedDB' in window)) return 0;
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(cacheDbName());
      // Never CREATE the DB from here — an empty v1 would block dataCache's
      // store creation. Abort if it doesn't exist yet.
      req.onupgradeneeded = () => req.transaction.abort();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains('chainData')) { db.close(); return 0; }
    const bytes = await new Promise((resolve) => {
      let total = 0;
      const t = db.transaction('chainData', 'readonly');
      const cur = t.objectStore('chainData').openCursor();
      cur.onsuccess = (e) => {
        const c = e.target.result;
        if (!c) return; // cursor done — t.oncomplete resolves
        try { total += new Blob([JSON.stringify(c.value)]).size; } catch {}
        c.continue();
      };
      t.oncomplete = () => resolve(total);
      t.onerror = () => resolve(total);
    });
    db.close();
    return bytes;
  } catch {
    return 0;
  }
}

// Recursively sum file sizes in OPFS (where wllama caches model GGUFs).
async function opfsBytes(dir) {
  let total = 0;
  try {
    for await (const [, handle] of dir.entries()) {
      if (handle.kind === 'file') {
        const f = await handle.getFile();
        total += f.size;
      } else {
        total += await opfsBytes(handle);
      }
    }
  } catch { /* OPFS unavailable */ }
  return total;
}

// Bytes held by the Whisper voice model in the transformers.js Cache Storage.
// Counted alongside the OPFS GGUFs so the "AI model files" category reflects ALL
// cached models (and stays enabled when only a voice model is present).
async function transformersCacheBytes() {
  if (typeof caches === 'undefined') return 0;
  try {
    const cache = await caches.open(TRANSFORMERS_CACHE);
    const reqs = await cache.keys();
    let total = 0;
    for (const req of reqs) {
      const res = await cache.match(req);
      const len = res?.headers.get('content-length');
      if (len) total += Number(len);
      else if (res) { try { total += (await res.clone().blob()).size; } catch {} }
    }
    return total;
  } catch {
    return 0;
  }
}

async function modelBytes() {
  let total = 0;
  try {
    if (navigator.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory();
      total += await opfsBytes(root);
    }
  } catch { /* OPFS unavailable */ }
  total += await transformersCacheBytes();
  return total;
}

// Category metadata is consumed by the Settings UI (label + icon name + note).
export const STORAGE_CATEGORIES = [
  { id: 'models', label: 'AI model files', icon: 'ICpu', note: 'Downloaded analysis & voice models cached in the browser. Re-downloadable.' },
  { id: 'chain', label: 'Chain & transaction data', icon: 'IDatabase', note: 'Balances, transactions, DeFi positions & approvals.' },
  { id: 'tokens', label: 'Token icons & registry', icon: 'IImage', note: 'Cached token logos and metadata used for naming & scam filtering.' },
  { id: 'dialogues', label: 'Conversation history', icon: 'IChat', note: 'Your saved chats with the local assistant.' },
  { id: 'prices', label: 'Price data', icon: 'IClock', note: 'Fetched live each session — not stored on device.' },
  { id: 'settings', label: 'Layout & app settings', icon: 'IGear', note: 'Dashboard layout, card order, device flags. Wallets & prefs are kept.' },
];

// Returns { byId: {id: bytes}, total, originUsage } — total is the sum of the
// categories above; originUsage is the browser's reported total for this origin
// (may exceed `total` due to overhead/other stores).
export async function measureStorage() {
  const [models, chain, est] = await Promise.all([
    modelBytes(),
    idbChainBytes(),
    estimateStorage(),
  ]);
  const byId = {
    models,
    chain,
    tokens: lsBytes(LS.icons) + lsBytes(LS.registry),
    dialogues: lsBytes(LS.dialogues),
    prices: 0, // never persisted
    settings: lsBytes(LS.settings),
  };
  const total = Object.values(byId).reduce((a, b) => a + b, 0);
  return { byId, total, originUsage: est.supported ? est.usage : null };
}

// Clears OPFS contents (the model cache). Removes every top-level entry.
async function clearModelCache() {
  try {
    if (!navigator.storage?.getDirectory) return;
    const root = await navigator.storage.getDirectory();
    const names = [];
    for await (const [name] of root.entries()) names.push(name);
    for (const name of names) {
      await root.removeEntry(name, { recursive: true }).catch(() => {});
    }
  } catch (e) {
    console.warn('[system-info] clearModelCache failed', e);
  }
}

// Purges the stores backing a category. After this the UI should re-measure and,
// for dialogues, the assistant clears its in-memory thread (see the event).
export async function clearCategory(id) {
  switch (id) {
    case 'models':
      await clearModelCache();
      break;
    case 'chain':
      await clearCache();
      break;
    case 'dialogues':
      LS.dialogues.forEach((k) => localStorage.removeItem(k));
      window.dispatchEvent(new CustomEvent('pwai-clear-dialogues'));
      break;
    case 'tokens':
      LS.icons.forEach((k) => localStorage.removeItem(k));
      LS.registry.forEach((k) => localStorage.removeItem(k));
      break;
    case 'settings':
      LS.settings.forEach((k) => localStorage.removeItem(k));
      break;
    case 'prices':
    default:
      break; // nothing persisted
  }
}
