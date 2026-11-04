import test from 'node:test';
import assert from 'node:assert/strict';
const area=()=>{
 const data={};return {data,get:async k=>({[k]:structuredClone(data[k])}),set:async v=>Object.assign(data,structuredClone(v)),
 remove:async keys=>{for(const k of [keys].flat())delete data[k];},setAccessLevel:async()=>{}};
};
const local=area(),session=area();globalThis.chrome={storage:{local,session},runtime:{getURL:()=> 'chrome-extension://fixture/'}};
const {keyVault}=await import('../src/storage/key-vault.js');
const {callModel}=await import('../src/background/agent-transport.js');
const {saveAgentConfig}=await import('../src/storage/agent-config.js');
test('only an unlocked vault supplies the provider header; a locked required key sends no request',async t=>{
 const vault=keyVault(),seen=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{seen.push(options.headers);return new Response(JSON.stringify({output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'fixture'}]}]}));});
 await vault.setKey('openai','synthetic-transport-credential');await vault.create('synthetic passphrase for test');
 const input={config:{providerId:'openai',model:'fixture'},run:{transcript:[{role:'user',text:'fixture'}],declarations:[]}};
 await callModel(input);assert.equal(seen.length,1);assert.equal(new Headers(seen[0]).get('authorization'),'Bearer synthetic-transport-credential');
 await vault.lock();const locked=await callModel(input);assert.equal(locked.ok,false);assert.equal(seen.length,1);
 assert.match(locked.error,/Unlock the vault/);assert.equal(JSON.stringify(local.data).includes('synthetic-transport-credential'),false);
});
test('config writes cannot persist keys, passphrases or vault material',async()=>{
 await saveAgentConfig({providerId:'openai',apiKey:'secret',key:'secret',passphrase:'secret',masterPassphrase:'secret',ciphertext:'secret'});
 for(const key of ['apiKey','key','passphrase','masterPassphrase','ciphertext'])assert.equal(local.data.agentConfig[key],undefined);
});
