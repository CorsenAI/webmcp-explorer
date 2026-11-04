import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineReport } from '../src/core/export/report.js';

const AT = Date.parse('2026-09-10T12:00:00.000Z');
const events = [
  { id: 'ev_3', kind: 'executed', at: AT + 2000, toolName: 'search', origin: 'http://a.test', frameId: 0, durationMs: 42 },
  { id: 'ev_1', kind: 'registered', at: AT, toolName: 'search', origin: 'http://a.test', frameId: 0 },
  { id: 'ev_2', kind: 'failed', at: AT + 1000, toolName: 'pay', origin: 'http://a.test', frameId: 5, code: 'tool-threw', error: 'card | declined' },
  { id: 'ev_4', kind: 'cancelled', at: AT + 3000, toolName: 'slow', origin: 'http://a.test', frameId: 0, durationMs: 250 },
];

test('the record lists events oldest first with the fields a log needs', () => {
  const out = timelineReport(events, { origin: 'http://a.test', stats: { total: 9, dropped: 5, skippedWhilePaused: 0 }, at: AT + 5000 });
  assert.equal(out.json.kind, 'webmcp-explorer/timeline');
  assert.deepEqual(out.json.events.map((e) => e.kind), ['registered', 'failed', 'executed', 'cancelled']);
  assert.equal(out.json.events[2].durationMs, 42);
  assert.equal(out.json.events[1].error, 'card | declined');
  assert.equal(out.json.recorded, 9);
  assert.equal(out.json.dropped, 5);
  assert.equal(out.json.sampled, true);
  assert.match(out.filename, /^webmcp-timeline_http-a-test_2026-09-10/);
});

test('the markdown says it is sampled, reports drops, escapes pipes and reads as a table', () => {
  const out = timelineReport(events, { origin: 'http://a.test', stats: { total: 9, dropped: 5, skippedWhilePaused: 2 }, at: AT });
  assert.match(out.markdown, /^# WebMCP timeline on http:\/\/a\.test/);
  assert.match(out.markdown, /Sampled, not intercepted/);
  assert.match(out.markdown, /5 older events dropped/);
  assert.match(out.markdown, /2 events missed while recording was paused/);
  assert.match(out.markdown, /\| failed \| `pay` \| 5 \| — \| card \\\| declined \|/);
  assert.match(out.markdown, /\| cancelled \| `slow` \| 0 \| 250 ms \| — \|/);
});

test('an empty timeline still produces a valid, honest report', () => {
  const out = timelineReport([], { origin: null, at: AT });
  assert.equal(out.json.events.length, 0);
  assert.match(out.markdown, /0 events shown, 0 recorded/);
  assert.match(out.filename, /^webmcp-timeline_page_/);
});
