// Agent conversations ("sessions"), kept per origin.
//
// Measured before writing this: every Run replaced the previous transcript, so a conversation
// was lost the moment a new goal was typed. A session is the persisted form of a run: the full
// transcript, what ran it, and how it ended. Continuing a session feeds its transcript back to
// the model, so a follow-up goal no longer starts from nothing.
//
// Per origin like snapshots, because a session only means something against the page whose
// tools it drove. Kept in chrome.storage.local: it must survive the browser, and it never
// leaves the machine (the same rule as every other Explorer store).

const KEY = 'agentSessions';

// Ten conversations per site is more history than a developer reads in a sitting and still
// small — a transcript is text, but ten bounded is predictable. The oldest is dropped rather
// than refusing to save, so finishing a run never fails.
const KEEP = 10;

async function read() {
  const stored = await chrome.storage.local.get(KEY);
  const value = stored?.[KEY];
  return value && typeof value === 'object' ? value : {};
}

export async function listSessions(origin) {
  const map = await read();
  return (map[origin] ?? []).slice();
}

export async function getSession(origin, id) {
  return (await listSessions(origin)).find((entry) => entry.id === id) ?? null;
}

// Newest first. Saving an id that already exists updates it in place and moves it to the top —
// a continued conversation reads as the most recent thing, which is what it is.
export async function saveSession(origin, session) {
  const map = await read();
  const rest = (map[origin] ?? []).filter((entry) => entry.id !== session.id);
  map[origin] = [session, ...rest].slice(0, KEEP);
  await chrome.storage.local.set({ [KEY]: map });
  return { saved: session.id, kept: map[origin].length };
}

export async function deleteSession(origin, id) {
  const map = await read();
  map[origin] = (map[origin] ?? []).filter((entry) => entry.id !== id);
  if (!map[origin].length) delete map[origin];
  await chrome.storage.local.set({ [KEY]: map });
  return { deleted: true };
}

export async function clearSessions(origin) {
  const map = await read();
  delete map[origin];
  await chrome.storage.local.set({ [KEY]: map });
  return { cleared: true };
}

// Every site that has conversations, with how many — for the data screen.
export async function listSessionOrigins() {
  const map = await read();
  return Object.entries(map)
    .map(([origin, list]) => ({ origin, count: list.length }))
    .sort((a, b) => a.origin.localeCompare(b.origin));
}

export async function clearAllSessions() {
  await chrome.storage.local.set({ [KEY]: {} });
  return { cleared: true };
}
