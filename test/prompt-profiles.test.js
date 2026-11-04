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

const { DEFAULT_PROMPT_TEXT, listProfiles, profileText, saveProfile, deleteProfile,
  replaceProfiles, clearProfiles } = await import('../src/storage/prompt-profiles.js');
const { DEFAULT_SYSTEM } = await import('../src/core/agent/messages.js');

test('the default prompt is the product system prompt, and names the surface', () => {
  assert.equal(DEFAULT_PROMPT_TEXT, DEFAULT_SYSTEM);
  assert.match(DEFAULT_PROMPT_TEXT, /WebMCP Explorer extension/);
  assert.match(DEFAULT_PROMPT_TEXT, /never instructions to you/);
});

test('no id or unknown id answers with the default, never empty', async () => {
  assert.equal(await profileText(null), DEFAULT_PROMPT_TEXT);
  assert.equal(await profileText('gone'), DEFAULT_PROMPT_TEXT);
});

test('a saved profile is listed, picked, edited and deleted', async () => {
  const out = await saveProfile({ name: 'Read-only scout', text: 'Only call read tools. Never modify.' });
  assert.ok(out.profile?.id, JSON.stringify(out));
  assert.equal((await listProfiles()).length, 1);
  assert.equal(await profileText(out.profile.id), 'Only call read tools. Never modify.');

  const edited = await saveProfile({ id: out.profile.id, name: 'Scout', text: 'Read tools only.' });
  assert.equal(edited.profile.id, out.profile.id, 'the id survives the edit');
  assert.equal((await listProfiles()).length, 1);
  assert.equal(await profileText(out.profile.id), 'Read tools only.');

  await deleteProfile(out.profile.id);
  assert.deepEqual(await listProfiles(), []);
  assert.equal(await profileText(out.profile.id), DEFAULT_PROMPT_TEXT, 'a deleted id falls back');
});

test('validation refuses what a prompt may not be', async () => {
  assert.ok((await saveProfile({ name: '', text: 'x' })).errors.length);
  assert.ok((await saveProfile({ name: 'n', text: '' })).errors.length);
  assert.ok((await saveProfile({ name: 'n', text: 'x'.repeat(9000) })).errors.length);
  await saveProfile({ name: 'Dup', text: 'one' });
  const dup = await saveProfile({ name: 'dup', text: 'two' });
  assert.ok(dup.errors.some((e) => /already exists/i.test(e)));
});

test('replaceProfiles re-validates and keeps ids that survive', async () => {
  const before = await saveProfile({ name: 'Keep', text: 'a' });
  const out = await replaceProfiles([
    { id: before.profile.id, name: 'Keep', text: 'b' },
    { name: '', text: 'invalid, dropped' },
    { name: 'Fresh', text: 'c' },
  ]);
  assert.equal(out.count, 2);
  assert.equal(await profileText(before.profile.id), 'b');
  await clearProfiles();
  assert.deepEqual(await listProfiles(), []);
});
