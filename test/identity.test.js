import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJson, sha256Hex, frameKey, logicalId, contractFingerprint,
} from '../src/core/identity.js';

test('canonicalJson sorts keys recursively', () => {
  const a = { b: 1, a: { d: 2, c: 3 } };
  const b = { a: { c: 3, d: 2 }, b: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test('canonicalJson preserves array order', () => {
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test('canonicalJson handles null and primitives', () => {
  assert.equal(canonicalJson(null), 'null');
  assert.equal(canonicalJson(5), '5');
  assert.equal(canonicalJson('x'), '"x"');
});

test('canonicalJson turns undefined into null rather than throwing', () => {
  assert.equal(canonicalJson(undefined), 'null');
});

test('sha256Hex is stable and 64 hex chars', async () => {
  const h = await sha256Hex('abc');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await sha256Hex('abc'));
});

test('frameKey returns top for the top-level frame', () => {
  assert.equal(frameKey({ isTopLevel: true }), 'top');
});

test('frameKey strips query and fragment', () => {
  const a = frameKey({ isTopLevel: false, frameUrl: 'https://pay.example.net/w?a=1#x' });
  const b = frameKey({ isTopLevel: false, frameUrl: 'https://pay.example.net/w?a=2' });
  assert.equal(a, 'https://pay.example.net/w');
  assert.equal(a, b);
});

test('frameKey falls back to index path for opaque frames', () => {
  assert.equal(
    frameKey({ isTopLevel: false, frameUrl: 'about:blank', frameIndexPath: [0, 2] }),
    'idx:0/2',
  );
  assert.equal(
    frameKey({ isTopLevel: false, frameUrl: 'about:srcdoc', frameIndexPath: [1] }),
    'idx:1',
  );
});

test('frameKey falls back to index path when url is missing', () => {
  assert.equal(frameKey({ isTopLevel: false, frameIndexPath: [3] }), 'idx:3');
});

test('logicalId is stable for the same inputs', async () => {
  const args = { topOrigin: 'https://shop.example.com', frameKey: 'top', toolName: 'search' };
  assert.equal(await logicalId(args), await logicalId(args));
});

test('logicalId differs across origins, frames and names', async () => {
  const base = { topOrigin: 'https://a.com', frameKey: 'top', toolName: 'search' };
  const other = await logicalId({ ...base, topOrigin: 'https://b.com' });
  const frame = await logicalId({ ...base, frameKey: 'https://a.com/w' });
  const name = await logicalId({ ...base, toolName: 'other' });
  const id = await logicalId(base);
  assert.notEqual(id, other);
  assert.notEqual(id, frame);
  assert.notEqual(id, name);
});

test('logicalId is not confusable across field boundaries', async () => {
  const a = await logicalId({ topOrigin: 'https://a', frameKey: 'b', toolName: 'c' });
  const b = await logicalId({ topOrigin: 'https://ab', frameKey: '', toolName: 'c' });
  assert.notEqual(a, b);
});

test('contractFingerprint ignores key order in the schema', async () => {
  const one = await contractFingerprint({
    inputSchema: { type: 'object', properties: { b: { type: 'string' }, a: { type: 'number' } } },
    annotations: { readOnlyHint: true },
    description: 'Search',
  });
  const two = await contractFingerprint({
    inputSchema: { properties: { a: { type: 'number' }, b: { type: 'string' } }, type: 'object' },
    annotations: { readOnlyHint: true },
    description: 'Search',
  });
  assert.equal(one, two);
});

test('contractFingerprint changes when the description changes', async () => {
  const base = { inputSchema: { type: 'object' }, annotations: {}, description: 'a' };
  const changed = { ...base, description: 'b' };
  assert.notEqual(await contractFingerprint(base), await contractFingerprint(changed));
});

test('contractFingerprint changes when annotations change', async () => {
  const base = { inputSchema: { type: 'object' }, annotations: {}, description: 'a' };
  const changed = { ...base, annotations: { consequentialHint: true } };
  assert.notEqual(await contractFingerprint(base), await contractFingerprint(changed));
});

test('contractFingerprint ignores annotation key order', async () => {
  const one = await contractFingerprint({
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: true, consequentialHint: false },
    description: 'a',
  });
  const two = await contractFingerprint({
    inputSchema: { type: 'object' },
    annotations: { consequentialHint: false, readOnlyHint: true },
    description: 'a',
  });
  assert.equal(one, two);
});

test('contractFingerprint tolerates a missing schema', async () => {
  const fp = await contractFingerprint({ description: 'a' });
  assert.match(fp, /^[0-9a-f]{64}$/);
});
