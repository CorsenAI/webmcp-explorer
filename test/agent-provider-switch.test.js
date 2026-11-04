import test from 'node:test';
import assert from 'node:assert/strict';
import { saveAgentConfig } from '../src/storage/agent-config.js';
import { providerBaseUrl, getProvider } from '../src/core/agent/providers.js';
import { callModel, listModels } from '../src/background/agent-transport.js';
function storage(t, config) {
  const previous = globalThis.chrome;
  const data = { agentConfig: structuredClone(config) };
  globalThis.chrome = { storage: {
    local: { get: async k => ({ [k]: data[k] }), set: async v => Object.assign(data, structuredClone(v)) },
    session: { get: async () => ({ agentKeys: { openai: 'fixture-token' } }) },
  } };
  t.after(() => { globalThis.chrome = previous; });
  return data;
}
test('switching provider resets its endpoint and model; same-provider edits retain them', async t => {
  storage(t, { providerId:'openai-compatible',baseUrl:'http://localhost:8999/v1',model:'local' });
  const changed = await saveAgentConfig({providerId:'ollama'});
  assert.equal(changed.baseUrl,''); assert.equal(changed.model,'');
  await saveAgentConfig({baseUrl:'http://localhost:11435/v1',model:'qwen3:0.6b'});
  const same = await saveAgentConfig({maxSteps:2});
  assert.equal(same.baseUrl,'http://localhost:11435/v1'); assert.equal(same.model,'qwen3:0.6b');
  const explicit = await saveAgentConfig({providerId:'openai-compatible',baseUrl:'https://example.test/v1',model:'other'});
  assert.equal(explicit.baseUrl,'https://example.test/v1');
});
test('fixed-provider configuration discards an inherited or explicit custom base URL', async t => {
  storage(t, {providerId:'ollama',baseUrl:'http://localhost:11434/v1',model:'local'});
  const changed = await saveAgentConfig({providerId:'openai',baseUrl:'https://old.example/v1',model:'model'});
  assert.equal(changed.baseUrl,'');
  assert.equal(providerBaseUrl(getProvider('openai'),'https://old.example/v1'),'https://api.openai.com/v1');
});
test('model calls and listings ignore stale custom URLs for fixed providers', async t => {
  storage(t, {}); const requests=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    requests.push({url,headers:options.headers});
    return {ok:true,text:async()=>JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'done'}]}],status:'completed'}),json:async()=>({data:[{id:'model'}]})};
  });
  const config={providerId:'openai',baseUrl:'https://old.example/v1',model:'model'};
  const out=await callModel({config,run:{transcript:[],declarations:[]}});
  assert.equal(out.ok,true);
  assert.equal((await listModels(config)).ok,true);
  assert.deepEqual(requests.map(r=>r.url),['https://api.openai.com/v1/responses','https://api.openai.com/v1/models']);
  assert.ok(requests.every(r=>r.headers.authorization==='Bearer fixture-token'));
});
