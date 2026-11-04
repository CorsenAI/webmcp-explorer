import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = { runtime: { getManifest: () => ({}) } };

const { AGENT_ORIGINS, agentPatterns, isAllowedAgentOrigin, validateExternalRequest, EXTERNAL_API } =
  await import('../src/core/external/api.js');

test('the allowed list is exact hosts; patterns derive from it without doubling', () => {
  assert.deepEqual(agentPatterns(['https://a.test']), ['https://a.test/*']);
  assert.deepEqual(agentPatterns(['http://localhost:8777/*']), ['http://localhost:8777/*']);
  assert.ok(AGENT_ORIGINS.every((o) => /^https:\/\/[^*]+$/.test(o)), 'no wildcards in the allow-list');
});

test('the sender host must be one of the declared hosts exactly', () => {
  assert.ok(isAllowedAgentOrigin('https://corsen.ai/tools'));
  assert.ok(!isAllowedAgentOrigin('https://other.test'));
  assert.ok(!isAllowedAgentOrigin('https://corsen.ai.evil.test')); // suffix tricks
  assert.ok(!isAllowedAgentOrigin('https://sub.corsen.ai')); // subdomains are not hosts
  assert.ok(!isAllowedAgentOrigin('http://corsen.ai')); // the scheme is not negotiable
  assert.ok(!isAllowedAgentOrigin('not a url'));
});

test('a well-formed request passes validation', () => {
  assert.deepEqual(validateExternalRequest({ api: EXTERNAL_API, command: 'ping' }),
    { ok: true, request: { command: 'ping' } });
  assert.deepEqual(validateExternalRequest({ api: EXTERNAL_API, command: 'list-tools' }),
    { ok: true, request: { command: 'list-tools' } });
  assert.ok(validateExternalRequest({
    api: EXTERNAL_API, command: 'execute-tool', tool: 'search', args: { q: 'x' },
  }).ok);
});

test('anything off-schema is refused with a field-naming error', () => {
  assert.match(validateExternalRequest('not an object').error, /object/);
  assert.match(validateExternalRequest({}).error, /wmp-explorer\/1/);
  assert.match(validateExternalRequest({ api: 'other/9', command: 'ping' }).error, /wmp-explorer\/1/);
  assert.match(validateExternalRequest({ api: EXTERNAL_API }).error, /command/);
  assert.match(validateExternalRequest({ api: EXTERNAL_API, command: 'nope' }).error, /Unknown command/);
  assert.match(validateExternalRequest({ api: EXTERNAL_API, command: 'execute-tool', tool: 't' }).error, /args/);
  assert.match(validateExternalRequest({ api: EXTERNAL_API, command: 'execute-tool', tool: 't', args: [] }).error, /args/);
  // No undeclared extras — a request cannot smuggle a tabId through.
  assert.match(validateExternalRequest({ api: EXTERNAL_API, command: 'ping', tabId: 3 }).error, /no other fields/);
  assert.match(validateExternalRequest({
    api: EXTERNAL_API, command: 'execute-tool', tool: 't', args: {}, tabId: 3,
  }).error, /execute-tool does not accept: tabId/);
});
