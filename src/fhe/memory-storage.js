// In-memory storage backend handed to confidential-token SDKs.
//
// WHY THIS EXISTS — this is a privacy fix, not a convenience.
//
// @zama-fhe/sdk persists DECRYPTED confidential balances by default, keyed by
// token + owner + ciphertext, in IndexedDB or localStorage. That directly
// contradicts the app's stated rule (see storage/local.js and the README privacy
// table): decrypted confidential amounts live in memory for the session only and
// are never written to disk. A user who reveals a shielded balance once should
// not leave that plaintext sitting in their browser profile afterwards.
//
// So every adapter passes this backend instead of letting the SDK pick its own.
// The cost is one relayer round-trip per reveal per page load rather than a
// cached hit — the correct trade for the guarantee the app makes.
//
// The API deliberately covers both shapes SDKs ask for: the sync Web Storage
// interface (getItem/setItem/removeItem/clear) and an async key-value one
// (get/set/remove). Both read the same Map, so it doesn't matter which an SDK
// reaches for.

export function createMemoryStorage() {
  const map = new Map();

  const api = {
    // --- Web Storage-ish (sync) ---
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },

    // --- async key-value ---
    get: async (k) => (map.has(k) ? map.get(k) : null),
    set: async (k, v) => { map.set(k, v); },
    remove: async (k) => { map.delete(k); },
    delete: async (k) => { map.delete(k); },
    keys: async () => [...map.keys()],
  };

  return api;
}

// One shared instance per page load. Wiped on reload, which is the point.
export const memoryStorage = createMemoryStorage();
