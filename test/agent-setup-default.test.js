import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, loadAgentConfig, saveAgentConfig, resetAgentConfig } from '../src/storage/agent-config.js';
import { PROVIDERS, getProvider, configProblems, endpointWarnings } from '../src/core/agent/providers.js';
import { callModel } from '../src/background/agent-transport.js';
function storage(t, config) {
  const data = { agentConfig: config, agentSessions: { keep: 'conversation' } };
  const previous = globalThis.chrome;
  globalThis.chrome = { storage: {
    local: { get: async k => ({ [k]: data[k] }), set: async v => Object.assign(data, structuredClone(v)), remove: async k => { for(const key of [k].flat())delete data[key]; } },
    session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
  } };
  t.after(() => { globalThis.chrome = previous; });
  return data;
}
test('first use and reset require an explicit provider, without blocking manual mode', async t => {
  storage(t);
  assert.equal(DEFAULT_CONFIG.providerId, '');
  assert.equal((await loadAgentConfig()).providerId, '');
  assert.deepEqual(configProblems({providerId:''}), ['missing-provider']);
  assert.deepEqual(endpointWarnings({providerId:''}), []);
  assert.deepEqual(configProblems({providerId:'manual'}), []);
  await saveAgentConfig({providerId:'ollama',model:'local'});
  await resetAgentConfig();
  assert.equal((await loadAgentConfig()).providerId, '');
});
test('retired Nano config migrates without deleting conversations or prompt preferences', async t => {
  const data = storage(t, {providerId:'chrome-on-device',model:'stale',baseUrl:'stale',promptProfileId:'my-profile',maxSteps:3});
  const migrated = await loadAgentConfig();
  assert.equal(migrated.providerId, ''); assert.equal(migrated.model, ''); assert.equal(migrated.baseUrl, '');
  assert.equal(migrated.promptProfileId, 'my-profile'); assert.equal(migrated.maxSteps, 3);
  assert.deepEqual(data.agentSessions, {keep:'conversation'});
  assert.equal((await saveAgentConfig({providerId:'chrome-on-device'})).providerId, '');
});
test('existing cloud and local choices survive upgrade', async t => {
  storage(t, {providerId:'ollama',model:'chosen',baseUrl:'http://localhost:11435/v1'});
  const saved = await loadAgentConfig();
  assert.equal(saved.providerId, 'ollama'); assert.equal(saved.model, 'chosen');
  assert.equal(saved.baseUrl,'http://localhost:11435/v1');
});
test('retired provider cannot invoke Chrome or silently select another endpoint', async t => {
  storage(t);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  assert.equal(getProvider('chrome-on-device'), null);
  assert.ok(PROVIDERS.every(p => !p.onDevice));
  const retired = await callModel({config:{providerId:'chrome-on-device'},run:{}});
  assert.equal(retired.ok,false);
  const empty = await callModel({config:{providerId:''},run:{}});
  assert.equal(empty.ok,false);
});
