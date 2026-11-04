import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../src/core/registry.js';
import { createSnapshot } from '../src/core/snapshots/snapshot.js';
import { diffSnapshots } from '../src/core/snapshots/diff.js';

// Two live instances of one logical tool with different contracts, through the real
// registry → snapshot → diff chain. The first three cases were contributed by the independent
// audit of 2026-09-05: the diff used to keep only the last variant written (D-057).

const topOrigin = 'https://shop.example';

function frame(frameId, description) {
  return {
    injected: true, isTopLevel: false, frameId, documentId: `doc-${frameId}`,
    frameUrl: 'https://widgets.example/widget.html', origin: 'https://widgets.example',
    frameIndexPath: [], declarativeToolNames: [],
    tools: [{
      name: 'get_state', description, inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true }, ownFrame: true, origin: 'https://widgets.example',
    }],
  };
}

async function snap(descriptions, at) {
  const registry = await buildRegistry({ topOrigin, frames: descriptions.map(([id, desc]) => frame(id, desc)) });
  return createSnapshot(registry, { at });
}

test('control: changing the last sibling is detected', async () => {
  const d = diffSnapshots(await snap([[6, 'A'], [7, 'B']], 1), await snap([[6, 'A'], [7, 'B revised']], 2));
  assert.equal(d.changed, true);
  assert.equal(d.counts.changed, 1);
  assert.equal(d.counts.unchanged, 1);
});

test('a changed contract in the first sibling is not reported as unchanged', async () => {
  const a = await snap([[6, 'A'], [7, 'B']], 1);
  const b = await snap([[6, 'A revised'], [7, 'B']], 2);
  assert.notEqual(a.tools[0].contractFp, b.tools[0].contractFp, 'the first contract really changed');
  const d = diffSnapshots(a, b);
  assert.equal(d.changed, true);
  assert.equal(d.counts.changed, 1);
  assert.equal(d.counts.unchanged, 1);
  assert.deepEqual(d.entries.find((e) => e.change === 'changed').details, ['description']);
});

test('reordering the same snapshot entries does not invent a rewrite', async () => {
  const a = await snap([[6, 'A'], [7, 'B']], 1);
  const b = { ...structuredClone(a), id: 'reordered', takenAt: 2, tools: [...structuredClone(a.tools)].reverse() };
  const d = diffSnapshots(a, b);
  assert.equal(d.changed, false);
  assert.equal(d.counts.unchanged, 2);
});

test('a variant that disappeared is a removal of that variant, not silence', async () => {
  const d = diffSnapshots(await snap([[6, 'A'], [7, 'B']], 1), await snap([[6, 'A']], 2));
  assert.equal(d.counts.unchanged, 1);
  assert.equal(d.counts.removed, 1);
  assert.equal(d.changed, true);
});

test('a variant that appeared is an addition of that variant', async () => {
  const d = diffSnapshots(await snap([[6, 'A']], 1), await snap([[6, 'A'], [7, 'B']], 2));
  assert.equal(d.counts.unchanged, 1);
  assert.equal(d.counts.added, 1);
});

test('two identical variants stay two unchanged entries', async () => {
  const d = diffSnapshots(await snap([[6, 'A'], [7, 'A']], 1), await snap([[8, 'A'], [9, 'A']], 2));
  assert.equal(d.changed, false);
  assert.equal(d.counts.unchanged, 2);
});
