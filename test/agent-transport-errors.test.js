import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel, listModels } from '../src/background/agent-transport.js';

test('an empty Ollama 403 gives the extension-specific remedy for calls and model listing', async t => {
  const previous = globalThis.chrome;
  globalThis.chrome = { runtime:{getURL:()=> 'chrome-extension://fixture-id/'} };
  t.after(()=> { globalThis.chrome = previous; });
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:403}));
  const config = {providerId:'ollama',model:'model'};
  for (const out of [await callModel({config,run:{transcript:[],declarations:[]}}),await listModels(config)]) {
    assert.equal(out.ok,false);
    assert.equal(out.status,403);
    assert.match(out.error,/OLLAMA_ORIGINS.*chrome-extension:\/\/fixture-id/);
    assert.match(out.error,/restart Ollama/);
    assert.doesNotMatch(out.error,/Is Ollama running/);
  }
});

test('provider error bodies survive model listing, including a non-JSON refusal', async t => {
  t.mock.method(globalThis,'fetch',async()=>new Response('Gateway maintenance',{status:503}));
  const out=await listModels({providerId:'ollama'});
  assert.equal(out.status,503);
  assert.equal(out.error,'Gateway maintenance');
});

test('a successful non-JSON model list is reported as an invalid response',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('Not a model list'));
  const out=await listModels({providerId:'ollama'});
  assert.equal(out.ok,false);
  assert.match(out.error,/not JSON/);
});

test('an LM Studio 403 names the documented CORS switch, for calls and model listing', async t => {
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:403}));
  const config = {providerId:'lmstudio',model:'model'};
  for (const out of [await callModel({config,run:{transcript:[],declarations:[]}}),await listModels(config)]) {
    assert.equal(out.ok,false);
    assert.equal(out.status,403);
    assert.match(out.error,/turn on CORS/);
    assert.match(out.error,/lms server start --cors/);
  }
});
