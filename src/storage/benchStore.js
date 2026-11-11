// IndexedDB store for /bench sweep results.
//
// Separate database (`pwai-bench`) from the main app's chain-data cache
// (`pwai`) so clearing one never touches the other. Two object stores:
//   sweeps — one row per "Start" click (config + hardware snapshot)
//   runs   — one row per combination result, FK'd to its sweep via sweepId
// Mirrors dataCache.js's dependency-free open/transaction style, generalised
// to multi-store / multi-request transactions (sweep+runs deletes need both).

const DB_NAME = 'pwai-bench';
const DB_VERSION = 1;
const STORE_SWEEPS = 'sweeps';
const STORE_RUNS = 'runs';
const RUNS_BY_SWEEP = 'bySweepId';

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SWEEPS)) {
        db.createObjectStore(STORE_SWEEPS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_RUNS)) {
        const runs = db.createObjectStore(STORE_RUNS, { keyPath: 'id' });
        runs.createIndex(RUNS_BY_SWEEP, 'sweepId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Runs `fn(transaction)` inside a transaction over `storeNames`. `fn` may
// issue any number of requests against the transaction's stores (awaiting
// reqPromise() between them is safe — the transaction stays open across
// those microtask hops); whatever it returns/resolves is the tx's result.
async function tx(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function addSweep(sweep) {
  const record = { id: sweep.id || uid(), ...sweep };
  try {
    await tx(STORE_SWEEPS, 'readwrite', (t) => reqPromise(t.objectStore(STORE_SWEEPS).put(record)));
  } catch (err) {
    console.warn('[benchStore] addSweep failed', err);
  }
  return record.id;
}

export async function updateSweep(id, patch) {
  try {
    await tx(STORE_SWEEPS, 'readwrite', async (t) => {
      const store = t.objectStore(STORE_SWEEPS);
      const existing = await reqPromise(store.get(id));
      if (!existing) return;
      store.put({ ...existing, ...patch });
    });
  } catch (err) {
    console.warn('[benchStore] updateSweep failed', err);
  }
}

// A sweep left with status:'running' only exists because the tab that was
// running it navigated away, refreshed, or crashed mid-sweep — the in-memory
// AbortController and progress state die with the page, but the IndexedDB row
// never got its final updateSweep(). Called once when the /bench page mounts:
// any 'running' row at that point can't actually be running (this fresh mount
// has no live sweep of its own), so relabel it 'interrupted' instead of
// leaving a misleading "running" status behind forever.
export async function markOrphanedSweepsInterrupted() {
  try {
    await tx(STORE_SWEEPS, 'readwrite', async (t) => {
      const store = t.objectStore(STORE_SWEEPS);
      const all = await reqPromise(store.getAll());
      for (const sweep of all || []) {
        if (sweep.status === 'running') {
          store.put({ ...sweep, status: 'interrupted', finishedAt: sweep.finishedAt ?? Date.now() });
        }
      }
    });
  } catch (err) {
    console.warn('[benchStore] markOrphanedSweepsInterrupted failed', err);
  }
}

export async function addRun(run) {
  const record = { id: run.id || uid(), ...run };
  try {
    await tx(STORE_RUNS, 'readwrite', (t) => reqPromise(t.objectStore(STORE_RUNS).put(record)));
  } catch (err) {
    console.warn('[benchStore] addRun failed', err);
  }
  return record.id;
}

export async function getAllSweeps() {
  try {
    const all = await tx(STORE_SWEEPS, 'readonly', (t) => reqPromise(t.objectStore(STORE_SWEEPS).getAll()));
    return (all || []).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  } catch (err) {
    console.warn('[benchStore] getAllSweeps failed', err);
    return [];
  }
}

export async function getRunsForSweep(sweepId) {
  try {
    const runs = await tx(STORE_RUNS, 'readonly', (t) =>
      reqPromise(t.objectStore(STORE_RUNS).index(RUNS_BY_SWEEP).getAll(sweepId))
    );
    return runs || [];
  } catch (err) {
    console.warn('[benchStore] getRunsForSweep failed', err);
    return [];
  }
}

export async function getAllRuns() {
  try {
    const runs = await tx(STORE_RUNS, 'readonly', (t) => reqPromise(t.objectStore(STORE_RUNS).getAll()));
    return runs || [];
  } catch (err) {
    console.warn('[benchStore] getAllRuns failed', err);
    return [];
  }
}

// Deletes a sweep and every run row that belongs to it, in one transaction
// (so a failure can't leave orphaned runs behind).
export async function deleteSweep(sweepId) {
  try {
    await tx([STORE_SWEEPS, STORE_RUNS], 'readwrite', async (t) => {
      t.objectStore(STORE_SWEEPS).delete(sweepId);
      const index = t.objectStore(STORE_RUNS).index(RUNS_BY_SWEEP);
      await new Promise((resolve, reject) => {
        const cursorReq = index.openCursor(IDBKeyRange.only(sweepId));
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) { resolve(); return; }
          cursor.delete();
          cursor.continue();
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });
    });
  } catch (err) {
    console.warn('[benchStore] deleteSweep failed', err);
  }
}

export async function clearAll() {
  try {
    await tx([STORE_SWEEPS, STORE_RUNS], 'readwrite', (t) => {
      t.objectStore(STORE_SWEEPS).clear();
      t.objectStore(STORE_RUNS).clear();
    });
  } catch (err) {
    console.warn('[benchStore] clearAll failed', err);
  }
}
