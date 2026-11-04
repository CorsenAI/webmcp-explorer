import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../src/core/registry.js';
import { executionKind } from '../src/core/timeline.js';
import { createSnapshot } from '../src/core/snapshots/snapshot.js';
import { diffSnapshots, CHANGE } from '../src/core/snapshots/diff.js';
import { filterTools } from '../src/core/filter.js';

const topOrigin = 'https://shop.example.com';
const frame = (tools) => ({
  frameId: 0, isTopLevel: true, frameUrl: `${topOrigin}/`, frameIndexPath: [],
  injected: true, origin: topOrigin, tools,
});
const raw = (over = {}) => ({
  name: 'search', description: 'Search', inputSchema: { type: 'object' },
  annotations: {}, origin: topOrigin, ownFrame: true, ...over,
});

// getTools() returns `title` on Chrome 152 and 153 (tools/probe-platform.mjs); the registry
// used to drop it on the floor.
test('the registry keeps the title a page gives its tool, and defaults to an empty one', async () => {
  const r = await buildRegistry({ topOrigin, frames: [frame([
    raw({ name: 'a', title: 'Search the catalogue' }),
    raw({ name: 'b' }),
    raw({ name: 'c', title: 7 }),
  ])] });
  assert.deepEqual(r.tools.map((t) => [t.name, t.title]),
    [['a', 'Search the catalogue'], ['b', ''], ['c', '']]);
});

test('search matches the title as well as the name and description', () => {
  const tools = [
    { name: 'a', title: 'Catalogue lookup', description: '', origin: topOrigin, frameId: 0, annotations: {} },
    { name: 'b', title: '', description: 'nothing', origin: topOrigin, frameId: 0, annotations: {} },
  ];
  assert.deepEqual(filterTools(tools, { query: 'lookup' }).map((t) => t.name), ['a']);
});

test('a title-only change is reported as a contract change naming the title', () => {
  const discovery = (title) => ({
    topOrigin, completeness: { complete: true, reasons: [] },
    tools: [{ name: 'a', title, description: 'd', inputSchema: { type: 'object' }, annotations: {},
      origin: topOrigin, frameKey: 'top', logicalId: 'id-a', contractFp: 'fp-a' }],
  });
  const diff = diffSnapshots(createSnapshot(discovery('One')), createSnapshot(discovery('Two')));
  assert.equal(diff.entries[0].change, CHANGE.changed);
  assert.deepEqual(diff.entries[0].details, ['title']);
});

test('a snapshot taken before titles were recorded does not differ from one with an empty title', () => {
  const before = { tools: [{ name: 'a', description: 'd', inputSchema: null, annotations: {},
    origin: topOrigin, frameKey: 'top', logicalId: 'id-a', contractFp: 'fp-a' }] };
  const after = { tools: [{ ...before.tools[0], title: '' }] };
  assert.equal(diffSnapshots(before, after).changed, false);
});

test('a cancelled call is its own timeline kind, neither executed nor failed', () => {
  assert.equal(executionKind({ ok: true }), 'executed');
  assert.equal(executionKind({ ok: false, code: 'tool-threw' }), 'failed');
  assert.equal(executionKind({ ok: false, code: 'cancelled' }), 'cancelled');
  assert.equal(executionKind(null), 'failed');
});
