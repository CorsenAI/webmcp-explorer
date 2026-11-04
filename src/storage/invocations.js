// Durable, atomic write-before-dispatch. History deletion is deliberately unrelated.
// Receipts contain identity hashes and status, never tool arguments, results, or credentials.
import { openDatabase } from './db.js';
import { canonicalJson, sha256Hex } from '../core/identity.js';

async function transaction(work) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('invocations', 'readwrite');
    const box = {};
    work(tx.objectStore('invocations'), box);
    tx.oncomplete = () => resolve(box.value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Invocation reservation aborted'));
  });
}

export const invocationStore = {
  reserve(record) {
    return transaction((store, box) => {
      const read = store.get(record.id);
      read.onsuccess = () => {
        if (read.result) box.value = { fresh: false, record: read.result };
        else { store.add(record); box.value = { fresh: true, record }; }
      };
    });
  },
  complete(id, fingerprint, outcome) {
    return transaction((store) => {
      const read = store.get(id);
      read.onsuccess = () => {
        if (!read.result || read.result.fingerprint !== fingerprint) return;
        store.put({ ...read.result, status: 'finished', finishedAt: Date.now(),
          outcome: { ok: outcome.ok === true, code: outcome.code ?? null,
            dispatchState: outcome.dispatchState, effectState: outcome.effectState,
            engine: outcome.engine ?? null, argsEncoding: outcome.argsEncoding ?? null } });
      };
    });
  },
};

const refused = (id, code, error, unknown = false) => ({ ok: false, callId: id, code, error,
  attempts: 0, dispatchState: 'not-dispatched', effectState: unknown ? 'unknown' : 'none', replayBlocked: true });

export function createInvocationGuard(store = invocationStore) {
  const active = new Map();
  return async function invoke(request, dispatch) {
    const id = request.callId;
    if (typeof id !== 'string' || !id || id.length > 500) return refused(id, 'invalid-request-id', 'A bounded request id is required.');
    const fingerprint = await sha256Hex(canonicalJson({ ...request, callId: undefined }));
    const pending = active.get(id);
    if (pending) return pending.fingerprint === fingerprint ? pending.promise
      : refused(id, 'request-conflict', 'This request id belongs to a different call.');
    const promise = (async () => {
      const receiptId = await sha256Hex(id);
      let reservation;
      try { reservation = await store.reserve({ id:receiptId, fingerprint, status: 'reserved', at: Date.now(),
        documentId: request.documentId ?? null }); }
      catch { return refused(id, 'reservation-failed', 'The invocation could not be reserved. Nothing was dispatched.'); }
      if (!reservation.fresh) return reservation.record.fingerprint !== fingerprint
        ? refused(id, 'request-conflict', 'This request id belongs to a different call.')
        : refused(id, 'already-invoked', 'This request was already reserved. Its action may have happened; it will not be replayed.', true);
      let outcome;
      try { outcome = await dispatch(); }
      catch { outcome = { ok: false, code: 'execution-interrupted', callId: id, attempts: 1,
        dispatchState: 'dispatched', effectState: 'unknown', error: 'The action could not be confirmed. It will not be retried.' }; }
      try { await store.complete(receiptId, fingerprint, outcome); }
      catch { outcome = { ...outcome, receiptError: true }; } // the reservation remains a tombstone
      return outcome;
    })();
    active.set(id, { fingerprint, promise });
    try { return await promise; } finally { active.delete(id); }
  };
}
