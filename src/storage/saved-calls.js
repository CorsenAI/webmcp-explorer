// Saved calls live in chrome.storage.local: small, hand-made, and expected to survive a reload —
// a saved call that vanished with the tab would be no better than the form (D-010).
//
// Keyed by logicalId, so a call follows its tool across reloads and frame id changes (D-012). It
// does not follow a contract change: the review in core/saved-calls.js says what to do then.

import { addSavedCall } from '../core/saved-calls.js';
import { validateFieldExpectation } from '../core/field-checks.js';

const KEY = 'savedCalls';

async function read() {
  const stored = await chrome.storage.local.get(KEY);
  const value = stored?.[KEY];
  return value && typeof value === 'object' ? value : {};
}

async function write(map) {
  await chrome.storage.local.set({ [KEY]: map });
}

export async function listSavedCalls(logicalId) {
  const map = await read();
  return (map[logicalId] ?? []).slice();
}

// Every saved call of every tool, for the data screen and for "how much is stored".
export async function listAllSavedCalls() {
  const map = await read();
  return Object.values(map).flat();
}

export async function saveSavedCall(saved) {
  if (saved?.expect?.kind === 'fields') {
    const error = validateFieldExpectation(saved.expect);
    if (error) return { error };
  }
  const map = await read();
  map[saved.logicalId] = addSavedCall(map[saved.logicalId], saved);
  await write(map);
  return { saved: saved.id, kept: map[saved.logicalId].length };
}

export async function deleteSavedCall(logicalId, id) {
  const map = await read();
  map[logicalId] = (map[logicalId] ?? []).filter((entry) => entry.id !== id);
  if (!map[logicalId].length) delete map[logicalId];
  await write(map);
  return { deleted: true };
}

export async function clearSavedCalls() {
  await write({});
  return { cleared: true };
}
