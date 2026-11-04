import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimeline, diffToolNames, EVENT_KINDS } from '../src/core/timeline.js';

test('events come back newest first', () => {
  const tl = createTimeline({ capacity: 10 });
  tl.push({ kind: 'registered', at: 1, toolName: 'a' });
  tl.push({ kind: 'registered', at: 2, toolName: 'b' });
  assert.deepEqual(tl.list().map((e) => e.toolName), ['b', 'a']);
});

test('every event gets an id and a kind', () => {
  const tl = createTimeline({ capacity: 5 });
  const e = tl.push({ kind: 'executed', at: 1, toolName: 'a' });
  assert.ok(e.id);
  assert.ok(EVENT_KINDS.includes(e.kind));
});

test('an unknown kind is rejected rather than stored as junk', () => {
  const tl = createTimeline({ capacity: 5 });
  assert.throws(() => tl.push({ kind: 'nonsense', at: 1 }), /unknown timeline event/);
});

// A ring buffer, so a page that fires thousands of events cannot exhaust memory (D-011).
test('the buffer is bounded and drops the oldest events', () => {
  const tl = createTimeline({ capacity: 3 });
  for (let i = 0; i < 10; i += 1) tl.push({ kind: 'registered', at: i, toolName: `t${i}` });
  const list = tl.list();
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((e) => e.toolName), ['t9', 't8', 't7']);
  assert.equal(tl.stats().dropped, 7);
});

test('the drop count is reported so the UI can say events were lost', () => {
  const tl = createTimeline({ capacity: 2 });
  tl.push({ kind: 'registered', at: 1 });
  tl.push({ kind: 'registered', at: 2 });
  assert.equal(tl.stats().dropped, 0);
  tl.push({ kind: 'registered', at: 3 });
  assert.equal(tl.stats().dropped, 1);
  assert.equal(tl.stats().total, 3);
});

test('pausing stops recording but keeps what was already captured', () => {
  const tl = createTimeline({ capacity: 10 });
  tl.push({ kind: 'registered', at: 1, toolName: 'a' });
  tl.pause();
  tl.push({ kind: 'registered', at: 2, toolName: 'b' });
  assert.deepEqual(tl.list().map((e) => e.toolName), ['a']);
  tl.resume();
  tl.push({ kind: 'registered', at: 3, toolName: 'c' });
  assert.deepEqual(tl.list().map((e) => e.toolName), ['c', 'a']);
});

test('paused events are counted so the UI can say what it missed', () => {
  const tl = createTimeline({ capacity: 10 });
  tl.pause();
  tl.push({ kind: 'registered', at: 1 });
  tl.push({ kind: 'registered', at: 2 });
  assert.equal(tl.stats().skippedWhilePaused, 2);
});

test('clear empties the buffer and its counters', () => {
  const tl = createTimeline({ capacity: 2 });
  tl.push({ kind: 'registered', at: 1 });
  tl.push({ kind: 'registered', at: 2 });
  tl.push({ kind: 'registered', at: 3 });
  tl.clear();
  assert.deepEqual(tl.list(), []);
  assert.deepEqual(tl.stats(), { total: 0, dropped: 0, skippedWhilePaused: 0, capacity: 2, paused: false });
});

// Clearing and resuming are different intents: someone who paused, then cleared, still
// wants the recorder paused. The UI must show the paused state rather than rely on this.
test('clear does not silently resume a paused timeline', () => {
  const tl = createTimeline({ capacity: 5 });
  tl.pause();
  tl.clear();
  assert.equal(tl.stats().paused, true);
  tl.push({ kind: 'registered', at: 1, toolName: 'a' });
  assert.deepEqual(tl.list(), []);
  tl.resume();
  tl.push({ kind: 'registered', at: 2, toolName: 'b' });
  assert.equal(tl.list().length, 1);
});

test('list can be filtered by kind and by tool', () => {
  const tl = createTimeline({ capacity: 10 });
  tl.push({ kind: 'registered', at: 1, toolName: 'a' });
  tl.push({ kind: 'executed', at: 2, toolName: 'a' });
  tl.push({ kind: 'executed', at: 3, toolName: 'b' });
  assert.equal(tl.list({ kinds: ['executed'] }).length, 2);
  assert.equal(tl.list({ toolName: 'a' }).length, 2);
  assert.equal(tl.list({ kinds: ['executed'], toolName: 'a' }).length, 1);
});

// toolchange only says "something changed", so registrations are derived by diffing.
test('diffToolNames turns two snapshots into added and removed', () => {
  const d = diffToolNames(['a', 'b'], ['b', 'c']);
  assert.deepEqual(d.added, ['c']);
  assert.deepEqual(d.removed, ['a']);
});

test('diffToolNames on identical snapshots yields nothing', () => {
  const d = diffToolNames(['a', 'b'], ['b', 'a']);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, []);
});

test('the first snapshot counts everything as added', () => {
  const d = diffToolNames(null, ['a', 'b']);
  assert.deepEqual(d.added, ['a', 'b']);
  assert.deepEqual(d.removed, []);
});

test('results are sorted so the rendered order is stable', () => {
  const d = diffToolNames(['z', 'y'], ['b', 'a']);
  assert.deepEqual(d.added, ['a', 'b']);
  assert.deepEqual(d.removed, ['y', 'z']);
});
