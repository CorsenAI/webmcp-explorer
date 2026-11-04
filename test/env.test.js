import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_SURFACE, classifyEnvironment } from '../src/core/env.js';

const full = REQUIRED_SURFACE.slice();

test('required surface is the four documented methods', () => {
  assert.deepEqual(full, ['registerTool', 'getTools', 'executeTool', 'addEventListener']);
});

test('no api and no polyfill is unavailable', () => {
  const r = classifyEnvironment({ apiHost: null, methods: [], polyfillActive: false });
  assert.equal(r.state, 'unavailable');
});

test('classifyEnvironment tolerates being called with nothing', () => {
  assert.equal(classifyEnvironment().state, 'unavailable');
});

test('polyfill without native api is compat-polyfill', () => {
  const r = classifyEnvironment({ apiHost: 'document', methods: full, polyfillActive: true });
  assert.equal(r.state, 'compat-polyfill');
});

test('native api with full surface is native', () => {
  const r = classifyEnvironment({ apiHost: 'document', methods: full, polyfillActive: false });
  assert.equal(r.state, 'native');
});

test('origin trial token takes precedence over the dev flag', () => {
  const r = classifyEnvironment({
    apiHost: 'document', methods: full, polyfillActive: false,
    originTrialToken: true, devFlag: true,
  });
  assert.equal(r.state, 'origin-trial');
});

test('dev flag without token is testing-flag', () => {
  const r = classifyEnvironment({
    apiHost: 'document', methods: full, polyfillActive: false, devFlag: true,
  });
  assert.equal(r.state, 'testing-flag');
});

test('missing method is api-mismatch and names what is missing', () => {
  const r = classifyEnvironment({
    apiHost: 'document', methods: ['registerTool', 'getTools'], polyfillActive: false,
  });
  assert.equal(r.state, 'api-mismatch');
  assert.deepEqual(r.missing, ['executeTool', 'addEventListener']);
});

test('api-mismatch wins over an origin trial token', () => {
  const r = classifyEnvironment({
    apiHost: 'document', methods: ['registerTool'], originTrialToken: true,
  });
  assert.equal(r.state, 'api-mismatch');
});

test('legacy navigator host is reported but still classified', () => {
  const r = classifyEnvironment({ apiHost: 'navigator', methods: full, polyfillActive: false });
  assert.equal(r.state, 'native');
  assert.equal(r.legacyHost, true);
});

test('document host is not flagged as legacy', () => {
  const r = classifyEnvironment({ apiHost: 'document', methods: full, polyfillActive: false });
  assert.equal(r.legacyHost, false);
});
