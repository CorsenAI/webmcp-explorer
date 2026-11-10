import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { changedParts, isToolDigest, EVENT_KINDS } from '../src/core/timeline.js';
import { reviewLifecycle } from '../src/core/security/lifecycle.js';
import { reviewSecurity } from '../src/core/security/review.js';
import { CATALOG, localeKey } from '../src/core/security/catalog.js';
import { makeBaseline, diffBaseline, ENGINE_VERSION, ENGINE_V4_CODES } from '../src/core/security/baseline.js';
import { timelineReport } from '../src/core/export/report.js';

// live.js and the relay reach for chrome.runtime only to broadcast; a stub is enough here.
const sent = [];
globalThis.chrome = { runtime: { sendMessage: (message) => { sent.push(message); return Promise.resolve(); } } };
const { recordLiveEvent, forgetTab } = await import('../src/background/live.js');
const { relayInPage } = await import('../src/content/relay.js');

// One tool fingerprint as the watcher posts it: description, schema, annotations.
const fp = (d, s = '1', a = '2') => [d, s, a].map((digit) => digit.repeat(64)).join('.');
const ORIGIN = 'http://a.test';
let next = 0;
const snap = (tabId, tools, { doc = 'doc-a', seq = (next += 1) } = {}) => recordLiveEvent(tabId, 0, { kind: 'snapshot', doc, origin: ORIGIN, seq,
  names: tools.map(([name]) => name), digests: tools.map(([, digest]) => digest ?? null) });
const brief = (events) => events.map((e) => [e.kind, e.toolName, e.contract ?? null, e.parts ?? null]);

test('two fingerprints of one name: the parts that differ, an empty list when equal, null when either is unknown', () => {
  assert.deepEqual(changedParts(fp('a'), fp('b')), ['description']);
  assert.deepEqual(changedParts(fp('a', '1', '2'), fp('a', '3', '4')), ['schema', 'annotations']);
  assert.deepEqual(changedParts(fp('a'), fp('a')), []);
  assert.equal(changedParts(null, fp('a')), null);
  assert.equal(changedParts(fp('a'), 'a'.repeat(64)), null);
  assert.equal(isToolDigest(`${fp('a')}.`), false);
  assert.equal(isToolDigest(fp('A')), false, 'upper-case is not the watcher\'s form');
  assert.ok(EVENT_KINDS.includes('changed'));
});

test('a tool replaced under its own name is a "changed" event that names the parts; an untouched tool is silent', () => {
  forgetTab(11);
  assert.deepEqual(snap(11, [['get_quote', fp('a')], ['get_rates', fp('c')]]), []);
  assert.deepEqual(brief(snap(11, [['get_quote', fp('b')], ['get_rates', fp('c')]])), [['changed', 'get_quote', null, ['description']]]);
  assert.deepEqual(snap(11, [['get_quote', fp('b')], ['get_rates', fp('c')]]), [], 'the same state again reports nothing');
  assert.deepEqual(brief(snap(11, [['get_quote', fp('b', '5', '6')], ['get_rates', fp('c')]])), [['changed', 'get_quote', null, ['schema', 'annotations']]]);
});

test('a name that comes back says whether it is the contract that left', () => {
  forgetTab(12);
  snap(12, [['get_status', fp('a')], ['get_rates', fp('c')]]);
  assert.deepEqual(brief(snap(12, [])), [['unregistered', 'get_rates', null, null], ['unregistered', 'get_status', null, null]]);
  assert.deepEqual(brief(snap(12, [['get_status', fp('a')], ['get_rates', fp('c', '9')]])),
    [['registered', 'get_rates', 'changed', ['schema']], ['registered', 'get_status', 'same', []]]);
  // A name seen for the first time has nothing to be compared with.
  assert.deepEqual(brief(snap(12, [['get_status', fp('a')], ['get_rates', fp('c', '9')], ['get_new', fp('d')]])), [['registered', 'get_new', null, null]]);
});

