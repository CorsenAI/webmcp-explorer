import test from 'node:test';
import assert from 'node:assert/strict';
import { findUnreachableFrames, computeCompleteness } from '../src/core/frames.js';

const top = 'http://localhost:8777';

function frame(over = {}) {
  return {
    injected: true, origin: top, frameUrl: `${top}/iframes.html`, childFrames: [], ...over,
  };
}

test('no child frames means nothing unreachable', () => {
  assert.deepEqual(findUnreachableFrames({ frames: [frame()] }), []);
});

test('a child on an injected origin is not unreachable', () => {
  const frames = [
    frame({ childFrames: [{ src: '/child-same.html', allow: 'tools', allowsTools: true }] }),
  ];
  assert.deepEqual(findUnreachableFrames({ frames }), []);
});

test('a cross-origin child that was not injected is reported', () => {
  const frames = [frame({
    childFrames: [{ src: 'http://127.0.0.1:8788/c.html', allow: 'tools', allowsTools: true }],
  })];
  assert.deepEqual(findUnreachableFrames({ frames }), [
    { origin: 'http://127.0.0.1:8788', allowsTools: true, count: 1 },
  ]);
});

test('a missing allow attribute is carried through for diagnosis', () => {
  const frames = [frame({
    childFrames: [{ src: 'http://127.0.0.1:8788/c.html', allow: null, allowsTools: false }],
  })];
  assert.equal(findUnreachableFrames({ frames })[0].allowsTools, false);
});

test('one delegating embed is enough to mark the origin as delegated', () => {
  const frames = [frame({
    childFrames: [
      { src: 'http://127.0.0.1:8788/c.html', allow: null, allowsTools: false },
      { src: 'http://127.0.0.1:8788/c.html', allow: 'tools', allowsTools: true },
    ],
  })];
  const found = findUnreachableFrames({ frames });
  assert.equal(found.length, 1);
  assert.equal(found[0].allowsTools, true);
  assert.equal(found[0].count, 2);
});

test('relative srcs resolve against the embedding frame url', () => {
  const frames = [frame({
    frameUrl: 'http://localhost:8777/deep/page.html',
    childFrames: [{ src: '../other.html', allow: null, allowsTools: false }],
  })];
  assert.deepEqual(findUnreachableFrames({ frames }), []);
});

test('srcdoc and malformed srcs are skipped rather than guessed at', () => {
  const frames = [frame({
    childFrames: [
      { src: null, allow: null, allowsTools: false },
      { src: 'not a url', allow: null, allowsTools: false },
    ],
  })];
  assert.deepEqual(findUnreachableFrames({ frames }), []);
});

test('results are sorted for a stable render', () => {
  const frames = [frame({
    childFrames: [
      { src: 'http://z.example:8788/c.html', allowsTools: false },
      { src: 'http://a.example:8788/c.html', allowsTools: false },
    ],
  })];
  assert.deepEqual(
    findUnreachableFrames({ frames }).map((f) => f.origin),
    ['http://a.example:8788', 'http://z.example:8788'],
  );
});

test('completeness stays true when nothing was missed', () => {
  const c = computeCompleteness({
    registryCompleteness: { complete: true, ungrantedOrigins: [] },
    unreachableFrames: [],
  });
  assert.equal(c.complete, true);
  assert.deepEqual(c.ungrantedOrigins, []);
});

// The dangerous case: no tool is missing from the list, yet whole frames went uninspected.
test('an unreachable frame alone makes discovery incomplete', () => {
  const c = computeCompleteness({
    registryCompleteness: { complete: true, ungrantedOrigins: [] },
    unreachableFrames: [{ origin: 'http://127.0.0.1:8788', allowsTools: true, count: 2 }],
  });
  assert.equal(c.complete, false);
  assert.deepEqual(c.ungrantedOrigins, ['http://127.0.0.1:8788']);
});

test('both sources of incompleteness are merged and deduplicated', () => {
  const c = computeCompleteness({
    registryCompleteness: { complete: false, ungrantedOrigins: ['http://127.0.0.1:8788'] },
    unreachableFrames: [
      { origin: 'http://127.0.0.1:8788', allowsTools: true, count: 1 },
      { origin: 'https://pay.example.net', allowsTools: false, count: 1 },
    ],
  });
  assert.equal(c.complete, false);
  assert.deepEqual(c.ungrantedOrigins, ['http://127.0.0.1:8788', 'https://pay.example.net']);
});

test('computeCompleteness tolerates a missing registry section', () => {
  const c = computeCompleteness({ unreachableFrames: [] });
  assert.equal(c.complete, true);
});

// A frame Explorer entered whose getTools() the browser refused (Chrome 153–155, document not
// origin-keyed, WMP-0051): nothing is missing from the list, yet nothing was seen (D-023).
test('computeCompleteness counts a frame whose call was refused as incomplete', () => {
  const c = computeCompleteness({
    registryCompleteness: { complete: true, ungrantedOrigins: [] },
    unreachableFrames: [],
    refusedFrames: [{ frameId: 0, origin: 'http://localhost:8777', isTopLevel: true,
      callError: { name: 'SecurityError', message: 'document.modelContext cannot be used when document.domain is enabled.' } }],
  });
  assert.equal(c.complete, false);
  assert.deepEqual(c.ungrantedOrigins, []);
  assert.equal(c.refusedFrames.length, 1);
  assert.equal(c.refusedFrames[0].name, 'SecurityError');
  assert.equal(c.refusedFrames[0].isTopLevel, true);
});

test('computeCompleteness ignores frames without a refusal and stays complete', () => {
  const c = computeCompleteness({
    registryCompleteness: { complete: true, ungrantedOrigins: [] },
    refusedFrames: [{ frameId: 0, origin: 'http://localhost:8777', callError: null }],
  });
  assert.equal(c.complete, true);
  assert.deepEqual(c.refusedFrames, []);
});

