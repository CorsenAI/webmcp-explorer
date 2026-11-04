// IndexedDB store for execution history. Lives in the service worker.
//
// Why not chrome.storage.local: that quota is ~10MB and shared with settings, and a single
// pathological page can produce thousands of calls with large results. Bounded, queryable
// storage belongs here (D-010).
//
// Everything is capped. A site that runs 50 000 tools must not fill the user's profile, and
// deleting history must never be a surprise: `stats()` reports what is stored so the UI can
// show it before anyone clears anything.

const DB_NAME = 'webmcp-explorer';
const DB_VERSION = 2;
const CALLS = 'calls';

export const LIMITS = {
  maxEntries: 2000,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxResultChars: 200_000,
  trimEvery: 50,
};

let dbPromise = null;
let writesSinceTrim = 0;

export function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('invocations')) {
        db.createObjectStore('invocations', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CALLS)) {
        const store = db.createObjectStore(CALLS, { keyPath: 'id' });
        store.createIndex('at', 'at');
        store.createIndex('logicalId', 'logicalId');
        store.createIndex('topOrigin', 'topOrigin');
      }
    };
    let blocked = false;
    request.onblocked = () => {blocked=true;reject(new Error('Close older Explorer pages to finish the database upgrade. Nothing was dispatched.'));};
    request.onsuccess = () => {
      const db=request.result;
      if(blocked){db.close();return;}
      db.onversionchange=()=>{db.close();dbPromise=null;};
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
  dbPromise = dbPromise.catch(error=>{dbPromise=null;throw error;});
  return dbPromise;
}

function run(storeName, mode, work) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = work(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result && result.value !== undefined ? result.value : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  }));
}

// store.count() hands back a request, not a number; the number only exists once the request
// has succeeded. Read it through a box, like the cursors below. Returning the request itself
// made `total` an object: `total <= maxEntries` was false, `total - maxEntries` was NaN, and the
// overflow loop below then deleted EVERY record on each fiftieth write — the whole history,
// silently. Found through the Settings screen, which was the first to show the count.
function countAll(store) {
  const box = { value: 0 };
  const request = store.count();
  request.onsuccess = () => { box.value = request.result; };
  return box;
}

// A huge result is truncated rather than dropped: the developer still sees what came back,
// and the marker says plainly that it was cut.
function capResult(entry) {
  if (typeof entry.result !== 'string' || entry.result.length <= LIMITS.maxResultChars) {
    return entry;
  }
  return {
    ...entry,
    result: entry.result.slice(0, LIMITS.maxResultChars),
    resultTruncated: true,
    resultOriginalChars: entry.result.length,
  };
}

export async function appendCall(entry, topOrigin) {
  const record = { ...capResult(entry), topOrigin: topOrigin ?? null };
  await run(CALLS, 'readwrite', (store) => store.put(record));

  writesSinceTrim += 1;
  if (writesSinceTrim >= LIMITS.trimEvery) {
    writesSinceTrim = 0;
    await enforceLimits();
  }
  return record;
}

// Newest first. Filtered by tool, every matching entry is read before the newest `limit` are
// kept: within one logicalId the index orders records by their random primary key, not by
// time, so cutting at `limit` while iterating returned an arbitrary subset — "the latest
// call" could be any call. Found by running the suite on Linux, where the key order differed
// (D-058). The store is bounded (enforceLimits), so reading a tool's entries whole is cheap.
export function listCalls({ logicalId = null, limit = 100 } = {}) {
  return run(CALLS, 'readonly', (store) => {
    const out = [];
    const box = { value: out };
    const source = logicalId ? store.index('logicalId') : store.index('at');
    const request = logicalId
      ? source.openCursor(IDBKeyRange.only(logicalId), 'prev')
      : source.openCursor(null, 'prev');

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || (!logicalId && out.length >= limit)) return;
      out.push(cursor.value);
      cursor.continue();
    };
    return box;
  }).then((out) => (logicalId ? out.sort((a, b) => b.at - a.at).slice(0, limit) : out));
}

export async function enforceLimits({ now = Date.now() } = {}) {
  const cutoff = now - LIMITS.maxAgeMs;
  const removedOld = await run(CALLS, 'readwrite', (store) => {
    const box = { value: 0 };
    const request = store.index('at').openCursor(IDBKeyRange.upperBound(cutoff));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      box.value += 1;
      cursor.continue();
    };
    return box;
  });

  const total = await run(CALLS, 'readonly', countAll);
  if (total <= LIMITS.maxEntries) return { removedOld, removedOverflow: 0, total };

  const overflow = total - LIMITS.maxEntries;
  const removedOverflow = await run(CALLS, 'readwrite', (store) => {
    const box = { value: 0 };
    const request = store.index('at').openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || box.value >= overflow) return;
      cursor.delete();
      box.value += 1;
      cursor.continue();
    };
    return box;
  });

  return { removedOld, removedOverflow, total: total - removedOverflow };
}

export async function stats() {
  const count = await run(CALLS, 'readonly', countAll);
  let bytes = null;
  try {
    const estimate = await navigator.storage.estimate();
    bytes = estimate.usage ?? null;
  } catch {
    bytes = null;
  }
  const invocationCount = await run('invocations', 'readonly', countAll);
  return { count, invocationCount, bytes, limits: LIMITS };
}

export function clearCalls() {
  return run(CALLS, 'readwrite', (store) => store.clear());
}
