import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseRegistrations, REGISTRATION } from '../src/core/registrations.js';

const STACK = [
  'Error',
  '    at wrapped (chrome-extension://abc/content/instrument.js:60:13)',
  '    at boot (http://localhost:8777/app.js:12:5)',
  '    at http://localhost:8777/sloppy.html:40:3',
].join('\n');

const frame = (registrations, over = {}) => ({
  frameId: 0, origin: 'http://localhost:8777', instrumented: true, registrations, ...over,
});
const reg = (name, over = {}) => ({
  name, at: 1, registrations: 1, stack: STACK, emptyDescription: false,
  outcome: 'returned', error: null, promise: 'none', rejection: null, unregisteredAt: null, ...over,
});

test('a registration whose tool is exposed in the same frame is not reported', () => {
  const out = diagnoseRegistrations({
    frames: [frame([reg('search')])],
    tools: [{ name: 'search', frameId: 0 }],
  });
  assert.deepEqual(out.missing, []);
  assert.equal(out.seen, 1);
  assert.equal(out.instrumentedFrames, 1);
});

test('a frame that was not instrumented says nothing, and counts as not observed', () => {
  const out = diagnoseRegistrations({
    frames: [frame([reg('x')], { instrumented: false }), frame(null, { frameId: 5 })],
    tools: [],
  });
  assert.deepEqual(out.missing, []);
  assert.equal(out.instrumentedFrames, 0);
});

test('the four fates are told apart, and what could not be observed stays unknown', () => {
  const out = diagnoseRegistrations({
    frames: [frame([
      reg('threw', { outcome: 'threw', error: "Failed to execute 'registerTool'" }),
      reg('rejected', { promise: 'rejected', rejection: 'Description is required', emptyDescription: true }),
      reg('removed', { promise: 'pending', unregisteredAt: 2 }),
      reg('sync', { promise: 'none' }),
      reg('handled', { promise: 'pending' }),
      reg('blank', { outcome: null }),
    ])],
    tools: [],
  });
  const byName = Object.fromEntries(out.missing.map((m) => [m.name, m]));
  assert.equal(byName.threw.state, REGISTRATION.rejected);
  assert.equal(byName.threw.detail.kind, 'threw');
  assert.match(byName.threw.detail.message, /registerTool/);
  assert.equal(byName.rejected.state, REGISTRATION.rejected);
  assert.equal(byName.rejected.detail.kind, 'promise-rejected');
  assert.equal(byName.rejected.detail.message, 'Description is required');
  assert.equal(byName.rejected.emptyDescription, true, 'the descriptor fact travels with the row');
  assert.equal(byName.removed.state, REGISTRATION.removed);
  assert.equal(byName.removed.detail.kind, 'signal-aborted');
  assert.equal(byName.removed.signalAborted, true);
  assert.equal(byName.sync.state, REGISTRATION.notExposed, 'returned without a promise to watch, never listed');
  assert.equal(byName.sync.detail.kind, 'returned-not-listed');
  assert.equal(byName.handled.state, REGISTRATION.unknown, 'a promise whose fate was not seen proves nothing');
  assert.equal(byName.handled.detail.kind, 'promise-unobserved');
  assert.equal(byName.handled.promise, 'pending', 'and what could not be observed is said');
  assert.equal(byName.blank.state, REGISTRATION.unknown);
  assert.equal(byName.blank.detail.kind, 'unobserved');
  assert.equal(out.seen, 6);
});

test('a signal aborted before the registration settled is a rejection, with the abort noted beside it', () => {
  const out = diagnoseRegistrations({
    frames: [frame([reg('early', { promise: 'rejected', rejection: 'signal is aborted without reason', unregisteredAt: 2 })])],
    tools: [],
  });
  const [row] = out.missing;
  assert.equal(row.state, REGISTRATION.rejected);
  assert.equal(row.detail.kind, 'promise-rejected');
  assert.equal(row.signalAborted, true);
});

test('the source is read from the captured stack, skipping the wrapper frame', () => {
  const out = diagnoseRegistrations({ frames: [frame([reg('ghost')])], tools: [] });
  const [row] = out.missing;
  assert.equal(row.source.known, true);
  assert.match(row.source.file, /app\.js$/);
  assert.equal(row.source.line, 12);
  assert.equal(row.source.function, 'boot');
});

test('the same name exposed in another frame does not clear a frame where it is missing', () => {
  const out = diagnoseRegistrations({
    frames: [frame([reg('twin')]), frame([reg('twin')], { frameId: 7 })],
    tools: [{ name: 'twin', frameId: 7 }],
  });
  assert.equal(out.missing.length, 1);
  assert.equal(out.missing[0].frameId, 0);
});

test('rows come out sorted by name then frame, whatever the input order', () => {
  const out = diagnoseRegistrations({
    frames: [frame([reg('b'), reg('a')], { frameId: 3 }), frame([reg('a')])],
    tools: [],
  });
  assert.deepEqual(out.missing.map((m) => `${m.name}@${m.frameId}`), ['a@0', 'a@3', 'b@3']);
});
