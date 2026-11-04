import test from 'node:test';
import assert from 'node:assert/strict';

import { createSnapshot, isTrustworthy } from '../src/core/snapshots/snapshot.js';
import { diffSnapshots, CHANGE } from '../src/core/snapshots/diff.js';

const AT = Date.parse('2026-09-04T10:00:00.000Z');

const tool = (over = {}) => ({
  name: 'search_products',
  description: 'Search the catalogue',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  schemaError: null,
  annotations: { readOnlyHint: true },
  origin: 'http://localhost:8777',
  frameKey: 'top',
  frameId: 0,
  logicalId: 'id-search',
  contractFp: 'fp-search-1',
  ...over,
});

const discovery = (tools, over = {}) => ({
  topOrigin: 'http://localhost:8777',
  completeness: { complete: true, reasons: [] },
  tools,
  ...over,
});

const snap = (tools, over = {}, at = AT) => createSnapshot(discovery(tools, over), { at });

test('a snapshot keeps the contract and drops the runtime frame id', () => {
  const out = snap([tool()]);
  assert.equal(out.tools.length, 1);
  assert.equal(out.tools[0].contractFp, 'fp-search-1');
  assert.equal('frameId' in out.tools[0], false);
  assert.equal(out.origin, 'http://localhost:8777');
});

test('a snapshot orders tools so two captures are directly comparable', () => {
  const out = snap([
    tool({ name: 'zeta', logicalId: 'z' }),
    tool({ name: 'alpha', logicalId: 'a' }),
  ]);
  assert.deepEqual(out.tools.map((t) => t.name), ['alpha', 'zeta']);
});

test('a snapshot records what the page declares, not what an override shows', () => {
  const out = snap([tool({
    overridden: true,
    description: 'MY REWRITE',
    originalDescription: 'Search the catalogue',
    inputSchema: { type: 'object', properties: {} },
    originalInputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  })]);
  assert.equal(out.tools[0].description, 'Search the catalogue');
  assert.deepEqual(out.tools[0].inputSchema.properties, { q: { type: 'string' } });
});

test('a partial capture is marked as such, with the reason', () => {
  const out = snap([tool()], {
    completeness: { complete: false, reasons: ['origin-not-granted'] },
  });
  assert.equal(out.complete, false);
  assert.deepEqual(out.notObserved, ['origin-not-granted']);
  assert.equal(isTrustworthy(out), false);
  assert.equal(isTrustworthy(snap([tool()])), true);
});

test('two identical captures show no change at all', () => {
  const out = diffSnapshots(snap([tool()]), snap([tool()]));
  assert.equal(out.changed, false);
  assert.equal(out.counts.unchanged, 1);
  assert.deepEqual(out.entries[0].details, []);
});

test('a reworded description is reported, and named', () => {
  const out = diffSnapshots(
    snap([tool()]),
    snap([tool({ description: 'Search products by keyword', contractFp: 'fp-search-2' })]));
  assert.equal(out.counts.changed, 1);
  assert.deepEqual(out.entries[0].details, ['description']);
  assert.equal(out.entries[0].fingerprintChanged, true);
});

test('a schema change is reported separately from a description change', () => {
  const out = diffSnapshots(
    snap([tool()]),
    snap([tool({
      inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      contractFp: 'fp-search-2',
    })]));
  assert.deepEqual(out.entries[0].details, ['schema']);
});

test('reordering the keys of a schema is not a change', () => {
  const before = snap([tool({
    inputSchema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } },
  })]);
  const after = snap([tool({
    inputSchema: { properties: { b: { type: 'number' }, a: { type: 'string' } }, type: 'object' },
  })]);
  const out = diffSnapshots(before, after);
  assert.equal(out.changed, false);
  assert.deepEqual(out.entries[0].details, []);
});

test('an annotation change is reported', () => {
  const out = diffSnapshots(
    snap([tool()]),
    snap([tool({ annotations: { readOnlyHint: false }, contractFp: 'fp-2' })]));
  assert.deepEqual(out.entries[0].details, ['annotations']);
});

