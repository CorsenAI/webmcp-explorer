import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { jsData, jsonText } from '../src/core/export/safe.js';
import { playwrightSpec, recipeSpec } from '../src/core/export/playwright.js';
import { consoleSnippet } from '../src/core/export/repro.js';
const hostile = 'x\n";globalThis.injected=1;//` ${globalThis.injected=2}</script>\u2028\u2029\u202e\u200b\u061c\u180e\u034f'+String.fromCodePoint(0xe0001);
const tool={name:hostile,title:hostile,description:hostile,origin:'http://localhost:8777',frameId:0,frameKey:'top',runtimeId:'document',inputSchema:JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'),annotations:{readOnlyHint:true}};
const page={url:'http://localhost:8777/phase-d.html'};
const planOf=code=>JSON.parse(JSON.stringify(vm.runInNewContext(code.match(/^const PLAN = (.*);$/m)[1],{JSON})));
test('all hostile data roundtrips through JSON without source delimiters or prototype rewriting',()=>{
 const value={...tool,args:{text:hostile}};const expression=jsData(value);
 assert.doesNotMatch(expression, /<\/script>|`|\$|[\u034f\u2028\u2029\p{Cf}]/u);
 assert.equal(JSON.stringify(vm.runInNewContext(expression,{JSON})),JSON.stringify(value));
 assert.equal(Object.hasOwn(JSON.parse(jsonText(value)).inputSchema.properties,'__proto__'),true);
});
test('loading a generated spec registers one inert test: metadata never becomes code',()=>{
 const spec=playwrightSpec({tool,args:{text:hostile},page,outcome:{ok:true,result:hostile}});
 let registrations=0;const stub=()=>registrations++;stub.describe={configure:()=>{}};
 const stripped=stripTypeScriptTypes(spec).replace(/^import .*;$/gm,'');
 const context={test:stub,expect:()=>{},chromium:{},JSON,Buffer,process:{env:{}},injected:0};
 vm.runInNewContext(stripped,context);assert.equal(context.injected,0);assert.equal(registrations,1);
 const plan=planOf(spec);assert.equal(plan.steps[0].name,hostile);assert.equal(plan.steps[0].args.text,hostile);
 assert.ok(Object.hasOwn(plan.steps[0].schema.properties,'__proto__'));
 assert.match(spec,/retries: 0/);assert.match(spec,/'wx'/);assert.doesNotMatch(spec,/expect\.poll|toPass\(/);
});
test('recipe export retains bindings and contracts; old/incomplete or mocked evidence fails closed',()=>{
 const definition={kind:'webmcp-explorer/recipe',version:1,id:'r',name:hostile,sourceUrl:page.url,topOrigin:tool.origin,inputs:[{name:'q',defaultJson:'"safe"'}],steps:[
  {id:'one',tool:{name:tool.name,logicalId:'a',origin:tool.origin,frameKey:'top',frameIndexPath:[],contractFp:'fp',offeredFp:'fp'},argsJson:'{}',bindings:[],expect:{kind:'ok'}},
  {id:'two',tool:{name:tool.name,logicalId:'a',origin:tool.origin,frameKey:'top',frameIndexPath:[],contractFp:'fp',offeredFp:'fp'},argsJson:'{"text":""}',bindings:[{source:'step',stepId:'one',pointer:'/id',path:'/text'}],expect:{kind:'equals',value:hostile}},
 ]};
 const code=recipeSpec({definition,tools:[{...tool,logicalId:'a',contractFp:'fp'}]});const plan=planOf(code);
 assert.equal(plan.steps.length,2);assert.equal(plan.steps[1].bindings[0].pointer,'/id');assert.deepEqual(plan.blocked,[]);
 const missing=planOf(recipeSpec({run:{definition,results:[]}}));assert.ok(missing.blocked.length);
 const mocked=planOf(playwrightSpec({tool,args:{},page,outcome:{ok:true,result:'fake',mocked:true}}));assert.ok(mocked.blocked.length);
});
test('console comments and data literals cannot escape from metadata, including page URL and browser strings',()=>{
 const code=consoleSnippet({tool,args:{text:hostile},page:{url:hostile},frame:{isTopLevel:false,url:hostile}});
 assert.doesNotMatch(code, /<\/script>|[\u2028\u2029\u202e\u200b]/);
 new vm.Script(code);
 const injectedLines=code.split('\n').filter(l=>l.startsWith('";globalThis'));
 assert.equal(injectedLines.length,0);
});