test('without a fingerprint on either side the comparison is unknown, never "same"', () => {
  forgetTab(13);
  snap(13, [['one', null], ['two', fp('a')]]);
  assert.deepEqual(snap(13, [['one', fp('b')], ['two', fp('a')]]), [], 'unknown before: no change is claimed');
  snap(13, [['two', fp('a')]]);
  assert.deepEqual(brief(snap(13, [['one', fp('b')], ['two', fp('a')]])), [['registered', 'one', 'same', []]]);
  snap(13, []);
  assert.deepEqual(brief(snap(13, [['one', null], ['two', 'not-a-fingerprint']])), [['registered', 'one', null, null], ['registered', 'two', null, null]]);
  // A watcher that posts names only still gives registrations and removals.
  forgetTab(14);
  recordLiveEvent(14, 0, { kind: 'snapshot', doc: 'doc-a', origin: ORIGIN, names: ['one'] });
  assert.deepEqual(brief(recordLiveEvent(14, 0, { kind: 'snapshot', doc: 'doc-a', origin: ORIGIN, names: ['one', 'two'] })), [['registered', 'two', null, null]]);
  // A digest list that does not match the names is ignored as a whole.
  assert.deepEqual(brief(recordLiveEvent(14, 0, { kind: 'snapshot', doc: 'doc-a', origin: ORIGIN, names: ['one', 'two', 'three'], digests: [fp('a')] })), [['registered', 'three', null, null]]);
});

test('a snapshot that arrives after a newer one of the same document is dropped; another document starts again', () => {
  forgetTab(15);
  snap(15, [['one', fp('a')]], { seq: 500 });
  assert.deepEqual(brief(snap(15, [['one', fp('b')]], { seq: 700 })), [['changed', 'one', null, ['description']]]);
  assert.deepEqual(snap(15, [['one', fp('a')]], { seq: 600 }), [], 'the overtaken baseline is not diffed backwards');
  assert.deepEqual(snap(15, [['one', fp('b')]], { seq: 700 }), [], 'nor is a repeat');
  assert.deepEqual(brief(snap(15, [['one', fp('c')]], { seq: 701 })), [['changed', 'one', null, ['description']]]);
  // The frame navigated: its first snapshot is a baseline whatever its number, and what left the
  // previous document is not compared with it.
  assert.deepEqual(snap(15, [['two', fp('a')]], { doc: 'doc-b', seq: 3 }), []);
  snap(15, [], { doc: 'doc-b', seq: 4 });
  assert.deepEqual(brief(snap(15, [['one', fp('z')]], { doc: 'doc-b', seq: 5 })), [['registered', 'one', null, null]]);
});

test('the memory of names that left a document is bounded', () => {
  forgetTab(16);
  const many = Array.from({ length: 600 }, (_, i) => [`tool_${String(i).padStart(3, '0')}`, fp('a')]);
  snap(16, many);
  snap(16, []);
  const back = snap(16, [many[0], many[599]]);
  assert.deepEqual(brief(back), [['registered', 'tool_000', null, null], ['registered', 'tool_599', 'same', []]]);
});

test('the relay forwards fingerprints and the sequence number only in their expected form', () => {
  const listeners = {};
  globalThis.window = { addEventListener: (type, handler) => { listeners[type] = handler; }, removeEventListener() {} };
  relayInPage('channel-r');
  const port = { start() {}, close() {} };
  listeners.message({ source: globalThis.window, data: { __webmcpExplorerPort: 'channel-r' }, ports: [port] });
  const forward = (data) => { sent.length = 0; port.onmessage({ data }); return sent[0]?.payload ?? null; };
  const ok = forward({ kind: 'snapshot', names: ['one', 'two'], digests: [fp('a'), null], seq: 12 });
  assert.deepEqual([ok.names, ok.digests, ok.seq], [['one', 'two'], [fp('a'), null], 12]);
  const short = forward({ kind: 'snapshot', names: ['one', 'two'], digests: [fp('a')], seq: -1 });
  assert.deepEqual([short.names, 'digests' in short, 'seq' in short], [['one', 'two'], false, false]);
  const long = forward({ kind: 'snapshot', names: ['one'], digests: ['x'.repeat(5000)], seq: 1.5 });
  assert.deepEqual(['digests' in long, 'seq' in long], [false, false]);
  delete globalThis.window;
});