test('a schema that stopped parsing is a change worth naming', () => {
  const out = diffSnapshots(
    snap([tool()]),
    snap([tool({ inputSchema: null, schemaError: 'not valid JSON', contractFp: 'fp-2' })]));
  assert.ok(out.entries[0].details.includes('schema-error'));
});

test('a new tool is an addition, a vanished one a removal', () => {
  const out = diffSnapshots(
    snap([tool()]),
    snap([tool({ name: 'add_to_cart', logicalId: 'id-cart', contractFp: 'fp-cart' })]));
  assert.equal(out.counts.added, 1);
  assert.equal(out.counts.removed, 1);
  assert.equal(out.entries.find((e) => e.name === 'add_to_cart').change, CHANGE.added);
  assert.equal(out.entries.find((e) => e.name === 'search_products').change, CHANGE.removed);
});

test('a tool that moved frame is a move, not a deletion and a creation', () => {
  const out = diffSnapshots(
    snap([tool()]),
    snap([tool({ logicalId: 'id-search-in-iframe', frameKey: 'http://localhost:8777/widget' })]));
  assert.equal(out.counts.moved, 1);
  assert.equal(out.counts.removed, 0);
  assert.equal(out.counts.added, 0);
  const entry = out.entries[0];
  assert.equal(entry.movedFrom, 'top');
  assert.equal(entry.movedTo, 'http://localhost:8777/widget');
});

test('a tool that moved AND changed reports both', () => {
  const out = diffSnapshots(
    snap([tool()]),
    snap([tool({
      logicalId: 'moved', frameKey: 'idx:0',
      description: 'Search products', contractFp: 'fp-2',
    })]));
  assert.equal(out.entries[0].change, CHANGE.moved);
  assert.deepEqual(out.entries[0].details, ['description']);
});

test('two tools of the same name in different frames do not swap identities', () => {
  const before = snap([
    tool({ logicalId: 'a', frameKey: 'top' }),
    tool({ logicalId: 'b', frameKey: 'idx:0' }),
  ]);
  const after = snap([
    tool({ logicalId: 'a', frameKey: 'top' }),
    tool({ logicalId: 'c', frameKey: 'idx:1' }),
  ]);
  const out = diffSnapshots(before, after);
  assert.equal(out.counts.unchanged, 1);
  assert.equal(out.counts.moved, 1);
  assert.equal(out.counts.removed, 0);
});

test('a partial capture never lets a removal be asserted as fact', () => {
  const before = snap([tool(), tool({ name: 'add_to_cart', logicalId: 'id-cart' })]);
  const after = snap([tool()], { completeness: { complete: false, reasons: ['origin-not-granted'] } });
  const out = diffSnapshots(before, after);
  assert.equal(out.counts.removed, 1);
  assert.equal(out.removalsUncertain, true);
  assert.equal(out.partial, true);
  assert.deepEqual(out.notObserved, ['origin-not-granted']);
});

test('a partial capture with no removals raises no doubt', () => {
  const out = diffSnapshots(
    snap([tool()]),
    snap([tool(), tool({ name: 'new_tool', logicalId: 'n' })],
      { completeness: { complete: false, reasons: ['origin-not-granted'] } }));
  assert.equal(out.removalsUncertain, false);
  assert.equal(out.partial, true);
  assert.equal(out.counts.added, 1);
});

test('the diff carries both ends so a report can name them', () => {
  const before = createSnapshot(discovery([tool()]), { at: AT, label: 'before deploy' });
  const after = createSnapshot(discovery([tool()]), { at: AT + 1000, label: 'after deploy' });
  const out = diffSnapshots(before, after);
  assert.equal(out.from.label, 'before deploy');
  assert.equal(out.to.label, 'after deploy');
  assert.equal(out.to.takenAt, AT + 1000);
});

test('an empty page compared with itself does not throw', () => {
  assert.doesNotThrow(() => diffSnapshots(snap([]), snap([])));
  assert.equal(diffSnapshots(snap([]), snap([])).changed, false);
});

test('a missing snapshot is handled rather than crashing the screen', () => {
  const out = diffSnapshots(null, snap([tool()]));
  assert.equal(out.counts.added, 1);
  assert.equal(out.from.id, null);
});
