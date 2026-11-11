// Browser storage preflight for model downloads. wllama caches GGUFs in OPFS
// (Origin Private File System) — a browser-sandboxed store that lives inside the
// browser's PROFILE directory. A web page cannot choose OPFS's disk location:
// relocating it is a browser-level action (move the browser profile /
// user-data-dir to another drive). What the page CAN do is check the available
// quota before a multi-GB download and ask the browser not to evict the cache.

// Returns { supported, quota, usage, free } in bytes — free = quota - usage, the
// headroom this origin has left. Older/unsupported browsers → { supported:false }.
export async function estimateStorage() {
  try {
    if (!navigator.storage?.estimate) return { supported: false };
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    return { supported: true, quota, usage, free: Math.max(0, quota - usage) };
  } catch {
    return { supported: false };
  }
}

// Best-effort request to make this origin's storage persistent so the browser
// doesn't silently evict the cached model under disk pressure. Returns the
// granted boolean, or null when unsupported.
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