const tool = (over = {}) => ({ name: 'get_quote', description: 'Get a quote for one product.', inputSchema: { type: 'object', additionalProperties: false, properties: { sku: { type: 'string', maxLength: 20 } } },
  annotations: { readOnlyHint: true }, origin: ORIGIN, frameId: 0, instanceId: 'q@0', logicalId: 'q', contractFp: 'fp-q', ...over });
const codes = (list) => list.map((f) => f.code).sort();

test('another contract under the same name is a finding that names the parts; the same contract is none', () => {
  const replaced = reviewLifecycle([tool()], [{ kind: 'changed', toolName: 'get_quote', at: 5, frameId: 0, parts: ['description'] }]);
  assert.deepEqual(codes(replaced), ['contract-changed-in-session']);
  assert.deepEqual([replaced[0].severity, replaced[0].nature, replaced[0].axis], ['medium', 'observed', 'lifecycle']);
  assert.equal(replaced[0].evidence.excerpt, '1 contract change under this name while it was observed: description');
  assert.deepEqual(replaced[0].detail, { changes: 1, parts: ['description'], registered: 0, unregistered: 0 });

  const cameBack = [{ kind: 'unregistered', toolName: 'get_quote', at: 1, frameId: 0 }, { kind: 'registered', toolName: 'get_quote', at: 2, frameId: 0, contract: 'changed', parts: ['schema', 'annotations', 'made-up'] },
    { kind: 'changed', toolName: 'get_quote', at: 3, frameId: 0, parts: ['description'] }];
  const twice = reviewLifecycle([tool()], cameBack);
  assert.deepEqual(codes(twice), ['contract-changed-in-session']);
  assert.equal(twice[0].evidence.excerpt, '2 contract changes under this name while it was observed: description, input schema, annotations');
  assert.deepEqual(twice[0].detail.parts, ['description', 'schema', 'annotations']);

  const remounted = [{ kind: 'unregistered', toolName: 'get_quote', at: 1 }, { kind: 'registered', toolName: 'get_quote', at: 2, contract: 'same', parts: [] }];
  assert.deepEqual(reviewLifecycle([tool()], remounted), [], 'a re-mount proven identical is not a finding');
});

test('a name that came back without a comparison keeps the earlier indicator', () => {
  const events = [{ kind: 'unregistered', toolName: 'get_quote', at: 1 }, { kind: 'registered', toolName: 'get_quote', at: 2 }];
  const found = reviewLifecycle([tool()], events);
  assert.deepEqual(codes(found), ['re-registered-in-session']);
  assert.equal(found[0].nature, 'indicator');
  // One compared re-mount and one that could not be compared: the indicator stays.
  const mixed = [...events, { kind: 'unregistered', toolName: 'get_quote', at: 3 }, { kind: 'registered', toolName: 'get_quote', at: 4, contract: 'same', parts: [] }];
  assert.deepEqual(codes(reviewLifecycle([tool()], mixed)), ['re-registered-in-session']);
  // Events of the same millisecond are read in the timeline's own order, newest first in the list.
  const sameInstant = [{ id: 'ev_8', kind: 'registered', toolName: 'get_quote', at: 9 }, { id: 'ev_7', kind: 'unregistered', toolName: 'get_quote', at: 9 }];
  assert.deepEqual(codes(reviewLifecycle([tool()], sameInstant)), ['re-registered-in-session']);
});

test('events of one frame are not charged to a tool of the same name in another frame', () => {
  const top = tool();
  const framed = tool({ frameId: 7, instanceId: 'q@7' });
  const found = reviewLifecycle([top, framed], [{ kind: 'changed', toolName: 'get_quote', at: 1, frameId: 7, parts: ['description'] }]);
  assert.deepEqual(found.map((f) => [f.code, f.instanceId]), [['contract-changed-in-session', 'q@7']]);
  // An observer that does not number frames (the scanner) matches by name.
  const unframed = reviewLifecycle([tool({ frameId: undefined })], [{ kind: 'changed', toolName: 'get_quote', at: 1, parts: ['annotations'] }]);
  assert.deepEqual(codes(unframed), ['contract-changed-in-session']);
  assert.deepEqual(codes(reviewLifecycle([top], [{ kind: 'changed', toolName: 'get_quote', at: 1, parts: ['annotations'] }])), ['contract-changed-in-session']);
});

