// Chat groups: local labels over the session store (F9).
//
// A group is metadata on a session, not a container — moving a chat between groups rewrites
// one field, and a deleted group leaves its chats ungrouped rather than deleting them. Groups
// are per origin like the sessions themselves: this site's organisation is not another site's.

const GROUPS_KEY = 'agentSessionGroups';

async function read(origin) {
  const stored = await chrome.storage.local.get(GROUPS_KEY);
  const map = stored?.[GROUPS_KEY];
  return map && typeof map === 'object' ? (map[origin] ?? []) : [];
}

async function write(origin, groups) {
  const stored = await chrome.storage.local.get(GROUPS_KEY);
  const map = stored?.[GROUPS_KEY] && typeof stored[GROUPS_KEY] === 'object'
    ? stored[GROUPS_KEY] : {};
  if (groups.length) map[origin] = groups;
  else delete map[origin];
  await chrome.storage.local.set({ [GROUPS_KEY]: map });
}

export async function listGroups(origin) {
  return read(origin);
}

export async function createGroup(origin, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return { error: 'A group needs a name.' };
  const groups = await read(origin);
  if (groups.some((g) => g.name === trimmed)) return { error: 'That group already exists.' };
  const group = { id: crypto.randomUUID(), name: trimmed, createdAt: Date.now() };
  groups.push(group);
  await write(origin, groups);
  return { group };
}

export async function deleteGroup(origin, id) {
  const groups = await read(origin);
  await write(origin, groups.filter((g) => g.id !== id));
  // Memberships pointing at the deleted group are cleared by the caller's next session save;
  // reading code treats an unknown group as ungrouped, so no sweep is required for safety.
  return { deleted: true };
}

export async function setSessionGroup(origin, sessionId, groupId) {
  const sessions = await chrome.storage.local.get('agentSessions');
  const map = sessions?.agentSessions && typeof sessions.agentSessions === 'object'
    ? sessions.agentSessions : {};
  const list = map[origin] ?? [];
  const session = list.find((s) => s.id === sessionId);
  if (!session) return { error: 'No such conversation.' };
  if (groupId) session.groupId = groupId;
  else delete session.groupId;
  await chrome.storage.local.set({ agentSessions: map });
  return { saved: true };
}

export async function renameGroup(origin, id, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return { error: 'A group needs a name.' };
  const groups = await read(origin);
  const group = groups.find((g) => g.id === id);
  if (!group) return { error: 'No such group.' };
  if (groups.some((g) => g.id !== id && g.name === trimmed)) {
    return { error: 'That group already exists.' };
  }
  group.name = trimmed;
  await write(origin, groups);
  return { group };
}

// Groups are labels over sessions: when every conversation goes, the labels have nothing to
// stick to any more, and the data screen clears them in the same act (D-010 — a stored thing
// the user cannot see and delete is a contradiction of the privacy policy).
export async function clearAllGroups() {
  await chrome.storage.local.set({ [GROUPS_KEY]: {} });
  return { cleared: true };
}
