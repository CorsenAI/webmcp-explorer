import test from 'node:test';
import assert from 'node:assert/strict';
const granted=new Set(['https://a.test/*','https://b.test/*']);
globalThis.chrome={runtime:{id:'own',sendMessage:async()=>{}},permissions:{contains:async({origins})=>origins.every(o=>granted.has(o))},tabs:{get:async id=>({url:id===1?'https://a.test/':'https://b.test/'})}};
const {receiveLiveEvent,recordLiveEvent,revalidateLiveOrigins,timelineFor,forgetTab}=await import('../src/background/live.js');
const sender={id:'own',tab:{id:1,url:'https://a.test/'},origin:'https://a.test',url:'https://a.test/',frameId:0,documentId:'doc-a'};
test('page claims need both current top-level and frame grants; a revoked interval is not replayed',async()=>{
 await receiveLiveEvent({kind:'snapshot',names:[]},sender);
 await receiveLiveEvent({kind:'snapshot',names:['before']},sender);
 assert.equal(timelineFor(1).list({}).length,1);
 granted.delete('https://a.test/*');
 assert.deepEqual(await receiveLiveEvent({kind:'activated',toolName:'forbidden'},sender),[]);
 granted.add('https://a.test/*');
 await receiveLiveEvent({kind:'snapshot',names:['before','during-gap']},sender);
 assert.equal(timelineFor(1).list({}).length,1);
 await receiveLiveEvent({kind:'snapshot',names:['before','during-gap','after']},sender);
 assert.equal(timelineFor(1).list({}).length,2);
 assert.deepEqual(await receiveLiveEvent({kind:'activated',toolName:'spoof'},{...sender,id:'another'}),[]);
 forgetTab(1);
});
test('revoking A rebases A without dropping B lifecycle changes',async()=>{
 for(const [id,origin] of [[1,'https://a.test'],[2,'https://b.test']])recordLiveEvent(id,0,{kind:'snapshot',names:[],origin,doc:'d'+id});
 granted.delete('https://a.test/*');await revalidateLiveOrigins();
 recordLiveEvent(1,0,{kind:'snapshot',names:['during-gap'],origin:'https://a.test',doc:'d1'});
 recordLiveEvent(2,0,{kind:'snapshot',names:['allowed'],origin:'https://b.test',doc:'d2'});
 assert.equal(timelineFor(1).list({}).length,0);assert.equal(timelineFor(2).list({}).length,1);
 granted.add('https://a.test/*');forgetTab(1);forgetTab(2);
});
