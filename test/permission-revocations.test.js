import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermissionRevocations } from '../src/background/permission-revocations.js';
const A = 'http://a.test/*', B = 'https://b.test/*', ALL = ['http://*/*', 'https://*/*'];
function setup() {
  const data = {}, calls = [];
  const storage = {
    async get(key) { return { [key]: data[key] }; },
    async set(value) { Object.assign(data, structuredClone(value)); },
    async remove(key) { delete data[key]; },
  };
  const permissions = { active: [], result: true,
    async getAll() { return { origins: this.active }; },
    async remove(arg) { calls.push(arg.origins); await this.onRemove?.(arg.origins); return this.result; },
  };
  const create = () => createPermissionRevocations({ permissions, storage });
  return { data, calls, permissions, storage, create, tracker: create() };
}

test('a broad revoke completes earlier withheld origins after a worker restart', async () => {
  const s = setup(); await s.tracker.remember([A, B]);
  s.permissions.active = ALL;
  const restarted = s.create();
  assert.deepEqual(await restarted.remove(ALL), { removed: true });
  assert.deepEqual(s.calls, [[...ALL, A, B]]);
  assert.deepEqual(s.data, {});
});

test('a narrow or single-scheme revoke never removes unrelated sites', async () => {
  const s = setup(); await s.tracker.remember([A, B, '*://both.test/*']);
  s.permissions.active = ALL;
  await s.tracker.remove(['http://*/*']);
  assert.deepEqual(s.calls[0], ['http://*/*', A]);
  await s.tracker.remove([B]);
  assert.deepEqual(s.calls[1], [B]);
  assert.deepEqual(s.data.knownOptionalOrigins, ['*://both.test/*']);
});

test('an already-withheld origin stays pending until Chrome covers it', async () => {
  const s = setup(); await s.tracker.remember([A]);
  await s.tracker.remove([A]);
  assert.deepEqual(s.data.knownOptionalOrigins, [A]);
});

test('failed browser removal retains the journal and later work still proceeds', async () => {
  const s = setup(); await s.tracker.remember([A]); s.permissions.active = ALL;
  s.permissions.remove = async () => { throw new Error('browser error'); };
  await assert.rejects(s.tracker.remove(ALL), /browser error/);
  assert.deepEqual(s.data.knownOptionalOrigins, [A]);
  s.permissions.remove = async () => false;
  assert.deepEqual(await s.tracker.remove(ALL), { removed: false });
  assert.deepEqual(s.data.knownOptionalOrigins, [A]);
});

test('own removal events do not re-add completed entries; unrelated events survive', async () => {
  const s = setup(); await s.tracker.remember([A]); s.permissions.active = ['http://*/*'];
  let later;
  s.permissions.onRemove = () => { s.tracker.remember([A]); later = s.tracker.remember([B]); };
  await s.tracker.remove(['http://*/*']); await later;
  assert.deepEqual(s.data.knownOptionalOrigins, [B]);
});

test('concurrent Chrome events are serialized, duplicates and broad patterns are ignored', async () => {
  const s = setup(); await Promise.all([s.tracker.remember([A, ...ALL]), s.tracker.remember([A, B])]);
  assert.deepEqual(s.data.knownOptionalOrigins, [A, B]);
});


test('currently active narrow origins are included even before an event is recorded', async () => {
  const s = setup(); s.permissions.active = [...ALL, A];
  await s.tracker.remove(ALL);
  assert.deepEqual(s.calls, [[...ALL, A]]);
  assert.deepEqual(s.data, {});
});

test('a grant observed before a native revoke survives events that do not name the site', async () => {
  const s = setup(); await s.tracker.remember([A, B]);
  s.permissions.active = [B]; // A broad event alone carries no record of the dormant site.
  await s.tracker.remember(ALL);
  await s.tracker.remember(ALL); s.permissions.active = ALL;
  await s.create().remove(ALL);
  assert.deepEqual(s.calls, [[...ALL, A, B]]);
});
