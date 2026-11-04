import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel, listModels } from '../src/background/agent-transport.js';
import { resolveProvider } from '../src/storage/custom-connectors.js';
import { DIALECTS, getProvider } from '../src/core/agent/providers.js';

// What each provider must see on the wire. Anthropic refuses any request that carries a browser
// Origin (an extension service worker sends one) unless it opts in with
// `anthropic-dangerous-direct-browser-access: true`: "CORS requests must set
// 'anthropic-dangerous-direct-browser-access' header" (live refusal, 2026-10-20, Explorer 2.1.0).

function withChrome(t, keys = {}, local = {}) {
  const previous = globalThis.chrome;
  globalThis.chrome = {
    runtime: { getURL: () => 'chrome-extension://fixture-id/' },
    storage: { session: { get: async () => ({ agentKeys: keys }) }, local: { get: async () => local } },
  };
  t.after(() => { globalThis.chrome = previous; });
}

function capture(t, body = {}) {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    seen.push({ url: String(url), headers: { ...(init.headers ?? {}) } });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return seen;
}

const run = { transcript: [{ role: 'user', text: 'hello' }], declarations: [] };

test('Anthropic: messages and model listing opt in to direct browser access', async t => {
  withChrome(t, { anthropic: 'sk-ant-fixture' });
  const seen = capture(t, { content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', data: [] });
  await callModel({ config: { providerId: 'anthropic', model: 'claude-sonnet-5-5' }, run });
  await listModels({ providerId: 'anthropic' });
  assert.equal(seen.length, 2);
  for (const req of seen) {
    assert.match(req.url, /^https:\/\/api\.anthropic\.com\/v1\/(messages|models)/);
    assert.equal(req.headers['anthropic-dangerous-direct-browser-access'], 'true');
    assert.equal(req.headers['anthropic-version'], '2023-06-01');
    assert.equal(req.headers['x-api-key'], 'sk-ant-fixture');
  }
});

test('a custom connector speaking the Anthropic dialect sends the same opt-in', async t => {
  withChrome(t, {}, { customProviders: [
    { id: 'c1', label: 'Gateway', dialect: DIALECTS.anthropicMessages, baseUrl: 'https://gateway.example/v1', keyRequired: true },
  ] });
  const provider = await resolveProvider('custom:c1');
  assert.equal(provider.extraHeaders['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(provider.extraHeaders['anthropic-version'], '2023-06-01');
});

test('the catalogue keeps the opt-in where it belongs: Anthropic only', () => {
  assert.equal(getProvider('anthropic').extraHeaders['anthropic-dangerous-direct-browser-access'], 'true');
  for (const id of ['openai', 'gemini', 'openrouter', 'ollama', 'lmstudio', 'openai-compatible']) {
    assert.equal(getProvider(id).extraHeaders?.['anthropic-dangerous-direct-browser-access'], undefined, id);
  }
});
