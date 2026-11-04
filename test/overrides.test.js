import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOverride, applyOverrides, resolveCall, consumeOnce, MOCK_MODES,
} from '../src/core/overrides.js';

const tool = {
  logicalId: 'a'.repeat(64),
  name: 'search_products',
  origin: 'https://shop.test',
  frameId: 0,
  description: 'Search the catalogue',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  annotations: { readOnlyHint: true },
};

test('a new override changes nothing until it is configured', () => {
  const o = createOverride(tool.logicalId);
  const [applied] = applyOverrides([tool], [o]);
  assert.equal(applied.description, tool.description);
  assert.equal(applied.overridden, false);
});

test('the supported mock modes are explicit', () => {
  assert.deepEqual(MOCK_MODES, ['off', 'success', 'empty', 'error', 'timeout', 'malformed']);
});

test('an overridden description replaces the original and keeps it visible', () => {
  const o = { ...createOverride(tool.logicalId), description: 'Search by keyword and price' };
  const [applied] = applyOverrides([tool], [o]);
  assert.equal(applied.description, 'Search by keyword and price');
  assert.equal(applied.originalDescription, 'Search the catalogue');
  assert.equal(applied.overridden, true);
});

test('an overridden schema replaces the original and keeps it visible', () => {
  const schema = { type: 'object', properties: { q: { type: 'string' }, max: { type: 'number' } } };
  const o = { ...createOverride(tool.logicalId), inputSchema: schema };
  const [applied] = applyOverrides([tool], [o]);
  assert.deepEqual(applied.inputSchema, schema);
  assert.deepEqual(applied.originalInputSchema, tool.inputSchema);
});

// Disabling must not delete the tool from the list: the developer has to see what they hid.
test('a disabled tool stays listed but is flagged', () => {
  const o = { ...createOverride(tool.logicalId), disabled: true };
  const [applied] = applyOverrides([tool], [o]);
  assert.equal(applied.disabled, true);
  assert.equal(applied.overridden, true);
});

test('an override is ignored when it is switched off', () => {
  const o = { ...createOverride(tool.logicalId), enabled: false, description: 'nope' };
  const [applied] = applyOverrides([tool], [o]);
  assert.equal(applied.description, tool.description);
  assert.equal(applied.overridden, false);
});

test('an override for another tool does not leak', () => {
  const o = { ...createOverride('b'.repeat(64)), description: 'other' };
  const [applied] = applyOverrides([tool], [o]);
  assert.equal(applied.description, tool.description);
});

test('with no mock the call passes through to the real tool', () => {
  const r = resolveCall(createOverride(tool.logicalId));
  assert.equal(r.kind, 'passthrough');
});

test('a disabled tool refuses the call rather than silently passing through', () => {
  const r = resolveCall({ ...createOverride(tool.logicalId), disabled: true });
  assert.equal(r.kind, 'blocked');
  assert.match(r.outcome.error, /disabled/i);
});

test('mock success returns the configured payload without touching the page', () => {
  const o = {
    ...createOverride(tool.logicalId),
    mock: { mode: 'success', result: '{"products":[]}', latencyMs: 0, once: false },
  };
  const r = resolveCall(o);
  assert.equal(r.kind, 'mock');
  assert.equal(r.outcome.ok, true);
  assert.equal(r.outcome.result, '{"products":[]}');
  assert.equal(r.outcome.mocked, true);
});

test('mock empty returns an empty string, not null', () => {
  const r = resolveCall({
    ...createOverride(tool.logicalId),
    mock: { mode: 'empty', latencyMs: 0, once: false },
  });
  assert.equal(r.outcome.ok, true);
  assert.equal(r.outcome.result, '');
});

test('mock error fails with the configured message', () => {
  const r = resolveCall({
    ...createOverride(tool.logicalId),
    mock: { mode: 'error', error: 'Upstream is down', latencyMs: 0, once: false },
  });
  assert.equal(r.outcome.ok, false);
  assert.equal(r.outcome.code, 'mocked-error');
  assert.equal(r.outcome.error, 'Upstream is down');
});

test('mock timeout reports a timeout and carries its latency', () => {
  const r = resolveCall({
    ...createOverride(tool.logicalId),
    mock: { mode: 'timeout', latencyMs: 5000, once: false },
  });
  assert.equal(r.outcome.ok, false);
  assert.equal(r.outcome.code, 'mocked-timeout');
  assert.equal(r.latencyMs, 5000);
});

test('mock malformed returns something that is deliberately not valid JSON', () => {
  const r = resolveCall({
    ...createOverride(tool.logicalId),
    mock: { mode: 'malformed', latencyMs: 0, once: false },
  });
  assert.equal(r.outcome.ok, true);
  assert.throws(() => JSON.parse(r.outcome.result));
});

test('artificial latency is reported so the runner can wait for it', () => {
  const r = resolveCall({
    ...createOverride(tool.logicalId),
    mock: { mode: 'success', result: 'x', latencyMs: 750, once: false },
  });
  assert.equal(r.latencyMs, 750);
});

test('a once mock applies a single time and then gets out of the way', () => {
  let o = {
    ...createOverride(tool.logicalId),
    mock: { mode: 'error', error: 'flaky', latencyMs: 0, once: true },
  };
  assert.equal(resolveCall(o).kind, 'mock');
  o = consumeOnce(o);
  assert.equal(resolveCall(o).kind, 'passthrough');
});

test('consumeOnce leaves an always mock untouched', () => {
  const o = {
    ...createOverride(tool.logicalId),
    mock: { mode: 'error', error: 'always', latencyMs: 0, once: false },
  };
  assert.equal(consumeOnce(o).mock.spent, undefined);
  assert.equal(resolveCall(consumeOnce(o)).kind, 'mock');
});

test('mode off means passthrough even with a payload configured', () => {
  const r = resolveCall({
    ...createOverride(tool.logicalId),
    mock: { mode: 'off', result: 'ignored', latencyMs: 0, once: false },
  });
  assert.equal(r.kind, 'passthrough');
});

test('an unknown mock mode is refused rather than guessed at', () => {
  assert.throws(() => resolveCall({
    ...createOverride(tool.logicalId),
    mock: { mode: 'sideways', latencyMs: 0, once: false },
  }), /unknown mock mode/);
});
