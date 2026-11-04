import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../src/core/registry.js';

const topOrigin = 'https://shop.example.com';

function frame(over = {}) {
  return {
    frameId: 0, isTopLevel: true, frameUrl: topOrigin + '/', frameIndexPath: [],
    injected: true, origin: topOrigin, tools: [], ...over,
  };
}

function tool(over = {}) {
  return {
    name: 'search', description: 'Search', inputSchema: { type: 'object' },
    annotations: {}, origin: topOrigin, ownFrame: true, ...over,
  };
}

// getTools() aggregates same-origin frames: every same-origin frame reports the same list,
// and only the owning frame sees ownFrame === true. Observed live, see D-021.
test('a tool reported by several same-origin frames is listed once', async () => {
  const shared = [tool({ name: 'top_tool', ownFrame: true })];
  const echoed = [tool({ name: 'top_tool', ownFrame: false })];
  const frames = [
    frame({ frameId: 0, tools: shared }),
    frame({ frameId: 5, isTopLevel: false, frameUrl: `${topOrigin}/child.html`, tools: echoed }),
    frame({ frameId: 8, isTopLevel: false, frameUrl: 'about:srcdoc', origin: 'null', tools: echoed }),
  ];
  const r = await buildRegistry({ topOrigin, frames });
  assert.equal(r.tools.length, 1);
  assert.equal(r.tools[0].frameId, 0);
  assert.equal(r.tools[0].notInjected, false);
  assert.equal(r.completeness.complete, true);
});

test('each same-origin frame keeps the tool it actually owns', async () => {
  const frames = [
    frame({
      frameId: 0,
      tools: [tool({ name: 'top_tool', ownFrame: true }), tool({ name: 'child_tool', ownFrame: false })],
    }),
    frame({
      frameId: 5, isTopLevel: false, frameUrl: `${topOrigin}/child.html`,
      tools: [tool({ name: 'top_tool', ownFrame: false }), tool({ name: 'child_tool', ownFrame: true })],
    }),
  ];
  const r = await buildRegistry({ topOrigin, frames });
  assert.deepEqual(
    r.tools.map((t) => [t.name, t.frameId]),
    [['child_tool', 5], ['top_tool', 0]],
  );
});

test('ownFrame absent falls back to origin matching without inventing ownership', async () => {
  const frames = [frame({ tools: [{ ...tool(), ownFrame: undefined }] })];
  const r = await buildRegistry({ topOrigin, frames });
  assert.equal(r.tools[0].frameId, 0);
  assert.equal(r.tools[0].notInjected, false);
});

test('a top-level tool gets a logical id and a contract fingerprint', async () => {
  const r = await buildRegistry({ topOrigin, frames: [frame({ tools: [tool()] })] });
  assert.equal(r.tools.length, 1);
  assert.match(r.tools[0].logicalId, /^[0-9a-f]{64}$/);
  assert.match(r.tools[0].contractFp, /^[0-9a-f]{64}$/);
});

test('the same tool keeps its logical id when frameId changes', async () => {
  const a = await buildRegistry({ topOrigin, frames: [frame({ frameId: 0, tools: [tool()] })] });
  const b = await buildRegistry({ topOrigin, frames: [frame({ frameId: 91, tools: [tool()] })] });
  assert.equal(a.tools[0].logicalId, b.tools[0].logicalId);
});

test('a changed schema keeps the logical id but changes the contract', async () => {
  const a = await buildRegistry({ topOrigin, frames: [frame({ tools: [tool()] })] });
  const b = await buildRegistry({
    topOrigin,
    frames: [frame({ tools: [tool({ inputSchema: { type: 'object', required: ['q'] } })] })],
  });
  assert.equal(a.tools[0].logicalId, b.tools[0].logicalId);
  assert.notEqual(a.tools[0].contractFp, b.tools[0].contractFp);
});

test('the same name in two frames yields two distinct tools', async () => {
  const frames = [
    frame({ tools: [tool()] }),
    frame({
      frameId: 12, isTopLevel: false, frameUrl: 'https://pay.example.net/widget',
      origin: 'https://pay.example.net', frameIndexPath: [0],
      tools: [tool({ origin: 'https://pay.example.net' })],
    }),
  ];
  const r = await buildRegistry({ topOrigin, frames });
  assert.equal(r.tools.length, 2);
  assert.notEqual(r.tools[0].logicalId, r.tools[1].logicalId);
});

test('registrationType defaults to unknown', async () => {
  const r = await buildRegistry({ topOrigin, frames: [frame({ tools: [tool()] })] });
  assert.equal(r.tools[0].registrationType, 'unknown');
});

test('a declarative match is recorded with high confidence', async () => {
  const frames = [frame({ tools: [tool()], declarativeToolNames: ['search'] })];
  const r = await buildRegistry({ topOrigin, frames });
  assert.equal(r.tools[0].registrationType, 'declarative');
  assert.equal(r.tools[0].registrationConfidence, 'high');
  assert.equal(r.tools[0].autoSubmit, null);
});

