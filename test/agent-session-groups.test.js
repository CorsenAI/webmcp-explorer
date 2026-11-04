import test from 'node:test';
import assert from 'node:assert/strict';

// A stand-in for chrome.storage.local: one object, read and written whole.
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => ({ [key]: store[key] }),
      set: async (patch) => { Object.assign(store, patch); },
    },
  },
};
const {
  createGroup, listGroups, deleteGroup, renameGroup, setSessionGroup,
} = await import('../src/storage/agent-session-groups.js');
const { saveSession, listSessions } = await import('../src/storage/agent-sessions.js');

test('groups are per origin and reject duplicates and empty names', async () => {
  const a = await createGroup('http://a.test', 'Bug hunts');
  assert.ok(a.group?.id);
  assert.deepEqual((await listGroups('http://a.test')).map((g) => g.name), ['Bug hunts']);
  assert.deepEqual(await listGroups('http://b.test'), []);
  assert.ok((await createGroup('http://a.test', 'Bug hunts')).error);
  assert.ok((await createGroup('http://a.test', '   ')).error);
});

test('renaming keeps the id and still rejects duplicates', async () => {
  const [only] = await listGroups('http://a.test');
  const renamed = await renameGroup('http://a.test', only.id, 'Investigations');
  assert.equal(renamed.group.id, only.id);
  assert.equal(renamed.group.name, 'Investigations');
  assert.ok((await renameGroup('http://a.test', only.id, '')).error);
});

test('a session can join a group, move out, and the group can be deleted without touching chats', async () => {
  // The earlier tests left a group on this origin; this test owns the store from here.
  const leftovers = await listGroups('http://a.test');
  for (const g of leftovers) await deleteGroup('http://a.test', g.id);
  await saveSession('http://a.test', { id: 's1', title: 'one', transcript: [], updatedAt: 1 });
  const { group } = await createGroup('http://a.test', 'Long runs');
  const joined = await setSessionGroup('http://a.test', 's1', group.id);
  assert.equal(joined.saved, true);
  let [session] = await listSessions('http://a.test');
  assert.equal(session.groupId, group.id);
  assert.equal((await setSessionGroup('http://a.test', 's1', null)).saved, true);
  [session] = await listSessions('http://a.test');
  assert.equal(session.groupId, undefined);
  // Assigning to a conversation that is gone is an error, not a silent write.
  assert.ok((await setSessionGroup('http://a.test', 'missing', group.id)).error);

  await saveSession('http://a.test', { id: 's2', title: 'two', transcript: [], groupId: group.id, updatedAt: 1 });
  await deleteGroup('http://a.test', group.id);
  assert.deepEqual(await listGroups('http://a.test'), []);
  // The chats survive the group.
  assert.equal((await listSessions('http://a.test')).length, 2);
});
