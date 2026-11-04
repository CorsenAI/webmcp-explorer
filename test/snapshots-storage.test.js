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
const { saveSnapshot, listSnapshots, deleteSnapshot, clearSnapshots } = await import('../src/storage/snapshots.js');

const snap = (id) => ({ id, takenAt: 1, tools: [] });

test('a snapshot taken on one origin is not listed on another (P14)', async () => {
  await saveSnapshot('http://a.test', snap('a1'));
  await saveSnapshot('http://b.test', snap('b1'));
  assert.deepEqual((await listSnapshots('http://a.test')).map((s) => s.id), ['a1']);
  assert.deepEqual((await listSnapshots('http://b.test')).map((s) => s.id), ['b1']);
  assert.deepEqual(await listSnapshots('http://c.test'), []);
});

test('newest first, and the history is bounded', async () => {
  await clearSnapshots('http://a.test');
  for (let i = 0; i < 12; i += 1) await saveSnapshot('http://a.test', snap(`s${i}`));
  const ids = (await listSnapshots('http://a.test')).map((s) => s.id);
  assert.equal(ids.length, 10);
  assert.equal(ids[0], 's11');
});

test('deleting on one origin leaves the other untouched', async () => {
  await deleteSnapshot('http://a.test', 's11');
  assert.ok(!(await listSnapshots('http://a.test')).some((s) => s.id === 's11'));
  assert.deepEqual((await listSnapshots('http://b.test')).map((s) => s.id), ['b1']);
});
