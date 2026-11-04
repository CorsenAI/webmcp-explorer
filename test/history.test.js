import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntry, summarize, replayability, trimHistory } from '../src/core/history.js';

const tool = {
  logicalId: 'a'.repeat(64),
  contractFp: 'b'.repeat(64),
  name: 'search_products',
  origin: 'https://shop.test',
  frameId: 0,
  description: 'Search',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  annotations: { readOnlyHint: true },
};

const outcome = { ok: true, result: '{"n":1}', durationMs: 120, roundTripMs: 130 };

test('an entry freezes the contract as it was at call time', () => {
  const e = createEntry({ tool, args: { q: 'x' }, outcome, at: 1000, id: 'e1' });
  assert.equal(e.logicalId, tool.logicalId);
  assert.equal(e.contractFp, tool.contractFp);
  assert.deepEqual(e.contractSnapshot.inputSchema, tool.inputSchema);
  assert.equal(e.contractSnapshot.description, 'Search');
});

test('mutating the tool afterwards does not change a stored entry', () => {
  const mutable = { ...tool, inputSchema: { type: 'object', properties: {} } };
  const e = createEntry({ tool: mutable, args: {}, outcome, at: 1, id: 'e' });
  mutable.inputSchema.properties.injected = { type: 'string' };
  assert.deepEqual(e.contractSnapshot.inputSchema.properties, {});
});

test('a failed call keeps its error, code and duration', () => {
  const e = createEntry({
    tool,
    args: {},
    outcome: { ok: false, code: 'tool-threw', error: 'boom', durationMs: 12, roundTripMs: 15 },
    at: 2, id: 'e2',
  });
  assert.equal(e.ok, false);
  assert.equal(e.code, 'tool-threw');
  assert.equal(e.error, 'boom');
  assert.equal(e.durationMs, 12);
});

test('summarize reports counts, success rate and percentiles per tool', () => {
  const entries = [50, 100, 150, 200, 900].map((ms, i) => createEntry({
    tool, args: {}, outcome: { ok: i !== 4, durationMs: ms, roundTripMs: ms + 5 }, at: i, id: `e${i}`,
  }));
  const [stats] = summarize(entries);
  assert.equal(stats.calls, 5);
  assert.equal(stats.failures, 1);
  assert.equal(stats.successRate, 80);
  assert.equal(stats.min, 50);
  assert.equal(stats.max, 900);
  assert.equal(stats.p50, 150);
  assert.equal(stats.p95, 900);
});

test('summarize groups by logical id, not by name', () => {
  const other = { ...tool, logicalId: 'c'.repeat(64), origin: 'https://pay.test' };
  const entries = [
    createEntry({ tool, args: {}, outcome, at: 1, id: '1' }),
    createEntry({ tool: other, args: {}, outcome, at: 2, id: '2' }),
  ];
  assert.equal(summarize(entries).length, 2);
});

test('summarize ignores calls that never produced a duration', () => {
  const entries = [
    createEntry({ tool, args: {}, outcome: { ok: false, code: 'injection-failed' }, at: 1, id: '1' }),
    createEntry({ tool, args: {}, outcome, at: 2, id: '2' }),
  ];
  const [stats] = summarize(entries);
  assert.equal(stats.calls, 2);
  assert.equal(stats.timed, 1);
  assert.equal(stats.p50, 120);
});

test('summarize of nothing is an empty list, not a crash', () => {
  assert.deepEqual(summarize([]), []);
});

// Replay must be honest about what changed since the call was recorded.
test('replay is exact when the tool and its contract are unchanged', () => {
  const e = createEntry({ tool, args: {}, outcome, at: 1, id: '1' });
  const r = replayability(e, [tool]);
  assert.equal(r.status, 'exact');
});

test('replay warns when the contract changed since the call', () => {
  const e = createEntry({ tool, args: {}, outcome, at: 1, id: '1' });
  const r = replayability(e, [{ ...tool, contractFp: 'd'.repeat(64) }]);
  assert.equal(r.status, 'contract-changed');
  assert.match(r.message, /changed/);
});

test('replay is impossible when the tool is gone, and says so plainly', () => {
  const e = createEntry({ tool, args: {}, outcome, at: 1, id: '1' });
  const r = replayability(e, []);
  assert.equal(r.status, 'gone');
  assert.equal(r.canReplay, false);
  assert.match(r.message, /no longer registered/);
});

test('a changed contract is still replayable, just flagged', () => {
  const e = createEntry({ tool, args: {}, outcome, at: 1, id: '1' });
  assert.equal(replayability(e, [{ ...tool, contractFp: 'z'.repeat(64) }]).canReplay, true);
});

// Bounded storage (D-010): a pathological page must not fill the user's profile.
test('trimHistory keeps the newest entries up to the cap', () => {
  const entries = Array.from({ length: 10 }, (_, i) => createEntry({
    tool, args: {}, outcome, at: i, id: `e${i}`,
  }));
  const kept = trimHistory(entries, { maxEntries: 4 });
  assert.equal(kept.length, 4);
  assert.deepEqual(kept.map((e) => e.at), [6, 7, 8, 9]);
});

test('trimHistory also drops entries older than the retention window', () => {
  const entries = [
    createEntry({ tool, args: {}, outcome, at: 1000, id: 'old' }),
    createEntry({ tool, args: {}, outcome, at: 9000, id: 'new' }),
  ];
  const kept = trimHistory(entries, { maxEntries: 100, maxAgeMs: 5000, now: 10000 });
  assert.deepEqual(kept.map((e) => e.id), ['new']);
});

test('trimHistory leaves a small history untouched', () => {
  const entries = [createEntry({ tool, args: {}, outcome, at: 1, id: '1' })];
  assert.equal(trimHistory(entries, { maxEntries: 100 }).length, 1);
});
