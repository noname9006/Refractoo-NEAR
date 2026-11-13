// IndexedDB cache for fetched public chain data, keyed by wallet address.
// Tiny no-dependency wrapper. Enables cache-first cluster loading.
//
// PRIVACY: only PUBLIC on-chain data is cached here. Never store decrypted
// confidential-token amounts (CoFHE / Zama / Inco) — those stay in memory for
// the session only. See src/data/shielded.js.
//
// The database is NAMESPACED BY NETWORK MODE. Wallet addresses are the same in
// both modes, so without this the cache-first paint would render Sepolia
// balances into a mainnet dashboard on the next load.

import { cacheDbName } from '../config/networks.js';

const DB_NAME = cacheDbName();
const STORE = 'chainData';
let _dbPromise = null;

// Opens the DB, self-healing if it exists WITHOUT our store (e.g. something
// opened the name with no version first, creating an empty v1 — then our
// open(…, 1) never fires onupgradeneeded). In that case reopen at version+1.
function openAt(version) {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading must not be blocked by our open handle.
      db.onversionchange = () => { db.close(); _dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // An older tab holding the DB open can block the upgrade indefinitely —
    // don't hang the app on it; run uncached until that tab closes.
    req.onblocked = () => {
      console.warn('[dataCache] upgrade blocked by another open tab — close other app tabs');
      reject(new Error('IndexedDB upgrade blocked'));
    };
  });
}

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = (async () => {
    let db = await openAt(); // current version, whatever it is
    if (!db.objectStoreNames.contains(STORE)) {
      const next = db.version + 1;
      db.close();
      db = await openAt(next);
    }
    return db;
  })().catch((err) => { _dbPromise = null; throw err; });
  return _dbPromise;
}

async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    // For a get, req.result is the stored value (or undefined if absent).
    // For put/clear it's the key/undefined, which callers ignore.
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

const key = (address) => address.toLowerCase();

export async function getCachedData(address) {
  try {
    return await tx('readonly', (store) => store.get(key(address)));
  } catch (err) {
    console.warn('[dataCache] read failed', err);
    return undefined;
  }
}

export async function setCachedData(address, data) {
  try {
    await tx('readwrite', (store) => store.put({ ...data, cachedAt: Date.now() }, key(address)));
  } catch (err) {
    console.warn('[dataCache] write failed', err);
  }
}

export async function getManyCached(addresses) {
  const entries = await Promise.all(
    addresses.map(async (a) => [a, await getCachedData(a)])
  );
  return Object.fromEntries(entries);
}

// Enriched per-wallet data (token balances/aave/approvals) cached separately so
// a chain whose multicall fails this load can fall back to its last-good tokens.
const enKey = (address) => `enriched:${address.toLowerCase()}`;

export async function getCachedEnriched(address) {
  try {
    return await tx('readonly', (store) => store.get(enKey(address)));
  } catch {
    return undefined;
  }
}

export async function setCachedEnriched(address, chains) {
  try {
    await tx('readwrite', (store) => store.put({ chains, cachedAt: Date.now() }, enKey(address)));
  } catch (err) {
    console.warn('[dataCache] enriched write failed', err);
  }
}

export async function clearCache() {
  try {
    await tx('readwrite', (store) => store.clear());
  } catch (err) {
    console.warn('[dataCache] clear failed', err);
  }
}
