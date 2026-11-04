import test from 'node:test';
import assert from 'node:assert/strict';

const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => ({ [key]: structuredClone(store[key]) }),
      set: async (obj) => Object.assign(store, structuredClone(obj)),
      remove: async (key) => { delete store[key]; },
    },
  },
};

const { isGranted, grantOrigin, revokeOrigin, listGrants, clearAllGrants } =
  await import('../src/storage/external-access.js');

test('nothing is granted until the user says so', async () => {
  assert.equal(await isGranted('https://corsen.ai'), false);
  assert.deepEqual(await listGrants(), []);
});

test('a grant survives reads, and a revoke erases it', async () => {
  await grantOrigin('https://corsen.ai');
  assert.equal(await isGranted('https://corsen.ai'), true);
  assert.equal((await listGrants()).length, 1);
  await revokeOrigin('https://corsen.ai');
  assert.equal(await isGranted('https://corsen.ai'), false);
});

test('clearAll closes every grant', async () => {
  await grantOrigin('https://a.test');
  await grantOrigin('https://b.test');
  assert.equal((await listGrants()).length, 2);
  await clearAllGrants();
  assert.deepEqual(await listGrants(), []);
});
