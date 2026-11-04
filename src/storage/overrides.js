// Overrides live in chrome.storage.local: they are small, per-tool, and must survive a
// reload — that is the whole point of "change the tool without changing the site" (D-010).
//
// Keyed by logicalId, so an override follows its tool across reloads and frame id changes
// (D-012). It does NOT follow a contract change: if the site rewrites the schema, the
// override is still there and the UI can show that the underlying tool moved.

const KEY = 'overrides';

export async function loadOverrides() {
  const stored = await chrome.storage.local.get(KEY);
  const map = stored?.[KEY];
  return map && typeof map === 'object' ? map : {};
}

export async function listOverrides() {
  return Object.values(await loadOverrides());
}

export async function getOverride(logicalId) {
  const map = await loadOverrides();
  return map[logicalId] ?? null;
}

export async function saveOverride(override) {
  const map = await loadOverrides();
  map[override.logicalId] = override;
  await chrome.storage.local.set({ [KEY]: map });
  return override;
}

export async function deleteOverride(logicalId) {
  const map = await loadOverrides();
  delete map[logicalId];
  await chrome.storage.local.set({ [KEY]: map });
  return { deleted: true };
}

export async function clearOverrides() {
  await chrome.storage.local.set({ [KEY]: {} });
  return { cleared: true };
}
