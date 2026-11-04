import test from 'node:test';import assert from 'node:assert/strict';
import {configureBridge,loadBridgeConfig,bridgeClientConfig,updateBridgeConfig,resetBridgeConfig} from '../src/storage/bridge.js';
const area=()=>{let data={},fail=false;return {fail(value){fail=value},get:async k=>structuredClone({[k]:data[k]}),setAccessLevel:async v=>{assert.equal(v.accessLevel,'TRUSTED_CONTEXTS')},set:async value=>{if(fail)throw Error('simulated quota failure');Object.assign(data,structuredClone(value));}};};
test('pairing is session-only, explicit, secret-free when disabled and cleared by reset',async()=>{
 const session=area();globalThis.chrome={storage:{session}};
 assert.equal((await loadBridgeConfig()).enabled,false);await assert.rejects(bridgeClientConfig('a'.repeat(32)));
 const c=await configureBridge({enabled:true,autoReadOnly:true,port:19071});assert.match(c.token,/^[0-9a-f]{64}$/);
 const exported=await bridgeClientConfig('a'.repeat(32));assert.equal(exported.mcpServers['webmcp-explorer'].env.WEBMCP_BRIDGE_TOKEN===c.token,true);
 await resetBridgeConfig();const reset=await loadBridgeConfig();assert.equal(reset.enabled,false);assert.equal(reset.token,null);assert.equal(reset.autoReadOnly,false);
 assert.equal((await configureBridge({enabled:true})).token===c.token,false);
});
test('write failure rejects before callers can dispatch; serialized marker writes retain every active id',async()=>{
 const session=area();globalThis.chrome={storage:{session}};
 await configureBridge({enabled:true});session.fail(true);let dispatched=0;
 await assert.rejects(updateBridgeConfig(c=>({...c,inflight:['one']})).then(()=>dispatched++),/quota/);assert.equal(dispatched,0);
 session.fail(false);await Promise.all(['one','two','three'].map(id=>updateBridgeConfig(c=>({...c,inflight:[...c.inflight,id]}))));
 assert.deepEqual((await loadBridgeConfig()).inflight,['one','two','three']);await resetBridgeConfig(true);assert.equal((await loadBridgeConfig()).blocked,true);
});

test('the exported Node command requires a local absolute path and separates options',async()=>{
 globalThis.chrome={storage:{session:area()}};
 for(const path of ['--eval=process.exit()','relative/cli.mjs','https://example.test/cli.mjs','//server/share/cli.mjs','\\\\server\\share\\cli.mjs'])await assert.rejects(configureBridge({companionPath:path}));
 await configureBridge({enabled:true,companionPath:'/local/companion/cli.mjs'});
 assert.deepEqual((await bridgeClientConfig('a'.repeat(32))).mcpServers['webmcp-explorer'].args,['--','/local/companion/cli.mjs']);
 await configureBridge({companionPath:'C:\\local\\cli.mjs'});assert.equal((await loadBridgeConfig()).companionPath,'C:\\local\\cli.mjs');
});
