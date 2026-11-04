import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshot } from '../src/core/snapshots/snapshot.js';
import { diffSnapshots, CHANGE, MATCH } from '../src/core/snapshots/diff.js';

// Comparing localhost with staging, or staging with production: every logicalId differs because
// the top origin does, so the environment mode matches tools by frame path and name and treats
// the origin difference as the premise rather than as a change.

const page = (origin, tools) => createSnapshot({
  topOrigin: origin,
  completeness: { complete: true, reasons: [] },
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description ?? 'd',
    inputSchema: t.inputSchema ?? { type: 'object' },
    annotations: t.annotations ?? {},
    origin: t.origin ?? origin,
    frameKey: t.frameKey ?? 'top',
    // Different origins hash to different ids in the real registry; modelled directly here.
    logicalId: `${origin}|${t.frameKey ?? 'top'}|${t.name}`,
    contractFp: t.contractFp ?? `fp-${t.name}-${t.description ?? 'd'}`,
  })),
}, { at: 1 });

const STAGING = 'https://staging.shop.example';
const PROD = 'https://shop.example';

test('the same contract on two origins is unchanged in environment mode, and a churn in identity mode', () => {
  const tools = [{ name: 'search' }, { name: 'add_to_cart' }];
  const cross = diffSnapshots(page(STAGING, tools), page(PROD, tools), { matchBy: MATCH.name });
  assert.equal(cross.changed, false);
  assert.equal(cross.counts.unchanged, 2);
  assert.equal(cross.matchBy, 'name');
  assert.deepEqual([cross.from.origin, cross.to.origin], [STAGING, PROD]);

  const byIdentity = diffSnapshots(page(STAGING, tools), page(PROD, tools));
  assert.equal(byIdentity.counts.removed, 2, 'without the environment mode every tool looks deleted…');
  assert.equal(byIdentity.counts.added, 2, '…and re-created, which is the lie the mode exists to avoid');
});

test('a description that differs between environments is reported as a change, with the detail', () => {
  const out = diffSnapshots(
    page(STAGING, [{ name: 'search', description: 'Search the catalogue by keyword and price.' }]),
    page(PROD, [{ name: 'search', description: 'Search things.' }]),
    { matchBy: MATCH.name },
  );
  assert.equal(out.entries[0].change, CHANGE.changed);
  assert.deepEqual(out.entries[0].details, ['description']);
  assert.equal(out.entries[0].fingerprintChanged, true);
});

test('a tool only one environment has is added or removed; a tool in another frame is moved', () => {
  const out = diffSnapshots(
    page(STAGING, [{ name: 'search' }, { name: 'legacy' }, { name: 'pay', frameKey: 'https://pay.example/frame' }]),
    page(PROD, [{ name: 'search' }, { name: 'brand_new' }, { name: 'pay', frameKey: 'https://checkout.example/frame' }]),
    { matchBy: MATCH.name },
  );
  const by = Object.fromEntries(out.entries.map((e) => [e.name, e]));
  assert.equal(by.search.change, CHANGE.unchanged);
  assert.equal(by.legacy.change, CHANGE.removed);
  assert.equal(by.brand_new.change, CHANGE.added);
  assert.equal(by.pay.change, CHANGE.moved);
  assert.equal(by.pay.movedFrom, 'https://pay.example/frame');
  assert.equal(by.pay.movedTo, 'https://checkout.example/frame');
});

test('the default mode is untouched: identity, then origin and name for moves', () => {
  const before = page(PROD, [{ name: 'search' }]);
  const after = page(PROD, [{ name: 'search', frameKey: 'https://shop.example/frame' }]);
  const out = diffSnapshots(before, after);
  assert.equal(out.matchBy, 'identity');
  assert.equal(out.entries[0].change, CHANGE.moved);
});
