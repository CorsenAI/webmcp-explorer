// The user's grant for third-party agent access (F11/D-114).
//
// Off by default, per origin. The manifest's externally_connectable only says which origins can
// REACH the channel; this map says which of them may actually USE it, and only the user turns
// that on. Turning it off answers the next request with the refusal — nothing queued or cached
// keeps working through a revoke.

const STORE_KEY = 'externalAgentGrants';

// A grant is { origin, label, grantedAt }. The origin list itself is fixed in
// src/core/external/api.js; a key outside that list is a bug, not a feature.
async function readAll() {
  const stored = await chrome.storage.local.get(STORE_KEY);
  const map = stored?.[STORE_KEY];
  return map && typeof map === 'object' ? map : {};
}

export async function listGrants() {
  const all = await readAll();
  return Object.values(all).sort((a, b) => (a.grantedAt ?? 0) - (b.grantedAt ?? 0));
}

export async function isGranted(origin) {
  const all = await readAll();
  return Boolean(all[origin]);
}

export async function grantOrigin(origin) {
  const all = await readAll();
  all[origin] = { origin, grantedAt: Date.now() };
  await chrome.storage.local.set({ [STORE_KEY]: all });
  return { granted: true, origin };
}

export async function revokeOrigin(origin) {
  const all = await readAll();
  delete all[origin];
  await chrome.storage.local.set({ [STORE_KEY]: all });
  return { revoked: true, origin };
}

export async function clearAllGrants() {
  await chrome.storage.local.remove(STORE_KEY);
  return { cleared: true };
}
