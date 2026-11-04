import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {reproReport,consoleSnippet,playwrightSpec,REGISTRATION_WAIT_MS,registerToolSnippet,scriptToolConfig} from '../src/core/export/repro.js';
const AT=Date.parse('2026-09-11T10:00:00.000Z');
const tool=(over={})=>({name:'search_products',origin:'http://localhost:8777',frameId:0,logicalId:'lid',contractFp:'fp-1',description:'Search the catalogue.',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']},...over});
const page={url:'http://localhost:8777/basic.html',topOrigin:'http://localhost:8777'};
const browser={userAgent:'Mozilla/5.0 HeadlessChrome/153.0.0.0',product:'Chrome/153.0.8010.36'};
const data=(code,name)=>JSON.parse(JSON.stringify(vm.runInNewContext(code.match(new RegExp('^\\s*const '+name+' = (JSON\\.parse\\(.*\\));$','m'))[1],{JSON})));
function helpers(spec){
 const t=()=>{};t.describe={configure:()=>{}};
 const context={test:t,JSON,expect:value=>({toBe:expected=>assert.equal(value,expected),toEqual:expected=>assert.deepEqual(value,expected)})};
 vm.createContext(context);vm.runInContext(stripTypeScriptTypes(spec).replace(/^import .*;$/gm,'')+'\nglobalThis.helpers={assertOutput,pickFrame,exact,compare,argumentsFor};',context);return context.helpers;
}
test('a top-level successful call preserves context, outputs and standalone v2 data',()=>{
 const r=reproReport({tool:tool(),args:{query:'jacket'},outcome:{ok:true,result:'{"items":[]}',durationMs:12,roundTripMs:20,argsEncoding:'string',startedAt:AT-1000},page,browser,extensionVersion:'1.1.0',at:AT});
 assert.equal(r.json.kind,'webmcp-explorer/reproduction');assert.equal(r.json.version,2);assert.equal(r.json.frame.top,true);assert.equal(r.json.outcome.mocked,false);
 assert.match(r.markdown,/^# Reproduce ` search_products ` on ` http:\/\/localhost:8777\/basic\.html `/);
 assert.match(r.markdown,/the tool registered by the top-level document/);assert.match(r.markdown,/succeeded in 12 ms/);
 assert.equal(data(r.console,'name'),'search_products');assert.deepEqual(data(r.console,'args'),{query:'jacket'});
 assert.match(r.console,/t\.window === undefined \? same\.length === 1 : t\.window === window/);
 assert.match(r.console,new RegExp('Date\\.now\\(\\) \\+ '+REGISTRATION_WAIT_MS));assert.match(r.console,/will not pick one at random/);
 const p=data(r.playwright,'PLAN');assert.equal(p.url,page.url);assert.deepEqual(p.steps[0].expect,{kind:'recorded',ok:true,result:'{"items":[]}',error:null});
 assert.match(r.playwright,/launchPersistentContext/);assert.match(r.playwright,/--enable-blink-features=WebMCP,DeclarativeWebMCP/);
 assert.equal(r.filename,'webmcp-reproduce_search-products_2026-09-11_10-00-00');assert.doesNotMatch(JSON.stringify(r.json),/apiKey|api_key|Bearer/);
});
test('an iframe preserves its exact recorded frame in both exports',()=>{
 const frame={origin:'http://localhost:8777',url:'http://localhost:8777/child-same.html',indexPath:[0],isTopLevel:false};
 const r=reproReport({tool:tool({name:'child_same_tool',frameId:3}),args:{},outcome:{ok:true,result:'x'},page,frame,at:AT});
 assert.equal(r.json.frame.top,false);assert.equal(r.json.frame.frameId,3);assert.equal(data(r.console,'recordedFrame').url,frame.url);
 assert.deepEqual(data(r.playwright,'PLAN').steps[0].frame,{top:false,url:frame.url,indexPath:[0]});
 assert.match(r.playwright,/f\.url\(\) === spec\.frame\.url/);assert.match(r.playwright,/childFrames\(\)\[index\]/);
});
test('twin frame routing refuses a changed position even when only one matching URL remains',async()=>{
 const t=tool({name:'bump',frameId:12,frameUrl:'http://localhost:8777/twin.html',frameIndexPath:[1],frameKey:'http://localhost:8777/twin.html'});
 const r=reproReport({tool:t,args:{},outcome:{ok:true,result:'{"count":1}'},page,at:AT});
 assert.deepEqual(data(r.console,'recordedFrame').indexPath,[1]);const p=data(r.playwright,'PLAN');assert.deepEqual(p.steps[0].frame.indexPath,[1]);
 const frame={url:()=>t.frameUrl},main={childFrames:()=>[frame]};const {pickFrame}=helpers(r.playwright);
 await assert.rejects(pickFrame({mainFrame:()=>main,frames:()=>[main,frame]},p.steps[0]),/position changed/);
 const second={url:()=>t.frameUrl};main.childFrames=()=>[frame,second];assert.equal(await pickFrame({mainFrame:()=>main,frames:()=>[main,frame,second]},p.steps[0]),second);
});
test('a failed call records and checks its exact error',()=>{
 const r=reproReport({tool:tool({name:'add_to_cart'}),args:{productId:'p2'},outcome:{ok:false,code:'tool-threw',error:'Out of stock',durationMs:3},page,at:AT});
 assert.equal(r.json.outcome.ok,false);assert.match(r.markdown,/What happened: failed after 3 ms/);
 assert.deepEqual(data(r.playwright,'PLAN').steps[0].expect,{kind:'recorded',ok:false,result:null,error:'Out of stock'});
});
test('mocked and overridden evidence stays attached and cannot silently call the real site in a test',()=>{
 const override={logicalId:'lid',enabled:true,mock:{mode:'success',result:'{"mocked":true}'}};
 const r=reproReport({tool:tool(),args:{},outcome:{ok:true,result:'fake',mocked:true,mockMode:'success'},override,page,at:AT});
 assert.equal(r.json.outcome.mocked,true);assert.deepEqual(r.json.override.override.mock,override.mock);
 assert.match(r.json.preconditions[0],/came from a local override/);assert.match(r.markdown,/served by the override, not by the page/);
 assert.ok(data(r.playwright,'PLAN').blocked.length);assert.match(r.playwright,/expect\(PLAN.blocked/);
});
test('cancelled and uncertain navigation evidence stays honest; unreachable frames remain a precondition',()=>{
 assert.match(reproReport({tool:tool(),args:{},outcome:{ok:false,cancelled:true},page,at:AT}).markdown,/cancelled from Explorer/);
 assert.match(reproReport({tool:tool(),args:{},outcome:{ok:true,result:null,navigated:true},page,at:AT}).markdown,/navigation or another unknown effect/);
 assert.match(reproReport({tool:tool({notInjected:true,frameId:null}),args:{},outcome:null,page,at:AT}).json.preconditions[0],/could not enter the frame/);
});
test('generated assertions compare JSON exactly, distinguish failures and reject duplicate members',()=>{
 const {assertOutput}=helpers(playwrightSpec({tool:tool(),args:{},page}));
 assert.doesNotThrow(()=>assertOutput({kind:'recorded',ok:true,result:'{"a":1.0}'},{ok:true,result:'{"a":1}'}));
 assert.throws(()=>assertOutput({kind:'recorded',ok:true,result:'{"a":1}'},{ok:true,result:'{"a":2}'}));
 assert.throws(()=>assertOutput({kind:'recorded',ok:false,error:'x'},{ok:true,result:'fine'}));
 assert.throws(()=>assertOutput({kind:'recorded',ok:false,error:'x'},{ok:false,error:'y'}));
 assert.doesNotThrow(()=>assertOutput({kind:'recorded',ok:false,error:'x'},{ok:false,error:'x'}));
 assert.throws(()=>assertOutput({kind:'recorded',ok:true,result:'{"n":9007199254740992}'},{ok:true,result:'{"n":9007199254740993}'}));
 assert.throws(()=>assertOutput({kind:'recorded',ok:true,result:'{"a":1,"a":2}'},{ok:true,result:'{"a":1,"a":2}'}),/duplicate/);
 assert.doesNotThrow(()=>assertOutput({kind:'ok'},{ok:true,result:'r'}));assert.throws(()=>assertOutput({kind:'ok'},{ok:false,error:'e'}));
});
test('both exports select before invocation and never retry a business call',()=>{
 const c=consoleSnippet({tool:tool(),args:{},page}),p=playwrightSpec({tool:tool(),args:{},page});
 assert.match(c,/typeof tool.inputSchema === "string"/);assert.equal((c.match(/await mc\.executeTool\(/g)??[]).length,1);
 assert.match(p,/from '@playwright\/test'/);assert.match(p,/retries: 0/);assert.match(p,/openSync\(join\(receipts, receipt\), 'wx'/);
 assert.equal((p.match(/await x\.mc\.executeTool\(/g)??[]).length,1);assert.doesNotMatch(p,/expect\.poll|toPass\(/);
});
test('authoring contracts use safe data and the modern namespace without losing annotations',()=>{
 const t=tool({annotations:{readOnlyHint:true}});const cfg=JSON.parse(scriptToolConfig(t));assert.equal(cfg.name,t.name);assert.equal(cfg.description,t.description);assert.deepEqual(cfg.annotations,t.annotations);
 const source=registerToolSnippet(t);assert.deepEqual(data(source,'descriptor'),cfg);assert.match(source,/document\.modelContext \?\? navigator\.modelContext/);assert.match(source,/async execute\(input\)/);
});
