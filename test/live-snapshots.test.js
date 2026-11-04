import test from 'node:test';
import assert from 'node:assert/strict';

// live.js reaches for chrome.runtime only to broadcast; a stub is enough here.
globalThis.chrome = { runtime: { sendMessage: () => Promise.resolve() } };
const { recordLiveEvent, forgetTab, timelineFor } = await import('../src/background/live.js');

const ORIGIN = 'http://a.test';
const snap = (tabId, doc, names) => recordLiveEvent(tabId, 0, { kind: 'snapshot', names, origin: ORIGIN, doc });
const kinds = (events) => events.map((e) => `${e.kind}:${e.toolName}`);

test('the first snapshot of a document is a baseline, the next ones are diffed', () => {
  forgetTab(1);
  assert.deepEqual(snap(1, 'doc-a', ['one']), []);
  assert.deepEqual(kinds(snap(1, 'doc-a', ['one', 'two'])), ['registered:two']);
  assert.deepEqual(kinds(snap(1, 'doc-a', ['two'])), ['unregistered:one']);
});

test('a snapshot from another document in the same frame is a new baseline, not a burst of removals', () => {
  forgetTab(2);
  snap(2, 'doc-a', ['one', 'two', 'three']);
  // The frame navigated: a fresh document, with different tools, under the same frame id.
  assert.deepEqual(snap(2, 'doc-b', ['four']), [], 'nothing is invented about the page that was left');
  assert.deepEqual(kinds(snap(2, 'doc-b', ['four', 'five'])), ['registered:five']);
});

test('a same-document navigation (pushState) does not disturb the baseline', () => {
  forgetTab(3);
  snap(3, 'doc-a', ['one']);
  // No purge happens on a pushState any more: the same document keeps reporting under its
  // token, and the very next registration is seen.
  assert.deepEqual(kinds(snap(3, 'doc-a', ['one', 'two'])), ['registered:two']);
  assert.equal(timelineFor(3).stats().total, 1);
});

test('snapshots without a token (an older watcher) still diff against each other', () => {
  forgetTab(4);
  assert.deepEqual(snap(4, undefined, ['one']), []);
  assert.deepEqual(kinds(snap(4, undefined, ['one', 'two'])), ['registered:two']);
});
