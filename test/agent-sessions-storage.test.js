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
  saveSession, listSessions, getSession, deleteSession, clearSessions,
  listSessionOrigins, clearAllSessions,
} = await import('../src/storage/agent-sessions.js');

const session = (id, turns = 2) => ({
  id, title: `goal ${id}`, createdAt: 1, updatedAt: 1,
  status: 'done', transcript: Array.from({ length: turns }, () => ({ role: 'user', text: 'x' })),
});

test('a session kept on one origin is not listed on another', async () => {
  await saveSession('http://a.test', session('a1'));
  await saveSession('http://b.test', session('b1'));
  assert.deepEqual((await listSessions('http://a.test')).map((s) => s.id), ['a1']);
  assert.deepEqual((await listSessions('http://b.test')).map((s) => s.id), ['b1']);
  assert.deepEqual(await listSessions('http://c.test'), []);
});

test('saving the same id updates in place and moves to the top (a continued conversation)', async () => {
  await clearSessions('http://a.test');
  await saveSession('http://a.test', session('s1'));
  await saveSession('http://a.test', session('s2'));
  const continued = { ...session('s1'), transcript: [...session('s1').transcript, { role: 'user', text: 'follow-up' }] };
  await saveSession('http://a.test', continued);
  const ids = (await listSessions('http://a.test')).map((s) => s.id);
  assert.deepEqual(ids, ['s1', 's2']);
  assert.equal((await listSessions('http://a.test')).length, 2);
  assert.equal((await getSession('http://a.test', 's1')).transcript.length, 3);
});

test('the history is bounded: oldest dropped, never a refusal to save', async () => {
  await clearSessions('http://a.test');
  for (let i = 0; i < 12; i += 1) await saveSession('http://a.test', session(`k${i}`));
  const ids = (await listSessions('http://a.test')).map((s) => s.id);
  assert.equal(ids.length, 10);
  assert.equal(ids[0], 'k11');
  assert.ok(!ids.includes('k0'));
});

test('deleting on one origin leaves the other untouched', async () => {
  await deleteSession('http://a.test', 'k11');
  assert.ok(!(await listSessions('http://a.test')).some((s) => s.id === 'k11'));
  assert.deepEqual((await listSessions('http://b.test')).map((s) => s.id), ['b1']);
});

test('the data summary counts per origin, and clear-all empties everything', async () => {
  await clearAllSessions();
  await saveSession('http://a.test', session('x1'));
  await saveSession('http://a.test', session('x2'));
  await saveSession('http://b.test', session('y1'));
  const origins = await listSessionOrigins();
  assert.deepEqual(origins, [
    { origin: 'http://a.test', count: 2 },
    { origin: 'http://b.test', count: 1 },
  ]);
  await clearAllSessions();
  assert.deepEqual(await listSessionOrigins(), []);
  assert.deepEqual(await listSessions('http://a.test'), []);
});
