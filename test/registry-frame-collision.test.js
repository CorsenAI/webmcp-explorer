import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../src/core/registry.js';
import { executeToolInPage } from '../src/page/execute.js';

// Two iframes loading the same URL, each owning a tool of the same name: two live instances
// that share a logical identity. The first four cases were contributed by the independent
// audit of 2026-09-05, which found the registry keeping one and dropping the other (D-056).

const topOrigin = 'https://shop.example';

function child(frameId, frameUrl, description = 'Read the state of this widget') {
  return {
    injected: true,
    isTopLevel: false,
    frameId,
    documentId: `doc-${frameId}`,
    frameUrl,
    origin: new URL(frameUrl).origin,
    frameIndexPath: [],
    declarativeToolNames: [],
    tools: [{
      name: 'get_state',
      description,
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      ownFrame: true,
      origin: new URL(frameUrl).origin,
    }],
  };
}

test('control: different frame paths retain both concrete registrations', async () => {
  const r = await buildRegistry({ topOrigin, frames: [
    child(6, 'https://widgets.example/a.html'),
    child(7, 'https://widgets.example/b.html'),
  ] });
  assert.equal(r.tools.length, 2);
});

test('two simultaneously live frames with the SAME URL must not merge', async () => {
  const r = await buildRegistry({ topOrigin, frames: [
    child(6, 'https://widgets.example/widget.html'),
    child(7, 'https://widgets.example/widget.html'),
  ] });
  assert.equal(r.tools.length, 2, `lost registration; returned ${JSON.stringify(r.tools.map((t) => ({ name: t.name, frameId: t.frameId })))}`);
  assert.deepEqual(new Set(r.tools.map((t) => t.frameId)), new Set([6, 7]));
});

test('query-only difference must not collapse two live frames', async () => {
  const r = await buildRegistry({ topOrigin, frames: [
    child(6, 'https://widgets.example/widget.html?account=A'),
    child(7, 'https://widgets.example/widget.html?account=B'),
  ] });
  assert.equal(r.tools.length, 2);
});

test('same-path frames with distinct contracts must both remain addressable', async () => {
  const r = await buildRegistry({ topOrigin, frames: [
    child(6, 'https://widgets.example/widget.html', 'Get the state of widget A'),
    child(7, 'https://widgets.example/widget.html', 'Get the state of widget B'),
  ] });
  assert.equal(r.tools.length, 2);
});

test('the two instances share a logical id and have distinct instance ids, in a stable order', async () => {
  const r = await buildRegistry({ topOrigin, frames: [
    child(7, 'https://widgets.example/widget.html'),
    child(6, 'https://widgets.example/widget.html'),
  ] });
  assert.equal(r.tools[0].logicalId, r.tools[1].logicalId, 'history and overrides follow the logical tool');
  assert.notEqual(r.tools[0].instanceId, r.tools[1].instanceId);
  assert.deepEqual(r.tools.map((t) => t.frameId), [6, 7], 'ordered by frame, whatever order the probe reported');
});

test('a frame reporting the same tool twice still yields one instance', async () => {
  const frame = child(6, 'https://widgets.example/widget.html');
  frame.tools.push({ ...frame.tools[0] });
  const r = await buildRegistry({ topOrigin, frames: [frame] });
  assert.equal(r.tools.length, 1);
});

// --- execution: only the tool this window registered may run here ---------------------------

function withPage({ tools, ownWindow }, run) {
  const names = ['document', 'window', 'location'];
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const calls = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: ownWindow });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://widgets.example' } });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      modelContext: {
        getTools: async () => tools.map(t => Object.assign(t,{inputSchema:t.inputSchema ?? '{}'})),
        executeTool: async (tool) => { calls.push(tool); return tool.label; },
      },
    },
  });
  return run(calls).finally(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
}

const ORIGIN = 'https://widgets.example';

test('execution in a frame selects its OWN tool, not the same-origin sibling returned first', async () => {
  const ownWindow = {};
  const siblingWindow = {};
  const sibling = { name: 'get_state', origin: ORIGIN, window: siblingWindow, label: 'SIBLING' };
  const own = { name: 'get_state', origin: ORIGIN, window: ownWindow, label: 'OWN' };
  await withPage({ tools: [sibling, own], ownWindow }, async (calls) => {
    const result = await executeToolInPage('get_state', ORIGIN, '{}');
    assert.equal(result.ok, true);
    assert.equal(result.result, 'OWN');
    assert.strictEqual(calls[0], own);
  });
});

test('the order getTools() returns the frames in does not matter', async () => {
  const ownWindow = {};
  const sibling = { name: 'get_state', origin: ORIGIN, window: {}, label: 'SIBLING' };
  const own = { name: 'get_state', origin: ORIGIN, window: ownWindow, label: 'OWN' };
  await withPage({ tools: [own, sibling], ownWindow }, async (calls) => {
    const result = await executeToolInPage('get_state', ORIGIN, '{}');
    assert.equal(result.result, 'OWN');
    assert.strictEqual(calls[0], own);
  });
});

test('a tool that only a sibling frame owns is refused with a reason, never run here', async () => {
  const ownWindow = {};
  const sibling = { name: 'get_state', origin: ORIGIN, window: {}, label: 'SIBLING' };
  await withPage({ tools: [sibling], ownWindow }, async (calls) => {
    const result = await executeToolInPage('get_state', ORIGIN, '{}');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'tool-not-in-frame');
    assert.equal(calls.length, 0);
  });
});

test('when the runtime does not expose ownership, a unique candidate is accepted', async () => {
  const ownWindow = {};
  const only = { name: 'get_state', origin: ORIGIN, label: 'ONLY' };
  await withPage({ tools: [only], ownWindow }, async (calls) => {
    const result = await executeToolInPage('get_state', ORIGIN, '{}');
    assert.equal(result.ok, true);
    assert.strictEqual(calls[0], only);
  });
});

test('when the runtime does not expose ownership, several candidates are an explicit ambiguity', async () => {
  const ownWindow = {};
  const a = { name: 'get_state', origin: ORIGIN, label: 'A' };
  const b = { name: 'get_state', origin: ORIGIN, label: 'B' };
  await withPage({ tools: [a, b], ownWindow }, async (calls) => {
    const result = await executeToolInPage('get_state', ORIGIN, '{}');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ambiguous-tool');
    assert.match(result.error, /2 tools named "get_state"/);
    assert.equal(calls.length, 0);
  });
});

test('a name nobody registered is still reported as not found, with what is available', async () => {
  const ownWindow = {};
  const other = { name: 'other_tool', origin: ORIGIN, window: ownWindow, label: 'X' };
  await withPage({ tools: [other], ownWindow }, async () => {
    const result = await executeToolInPage('get_state', ORIGIN, '{}');
    assert.equal(result.code, 'tool-not-found');
    assert.deepEqual(result.available, ['other_tool']);
  });
});

// --- the agent must be able to address each instance ------------------------------------------

import { aliasTools } from '../src/core/agent/names.js';

test('two instances sharing a logical id get distinct aliases, each resolving to its own frame', () => {
  const a = { name: 'get_state', logicalId: 'same', instanceId: 'same@6', frameId: 6 };
  const b = { name: 'get_state', logicalId: 'same', instanceId: 'same@7', frameId: 7 };
  const { aliases, byAlias } = aliasTools([a, b]);
  assert.equal(aliases.size, 2);
  assert.notEqual(aliases.get('same@6'), aliases.get('same@7'));
  assert.equal(byAlias.get(aliases.get('same@6')).frameId, 6);
  assert.equal(byAlias.get(aliases.get('same@7')).frameId, 7);
});