test('the finding is in the catalogue, worded in every language, scored once per tool and new to earlier baselines', () => {
  assert.equal(CATALOG['contract-changed-in-session'].nature, 'observed');
  for (const locale of ['en', 'fr', 'de', 'es', 'he', 'ar', 'ja', 'zh_CN']) {
    const messages = JSON.parse(readFileSync(new URL(`../src/_locales/${locale}/messages.json`, import.meta.url), 'utf8'));
    for (const part of ['title', 'why', 'fix']) assert.ok(messages[localeKey('contract-changed-in-session', part)]?.message, `${locale} ${part}`);
    for (const key of ['timeline_kindChanged', 'timeline_sameContract']) assert.ok(messages[key]?.message, `${locale} ${key}`);
    for (const key of ['timeline_changedParts', 'timeline_otherContract']) assert.match(messages[key]?.message ?? '', /\$1/, `${locale} ${key}`);
  }
  const discovery = { topOrigin: ORIGIN, tools: [tool()], frames: [{ instrumented: false }], completeness: { ungrantedOrigins: [], refusedFrames: [] }, unreachableFrames: [], env: {} };
  const events = [{ kind: 'changed', toolName: 'get_quote', at: 1, frameId: 0, parts: ['description'] }, { kind: 'changed', toolName: 'get_quote', at: 2, frameId: 0, parts: ['schema'] }];
  const clean = reviewSecurity({ discovery });
  const review = reviewSecurity({ discovery, events });
  assert.deepEqual(review.findings.filter((f) => f.axis === 'lifecycle').map((f) => f.code), ['contract-changed-in-session']);
  assert.equal(clean.score.value - review.score.value, 10, 'one medium deduction for the tool, however many changes');
  assert.ok(!review.coverage.notObservable.some((n) => n.code === 'lifecycle'));

  assert.deepEqual([...ENGINE_V4_CODES], ['contract-changed-in-session']);
  const before = makeBaseline(clean, discovery);
  assert.equal(before.engine, ENGINE_VERSION);
  assert.equal(diffBaseline(before, review, discovery).regressed, true, 'against a baseline of this engine it is a regression');
  const earlier = diffBaseline({ ...before, engine: 3 }, review, discovery);
  assert.deepEqual([earlier.newRules.map((f) => f.code), earlier.added.length, earlier.regressed], [['contract-changed-in-session'], 0, false]);
});

test('the timeline record carries the comparison where there was one, and nothing new elsewhere', () => {
  const events = [
    { id: 'ev_1', kind: 'registered', at: 1_794_000_000_000, toolName: 'get_new', origin: ORIGIN, frameId: 0 },
    { id: 'ev_2', kind: 'changed', at: 1_794_000_001_000, toolName: 'get_quote', origin: ORIGIN, frameId: 0, parts: ['description'] },
    { id: 'ev_3', kind: 'registered', at: 1_794_000_002_000, toolName: 'get_rates', origin: ORIGIN, frameId: 0, contract: 'changed', parts: ['schema'] },
    { id: 'ev_4', kind: 'registered', at: 1_794_000_003_000, toolName: 'get_status', origin: ORIGIN, frameId: 0, contract: 'same', parts: [] },
  ];
  const out = timelineReport(events, { origin: ORIGIN, at: 1_794_000_010_000 });
  assert.deepEqual(Object.keys(out.json.events[0]), ['at', 'kind', 'tool', 'origin', 'frameId', 'durationMs', 'code', 'error']);
  assert.deepEqual(out.json.events.slice(1).map((e) => [e.kind, e.contract ?? null, e.parts]), [['changed', null, ['description']], ['registered', 'changed', ['schema']], ['registered', 'same', []]]);
  assert.match(out.markdown, /\| changed \| `get_quote` \| 0 \| — \| changed under the same name: description \|/);
  assert.match(out.markdown, /\| registered \| `get_rates` \| 0 \| — \| not the contract it had before its removal: schema \|/);
  assert.match(out.markdown, /\| registered \| `get_status` \| 0 \| — \| same contract as before its removal \|/);
});
