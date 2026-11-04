// Saved contract snapshots, kept per origin.
//
// Per origin because a snapshot only means something against the page it was taken on, and
// because it lets Explorer answer "what changed on this site since I last looked?" without the
// user having to remember which capture belonged where.

const KEY = 'snapshots';

// Ten is more history than anyone reads and still small: a snapshot is a tool list, not a
// transcript. The oldest is dropped rather than refusing to save, so taking one never fails.
const KEEP = 10;

async function read() {
  const stored = await chrome.storage.local.get(KEY);
  const value = stored?.[KEY];
  return value && typeof value === 'object' ? value : {};
}

export async function listSnapshots(origin) {
  const map = await read();
  return (map[origin] ?? []).slice();
}

export async function saveSnapshot(origin, snapshot) {
  const map = await read();
  // Newest first, so "the last one" is the head of the list.
  map[origin] = [snapshot, ...(map[origin] ?? [])].slice(0, KEEP);
  await chrome.storage.local.set({ [KEY]: map });
  return { saved: snapshot.id, kept: map[origin].length };
}

export async function getSnapshot(origin, id) {
  return (await listSnapshots(origin)).find((entry) => entry.id === id) ?? null;
}

export async function deleteSnapshot(origin, id) {
  const map = await read();
  map[origin] = (map[origin] ?? []).filter((entry) => entry.id !== id);
  if (!map[origin].length) delete map[origin];
  await chrome.storage.local.set({ [KEY]: map });
  return { deleted: true };
}

export async function clearSnapshots(origin) {
  const map = await read();
  delete map[origin];
  await chrome.storage.local.set({ [KEY]: map });
  return { cleared: true };
}

// Every site that has snapshots, with how many — for the data screen and for comparing a page
// with a snapshot taken on another site.
export async function listSnapshotOrigins() {
  const map = await read();
  return Object.entries(map)
    .map(([origin, list]) => ({ origin, count: list.length }))
    .sort((a, b) => a.origin.localeCompare(b.origin));
}

export async function clearAllSnapshots() {
  await chrome.storage.local.set({ [KEY]: {} });
  return { cleared: true };
}
