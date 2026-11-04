import test from 'node:test';
import assert from 'node:assert/strict';
import {DIALECTS,getProvider} from '../src/core/agent/providers.js';
import {buildRequest,parseResponse} from '../src/core/agent/messages.js';
import {createRun,applyModelResponse,applyToolResults} from '../src/core/agent/loop.js';
const tool={name:'search',origin:'https://example.test',frameId:0,inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}};
function roundTrip(dialect,model,payload){let run=createRun({goal:'Find a laptop',tools:[tool],dialect});run=applyModelResponse(run,parseResponse(dialect,payload,model));run=applyToolResults(run,[{id:'c1',alias:'search',ok:true,text:'found'}]);return {run,request:buildRequest({dialect,model,transcript:run.transcript,declarations:run.declarations})};}
test('OpenAI uses Responses and preserves stateless tool-call continuity',()=>{
 const dialect=getProvider('openai').dialect;assert.equal(dialect,DIALECTS.openaiResponses);
 const output=[{type:'reasoning',id:'rs_1',summary:[],encrypted_content:'fixture-encrypted-context'},{type:'function_call',id:'fc_1',call_id:'c1',name:'search',arguments:'{"query":"laptop"}'}];
 const {request}=roundTrip(dialect,'gpt-6-astra',{output,status:'completed'});
 assert.equal(request.path,'/responses');assert.equal(request.body.store,false);assert.ok(!('temperature' in request.body));
 assert.equal(request.body.tools[0].name,'search');assert.equal(request.body.tools[0].strict,false);
 assert.deepEqual(request.body.input.slice(1,3),output);
 assert.equal(request.body.input.at(-1).call_id,'c1');assert.equal(request.body.input.at(-1).type,'function_call_output');
 const answer=parseResponse(dialect,{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Found it.'}]}],usage:{input_tokens:9,output_tokens:3}},'gpt-6-astra');
 assert.equal(answer.text,'Found it.');assert.deepEqual(answer.usage,{input:9,output:3});
});
test('Gemini tool results retain signed parts and the provider call id',()=>{
 const parts=[{text:'',thoughtSignature:'fixture-signature'},{functionCall:{id:'c1',name:'search',args:{query:'laptop'}},thoughtSignature:'fixture-tool-signature'}];
 const {run,request}=roundTrip(DIALECTS.geminiGenerate,'gemini-3.8-flash',{candidates:[{content:{parts},finishReason:'STOP'}]});
 assert.deepEqual(request.body.contents[1].parts,parts);assert.equal(request.body.contents[2].parts[0].functionResponse.id,'c1');
 const changed=buildRequest({dialect:DIALECTS.geminiGenerate,model:'another-model',transcript:run.transcript});
 assert.ok(!JSON.stringify(changed).includes('fixture-signature'));
});
test('Claude tool continuation retains signed thinking without showing it as the answer',()=>{
 const content=[{type:'thinking',thinking:'private fixture context',signature:'fixture-signature'},{type:'tool_use',id:'c1',name:'search',input:{query:'laptop'}}];
 const {request,run}=roundTrip(DIALECTS.anthropicMessages,'claude-opus-5',{content,stop_reason:'tool_use'});
 assert.deepEqual(request.body.messages[1].content,content);assert.ok(!('temperature' in request.body));
 assert.equal(run.transcript[1].text,'');
});
