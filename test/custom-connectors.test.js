import test from 'node:test';
import assert from 'node:assert/strict';

// Chrome stand-ins: local storage is one object, session storage another — the key map lives
// where the real extension keeps it, so a delete that forgot to clear it would be caught.
const local = {};
const session = {};
const makeArea = (store) => ({
  get: async (key) => ({ [key]: structuredClone(store[key]) }),
  set: async (obj) => Object.assign(store, structuredClone(obj)),
  remove: async (key) => { delete store[key]; },
});
globalThis.chrome = {
  storage: { local: makeArea(local), session: makeArea(session) },
  runtime: { id: 'test' },
};

const {
  validateConnector, addConnector, listConnectors, listConnectorIds, deleteConnector,
  isConnectorId, connectorId, resolveProvider, clearAllConnectors, updateConnector,
} = await import('../src/storage/custom-connectors.js');
const { setKey } = await import('../src/storage/agent-config.js');
const { getProvider } = await import('../src/core/agent/providers.js');

const GOOD = {
  label: 'Office gateway',
  dialect: 'openai-chat',
  baseUrl: 'https://gateway.office.internal/v1',
  keyRequired: true,
};

test('a valid connector is stored and shows up as a provider', async () => {
  const out = await addConnector(GOOD);
  assert.ok(out.connector, JSON.stringify(out.errors));
  assert.ok(isConnectorId(out.connector.id));
  const listed = await listConnectors();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].label, 'Office gateway');
  assert.equal(listed[0].baseUrl, GOOD.baseUrl);
  assert.equal(listed[0].baseUrlEditable, false);
  assert.equal(listed[0].modelsPath, '/models');
  // A bearer dialect takes a bearer key.
  assert.equal(listed[0].auth.kind, 'bearer');
  assert.equal(listed[0].keyRequired, true);
  // The static catalogue is untouched by what lives in storage.
  assert.equal(getProvider(connectorId('anything')), null);
  assert.ok((await listConnectorIds()).has(out.connector.id));
});

test('validation refuses what the provider rules refuse', () => {
  assert.ok(!validateConnector({ ...GOOD, label: '  ' }).ok);
  assert.ok(!validateConnector({ ...GOOD, label: 'x'.repeat(80) }).ok);
  assert.ok(!validateConnector({ ...GOOD, dialect: 'none' }).ok);
  assert.ok(!validateConnector({ ...GOOD, dialect: 'on-device' }).ok);
  assert.ok(!validateConnector({ ...GOOD, baseUrl: 'not a url' }).ok);
  assert.ok(!validateConnector({ ...GOOD, baseUrl: 'ftp://host/v1' }).ok);
  const remote = validateConnector({ ...GOOD, baseUrl: 'http://gateway.office.internal/v1' });
  assert.ok(remote.errors.some((e) => /in clear/.test(e)), 'plain http to a remote host must be refused');
  // Local servers are the documented exception (D-051).
  assert.ok(validateConnector({ ...GOOD, baseUrl: 'http://localhost:8080/v1' }).ok);
});

test('an endpoint query string survives storage intact', async () => {
  // Azure-style bases carry ?api-version=; url.toString() would not be the bug, rewriting it
  // would — joinEndpoint must find the query exactly where the user typed it.
  const withQuery = { ...GOOD, label: 'Azure-ish', baseUrl: 'https://api.acme.com/v1?api-version=2026-01' };
  const out = await addConnector(withQuery);
  assert.ok(out.connector, JSON.stringify(out.errors));
  assert.equal(out.connector.baseUrl, 'https://api.acme.com/v1?api-version=2026-01');
});

test('a duplicate name is refused before writing', async () => {
  const dup = await addConnector({ ...GOOD, label: 'office GATEWAY' });
  assert.ok(dup.errors.some((e) => /already exists/i.test(e)));
  assert.equal((await listConnectors()).length, 2);
});

test('a stored connector resolves through the same resolver the transport uses', async () => {
  const [listed] = await listConnectors();
  const resolved = await resolveProvider(listed.id);
  assert.equal(resolved.label, 'Office gateway');
  assert.equal(resolved.dialect, 'openai-chat');
  assert.equal((await resolveProvider('ollama'))?.id, 'ollama');
  assert.equal(await resolveProvider('nope'), null);
});

test('deleting a connector clears its in-memory key', async () => {
  const [listed] = await listConnectors();
  await setKey(listed.id, 'sk-secret');
  const out = await deleteConnector(listed.id.replace('custom:', ''));
  assert.ok(out.deleted);
  assert.equal((await listConnectors()).length, 1);
  assert.equal(session.agentKeys[listed.id], undefined);
});

test('an update keeps the id and its key slot, and revalidates', async () => {
  const [kept] = await listConnectors();
  const bad = await updateConnector(kept.id.replace('custom:', ''), { baseUrl: 'http://remote.example/v1' });
  assert.ok(bad.errors?.length, 'a move to plain http must be refused');
  const good = await updateConnector(kept.id.replace('custom:', ''), { label: 'Renamed' });
  assert.ok(good.connector);
  assert.equal(good.connector.id, kept.id, 'the id carries the key slot; it must not change');
});

test('clearAll empties the list', async () => {
  await clearAllConnectors();
  assert.deepEqual(await listConnectors(), []);
});
