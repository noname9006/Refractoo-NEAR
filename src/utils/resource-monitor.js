// Shared device-resource snapshot (RAM + VRAM), polled from the local helper
// server's /api/sysinfo. ONE poller feeds multiple consumers — the chat-window
// resource strip and the wllama throughput logger both read the same cached
// snapshot — so we never spawn the (PowerShell-backed) sysinfo probe more than
// once per interval no matter how many readers there are.
//
// Cost note: each poll spawns the server-side probe, so polling is ref-counted
// and only runs while something is actually watching (the assistant starts it
// when the AI is in use and stops it otherwise). RAM/VRAM don't move fast, so a
// 15s cadence is plenty fresh while staying cheap.

import { fetchHostInfo } from './system-info.js';

const POLL_MS = 15000;
const GiB = 1024 ** 3;

let snapshot = null; // { ram, vram, at } | null
let timer = null;
let refs = 0;
const subs = new Set();

function parse(info) {
  if (!info) return null;
  const mem = info.memory;
  const ram = mem?.total
    ? { total: mem.total, free: mem.free, used: Math.max(0, mem.total - mem.free) }
    : null;
  // The primary (compute) GPU carries the system-wide used-VRAM figure; see
  // server/sysinfo.js. vramFree may be null on non-primary cards / non-Windows.
  const g = info.gpus?.find((x) => x.primary) || info.gpus?.[0] || null;
  const vram = g?.vramTotal
    ? {
        name: g.name,
        total: g.vramTotal,
        free: g.vramFree,
        used: g.vramFree != null ? Math.max(0, g.vramTotal - g.vramFree) : null,
      }
    : null;
  return { ram, vram, at: Date.now() };
}

async function poll() {
  try {
    snapshot = parse(await fetchHostInfo());
  } catch {
    snapshot = null;
  }
  for (const cb of subs) {
    try { cb(snapshot); } catch { /* a bad subscriber must not kill the loop */ }
  }
}

// Latest snapshot without triggering a fetch — cheap, synchronous. Used by the
// throughput logger so it never adds a network/PowerShell hit per log tick.
export function getResourceSnapshot() {
  return snapshot;
}

// Ref-counted start. Returns a stop function; call it when the consumer unmounts.
export function startResourceMonitor() {
  refs += 1;
  if (timer == null) {
    poll(); // immediate first read so the UI isn't blank for 15s
    timer = setInterval(poll, POLL_MS);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    refs = Math.max(0, refs - 1);
    if (refs === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

// Subscribe to snapshot updates. Fires immediately with the current snapshot if
// one exists. Returns an unsubscribe function.
export function subscribeResources(cb) {
  subs.add(cb);
  if (snapshot) cb(snapshot);
  return () => subs.delete(cb);
}

function gib(n) {
  return n == null ? '—' : `${(n / GiB).toFixed(1)}G`;
}

// Compact one-line RAM/VRAM summary for console logs, e.g.
// "RAM 6.2G/15.9G VRAM 3.5G/8.0G". Empty string when no snapshot yet.
export function describeResources() {
  const s = snapshot;
  if (!s) return '';
  const ram = s.ram ? `RAM ${gib(s.ram.used)}/${gib(s.ram.total)}` : '';
  const vram = s.vram
    ? `VRAM ${s.vram.used != null ? gib(s.vram.used) : '?'}/${gib(s.vram.total)}`
    : '';
  return [ram, vram].filter(Boolean).join(' ');
}