test('a declarative match records autoSubmit true or false when declarativeAutoSubmitNames is provided', async () => {
  const frames = [frame({
    tools: [tool({ name: 'ping' }), tool({ name: 'subscribe' }), tool({ name: 'imperative' })],
    declarativeToolNames: ['ping', 'subscribe'],
    declarativeAutoSubmitNames: ['ping'],
  })];
  const r = await buildRegistry({ topOrigin, frames });
  const byName = Object.fromEntries(r.tools.map((t) => [t.name, t]));
  assert.equal(byName.ping.registrationType, 'declarative');
  assert.equal(byName.ping.autoSubmit, true);
  assert.equal(byName.subscribe.registrationType, 'declarative');
  assert.equal(byName.subscribe.autoSubmit, false);
  assert.equal(byName.imperative.registrationType, 'unknown');
  assert.equal(byName.imperative.autoSubmit, null);
});

test('no declarative match never asserts imperative', async () => {
  const frames = [frame({ tools: [tool()], declarativeToolNames: [] })];
  const r = await buildRegistry({ topOrigin, frames });
  assert.equal(r.tools[0].registrationType, 'unknown');
});

test('a tool from a non-injected origin has no frameId and is flagged', async () => {
  const frames = [frame({ tools: [tool({ origin: 'https://pay.example.net', ownFrame: false })] })];
  const r = await buildRegistry({ topOrigin, frames });
  assert.equal(r.tools[0].frameId, null);
  assert.equal(r.tools[0].notInjected, true);
});

test('discovery is complete when every tool origin was injected', async () => {
  const r = await buildRegistry({ topOrigin, frames: [frame({ tools: [tool()] })] });
  assert.equal(r.completeness.complete, true);
  assert.deepEqual(r.completeness.ungrantedOrigins, []);
});

test('discovery is partial and names the ungranted origins', async () => {
  const frames = [frame({
    tools: [tool(), tool({ name: 'pay', origin: 'https://pay.example.net', ownFrame: false })],
  })];
  const r = await buildRegistry({ topOrigin, frames });
  assert.equal(r.completeness.complete, false);
  assert.deepEqual(r.completeness.ungrantedOrigins, ['https://pay.example.net']);
});

test('an ungranted origin is reported once even with several tools', async () => {
  const frames = [frame({
    tools: [
      tool({ name: 'a', origin: 'https://pay.example.net', ownFrame: false }),
      tool({ name: 'b', origin: 'https://pay.example.net', ownFrame: false }),
    ],
  })];
  const r = await buildRegistry({ topOrigin, frames });
  assert.deepEqual(r.completeness.ungrantedOrigins, ['https://pay.example.net']);
});

test('tools are sorted by origin then name for a stable render', async () => {
  const frames = [frame({ tools: [tool({ name: 'zeta' }), tool({ name: 'alpha' })] })];
  const r = await buildRegistry({ topOrigin, frames });
  assert.deepEqual(r.tools.map((t) => t.name), ['alpha', 'zeta']);
});

test('an empty frame list yields an empty complete registry', async () => {
  const r = await buildRegistry({ topOrigin, frames: [] });
  assert.deepEqual(r.tools, []);
  assert.equal(r.completeness.complete, true);
});

// Chrome 152 returns inputSchema as a JSON string (D-025). The registry is the single place
// that parses it, so every consumer downstream gets an object.
test('a string inputSchema is parsed into an object', async () => {
  const frames = [frame({
    tools: [tool({ inputSchema: '{"type":"object","properties":{"q":{"type":"string"}}}' })],
  })];
  const r = await buildRegistry({ topOrigin, frames });
  assert.equal(typeof r.tools[0].inputSchema, 'object');
  assert.equal(r.tools[0].inputSchema.properties.q.type, 'string');
  assert.equal(r.tools[0].schemaError, null);
});

test('an unparseable schema is surfaced, not hidden behind an empty object', async () => {
  const frames = [frame({ tools: [tool({ inputSchema: '{broken' })] })];
  const r = await buildRegistry({ topOrigin, frames });
  assert.equal(r.tools[0].inputSchema, null);
  assert.match(r.tools[0].schemaError, /not valid JSON/);
});

test('the contract fingerprint is identical whether the schema arrived as string or object', async () => {
  const asObject = await buildRegistry({
    topOrigin, frames: [frame({ tools: [tool({ inputSchema: { type: 'object' } })] })],
  });
  const asString = await buildRegistry({
    topOrigin, frames: [frame({ tools: [tool({ inputSchema: '{"type":"object"}' })] })],
  });
  assert.equal(asObject.tools[0].contractFp, asString.tools[0].contractFp);
});
