import test from 'node:test';
import assert from 'node:assert/strict';

// live.js reaches for chrome.runtime only to send the notice; a stub is enough to watch it.
const sent = [];
globalThis.chrome = {
  runtime: {
    sendMessage: (msg) => {
      sent.push(msg);
      return Promise.resolve();
    },
  },
};
const { recordLiveEvent, recordExecution, forgetTab } = await import('../src/background/live.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ORIGIN = 'http://a.test';

test('a burst of events on one tab produces a single live-changed notice', async () => {
  sent.length = 0;
  forgetTab(41);
  // The first snapshot is the baseline and records nothing.
  recordLiveEvent(41, 0, { kind: 'snapshot', names: [], origin: ORIGIN });
  assert.equal(sent.length, 0);

  recordLiveEvent(41, 0, { kind: 'snapshot', names: ['one', 'two'], origin: ORIGIN });
  recordLiveEvent(41, 0, { kind: 'snapshot', names: ['one'], origin: ORIGIN });
  recordLiveEvent(41, 0, { kind: 'activated', toolName: 'one', origin: ORIGIN });
  assert.equal(sent.length, 0, 'the notice is debounced, not sent per event');

  await wait(150);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'live-changed');
  assert.equal(sent[0].tabId, 41);
  // The burst's kinds ride along, merged, so the Tools list can tell a registration from a call.
  assert.deepEqual([...sent[0].kinds].sort(), ['activated', 'registered', 'unregistered']);
});

test('an execution notifies, and each tab is notified on its own', async () => {
  sent.length = 0;
  forgetTab(51);
  forgetTab(52);
  recordExecution(51, { ok: true, toolName: 'x', origin: ORIGIN, frameId: 0, durationMs: 3 });
  recordExecution(52, { ok: false, toolName: 'y', origin: ORIGIN, frameId: 0, error: 'boom' });
  await wait(150);
  assert.deepEqual(sent.map((m) => m.tabId).sort(), [51, 52]);
  assert.ok(sent.every((m) => m.type === 'live-changed'));
});

test('a snapshot that changes nothing sends no notice', async () => {
  sent.length = 0;
  forgetTab(61);
  recordLiveEvent(61, 0, { kind: 'snapshot', names: ['a'], origin: ORIGIN });
  recordLiveEvent(61, 0, { kind: 'snapshot', names: ['a'], origin: ORIGIN });
  await wait(150);
  assert.equal(sent.length, 0);
});
