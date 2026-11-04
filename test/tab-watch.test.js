import test from 'node:test';
import assert from 'node:assert/strict';
import { untilTabGone, goneOutcome } from '../src/background/tab-watch.js';

// A stand-in for chrome.tabs with the two events the watch relies on.
function fakeTabs() {
  const updated = new Set();
  const removed = new Set();
  return {
    onUpdated: { addListener: (f) => updated.add(f), removeListener: (f) => updated.delete(f) },
    onRemoved: { addListener: (f) => removed.add(f), removeListener: (f) => removed.delete(f) },
    fireUpdated: (id, change) => { for (const f of updated) f(id, change); },
    fireRemoved: (id) => { for (const f of removed) f(id); },
    listeners: () => updated.size + removed.size,
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a navigation of the watched tab settles as navigated, after the grace period', async () => {
  const tabs = fakeTabs();
  const gone = untilTabGone(7, tabs, 20);
  let settled = null;
  gone.promise.then((r) => { settled = r; });
  tabs.fireUpdated(7, { status: 'loading' });
  await wait(5);
  assert.equal(settled, null, 'the answer may still be on its way during the grace period');
  await wait(40);
  assert.equal(settled, 'navigated');
  gone.stop();
});

test('closing the watched tab settles at once as removed', async () => {
  const tabs = fakeTabs();
  const gone = untilTabGone(7, tabs, 20);
  tabs.fireRemoved(7);
  assert.equal(await gone.promise, 'removed');
  gone.stop();
});

test('other tabs and other status changes are ignored', async () => {
  const tabs = fakeTabs();
  const gone = untilTabGone(7, tabs, 5);
  let settled = null;
  gone.promise.then((r) => { settled = r; });
  tabs.fireUpdated(8, { status: 'loading' });
  tabs.fireUpdated(7, { status: 'complete' });
  tabs.fireUpdated(7, { title: 'renamed' });
  tabs.fireRemoved(8);
  await wait(20);
  assert.equal(settled, null);
  gone.stop();
});

test('stop() removes both listeners so a finished call leaves nothing behind', () => {
  const tabs = fakeTabs();
  const gone = untilTabGone(7, tabs);
  assert.equal(tabs.listeners(), 2);
  gone.stop();
  assert.equal(tabs.listeners(), 0);
});

test('the outcomes name the cause and are failures with stable codes', () => {
  assert.deepEqual(goneOutcome('removed').code, 'tab-closed');
  assert.equal(goneOutcome('navigated').code, 'navigated');
  assert.equal(goneOutcome('navigated').ok, false);
  assert.match(goneOutcome('navigated').error, /navigated away/);
  assert.match(goneOutcome('removed').error, /closed/);
});
