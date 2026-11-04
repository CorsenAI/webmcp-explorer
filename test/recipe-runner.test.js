import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipeRunner } from '../src/background/recipe-runner.js';
import { createRecipeStorage } from '../src/storage/recipes.js';
import { createRecipe, recipeStep } from '../src/core/recipes.js';
import { journalRun, interruptedRecipe, keepRecipeRuns } from '../src/core/recipe-journal.js';
import { recipeRunMarkdown } from '../src/core/export/recipe.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const waitFor = async check => {
  for (let i=0;i<100;i++) { if(check()) return; await new Promise(r=>setTimeout(r,2)); }
  assert.fail('Expected runner state did not settle');
};

function harness() {
  const tool = name => ({ name, logicalId:name, origin:'https://shop.test', frameKey:'top',
    frameIndexPath:[], frameId:0, instanceId:name+'@0', contractFp:'contract', offeredFp:'contract',
    inputSchema:{ type:'object', properties:{ query:{type:'string'} }, required:['query'] } });
  const first=recipeStep(tool('search'),{query:'jacket'},{id:'first'});
  const second=recipeStep(tool('details'),{query:''},{id:'second'});
  second.bindings=[{path:'/query',source:'step',stepId:'first',pointer:'/id'}];
  const recipe=createRecipe({ name:'Dependent calls', topOrigin:'https://shop.test', sourceUrl:'https://shop.test/catalogue', steps:[first,second] });
  const state = { page:{url:'https://shop.test/catalogue'}, discovery:{ topOrigin:'https://shop.test',
    tools:[tool('search'),tool('details')], frames:[{frameId:0,documentId:'doc-1'}] },
    calls:[], writes:[], events:[], overrides:[], holds:0, cancel:[],
    execute:async()=>({ok:true,result:'{"id":"p-01"}'}), save:async()=>{} };
  const io = {
    tab:async()=>structuredClone(state.page), discover:async()=>structuredClone(state.discovery),
    overrides:async()=>structuredClone(state.overrides),
    save:async run=>{ await state.save(run); state.writes.push(structuredClone(run)); },
    publish:run=>state.events.push(run), hold:()=>{state.holds++;return()=>state.holds--;}, record:()=>{},
    execute:async(tabId,call)=>{
      assert.equal(state.writes.at(-1).pending.callId,call.callId,'call ID is durable before execution');
      state.calls.push(call);return state.execute(call);
    }, cancel:async(_,id)=>{state.cancel.push(id);},
  };
  const runner=createRecipeRunner(io);
  const review=()=>runner.review({tabId:1,recipe});
  const start=async(mode='all')=>runner.start({tabId:1,token:(await review()).token,mode});
  return {state,runner,recipe,review,start};
}

test('dependent steps are sequential, typed, document-pinned and journaled before invocation', async()=>{
  const h=harness();await h.start();await waitFor(()=>h.runner.state(1)?.status==='completed');
  assert.equal(h.state.calls.length,2);assert.deepEqual(h.state.calls[1].args,{query:'p-01'});
  assert.equal(h.state.calls[0].documentId,'doc-1');assert.equal(h.state.holds,0);
  assert.equal(h.runner.state(1).results.length,2);
});

test('Run next, explicit pause and remaining do not repeat a completed action', async()=>{
  const h=harness();await h.start('next');await waitFor(()=>h.runner.state(1)?.status==='paused');
  assert.equal(h.state.calls.length,1);assert.equal(h.state.holds,0);
  await h.runner.continue(1,'all');await waitFor(()=>h.runner.state(1)?.status==='completed');
  assert.equal(h.state.calls.length,2);
  await assert.rejects(h.runner.continue(1,'all'),/cannot resume/);
  const k=harness(), pending=deferred();k.state.execute=()=>pending.promise;
  await k.start();await waitFor(()=>k.state.calls.length===1);
  await k.runner.pause(1);pending.resolve({ok:true,result:'{"id":"p-02"}'});
  await waitFor(()=>k.runner.state(1)?.status==='paused');assert.equal(k.state.calls.length,1);
  await k.runner.stop(1);assert.equal(k.runner.state(1).status,'stopped');
});

test('double start/continue cannot produce concurrent or duplicated steps', async()=>{
  const h=harness(), gate=deferred();h.state.execute=()=>gate.promise;
  const review=await h.review();
  const attempts=await Promise.allSettled([h.runner.start({tabId:1,token:review.token}),h.runner.start({tabId:1,token:review.token})]);
  assert.equal(attempts.filter(item=>item.status==='fulfilled').length,1);
  await waitFor(()=>h.state.calls.length===1);await h.runner.pause(1);gate.resolve({ok:true,result:'{"id":"p"}'});
  await waitFor(()=>h.runner.state(1)?.status==='paused');
  const more=await Promise.allSettled([h.runner.continue(1,'all'),h.runner.continue(1,'all')]);
  assert.equal(more.filter(item=>item.status==='fulfilled').length,1);
  await waitFor(()=>h.runner.state(1)?.status==='completed');assert.equal(h.state.calls.length,2);
});

test('failure, check failure, cancellation and missing references stop before the dependent call', async()=>{
  for(const outcome of [{ok:false,error:'page failure'},{ok:false,cancelled:true,code:'cancelled'},
    {ok:true,result:'{"id":null}'},{ok:true,result:'{}'}]) {
    const h=harness();h.state.execute=async()=>outcome;await h.start();
    await waitFor(()=>['failed','stopped'].includes(h.runner.state(1)?.status));assert.equal(h.state.calls.length,1);
  }
  const h=harness();h.recipe.steps[0].expect={kind:'fields',version:1,rules:[{path:'/id',op:'equals',value:'"different"'}]};
  await h.start();await waitFor(()=>h.runner.state(1)?.status==='failed');
  assert.equal(h.state.calls.length,1);assert.equal(h.runner.state(1).results[0].check.verdict,'fail');
});

test('stop during an applied but unanswered call retains its answer and starts no later step', async()=>{
  const h=harness(), pending=deferred();h.state.execute=()=>pending.promise;
  await h.start();await waitFor(()=>h.state.calls.length===1);
  await h.runner.stop(1);assert.equal(h.state.cancel.length,1);
  pending.resolve({ok:true,result:'{"id":"already-applied"}'});
  await waitFor(()=>h.runner.state(1)?.status==='stopped');
  assert.equal(h.runner.state(1).results[0].outcome.ok,true);assert.equal(h.state.calls.length,1);
});

test('page, document, permissions, contract and mock changes invalidate review/continuation', async()=>{
  for(const mutate of [
    h=>{h.state.page.url='https://other.test';},
    h=>{h.state.discovery.frames[0].documentId='replacement';},
    h=>{h.state.discovery.tools=[];},
    h=>{h.state.discovery.tools[1].contractFp='changed';},
    h=>{h.state.overrides=[{logicalId:'details',enabled:true,mock:{mode:'success',result:'changed'}}];},
  ]) {
    const h=harness(), review=await h.review();mutate(h);
    await assert.rejects(h.runner.start({tabId:1,token:review.token}));assert.equal(h.state.calls.length,0);
    const k=harness();await k.start('next');await waitFor(()=>k.runner.state(1)?.status==='paused');
    mutate(k);await k.runner.continue(1,'all');await waitFor(()=>k.runner.state(1)?.status==='failed');
    assert.equal(k.state.calls.length,1);
  }
});

test('a failed durable write before invocation prevents the action; recovery never drives a stored run', async()=>{
  const h=harness();h.state.save=async run=>{if(run.pending)throw Error('quota exceeded');};
  await h.start();await waitFor(()=>h.runner.state(1)?.status==='interrupted');
  assert.equal(h.state.calls.length,0);assert.match(h.runner.state(1).reason,/quota/);
  const k=harness();const running={id:'old',tabId:1,status:'running',results:[],pending:{callId:'possibly-applied'}};
  assert.deepEqual(await k.runner.recover([running]),{recipesInterrupted:1});
  assert.equal(k.state.writes[0].status,'interrupted');assert.equal(k.state.writes[0].pending.outcomeUnknown,true);
  assert.equal(k.state.calls.length,0);await assert.rejects(k.runner.continue(1,'all'),/cannot resume/);
});

test('execution exceptions are reported as uncertain calls rather than storage failures', async()=>{
  const h=harness();h.state.execute=async()=>{throw Error('lost connection');};await h.start();
  await waitFor(()=>h.runner.state(1)?.status==='failed');
  assert.equal(h.runner.state(1).results[0].outcome.code,'execution-interrupted');
  assert.match(h.runner.state(1).reason,/lost connection/);assert.doesNotMatch(h.runner.state(1).reason,/could not be saved/);
});

test('a complete live result can supply a field beyond the stored excerpt; post-call storage failure never repeats it', async()=>{
  const h=harness();h.state.execute=async()=>({ok:true,result:JSON.stringify({padding:'x'.repeat(25000),id:'after-excerpt'})});
  await h.start();await waitFor(()=>h.runner.state(1)?.status==='completed');
  assert.equal(h.state.calls[1].args.query,'after-excerpt');
  assert.equal(h.runner.state(1).results[0].outcome.resultTruncated,true);
  const k=harness();k.state.save=async run=>{if(run.results.length)throw Error('disk unavailable after action');};
  await k.start();await waitFor(()=>k.runner.state(1)?.status==='interrupted');
  assert.equal(k.state.calls.length,1);assert(k.runner.state(1).pending);
  assert.match(k.runner.state(1).reason,/after action/);
});

test('run reports preserve mock/check/uncertainty facts and allow selected raw-data sections to be omitted',()=>{
  const run={id:'run',name:'Test',pageUrl:'https://shop.test',status:'interrupted',reason:'Worker stopped',
    inputValues:{query:'private-input'},overrides:[{logicalId:'x',mock:{mode:'success'}}],
    results:[{index:0,name:'search',args:{q:'private-input'},outcome:{ok:true,mocked:true,result:'raw-payload ```',resultTruncated:true,resultLength:30000},check:{verdict:'pass',reason:'matched'},unchecked:[]}],
    pending:{index:1,callId:'uncertain',args:{q:'private-input'}}};
  const full=recipeRunMarkdown(run);assert.match(full,/local mock/);assert.match(full,/30000 characters/);assert.match(full,/may have happened/);
  const reduced=recipeRunMarkdown(run,{includeArguments:false,includeResults:false});
  assert.doesNotMatch(reduced,/private-input|raw-payload/);assert.match(reduced,/omitted by the exporter/);
  assert.match(reduced,/still contain data echoed in checks, overrides or errors/);
  assert.match(full,/````\nraw-payload ```\n````/,'page-supplied fences cannot end the raw-result block');
});

test('bounded journals mark excerpts, retain active runs and never evict definitions silently', async()=>{
  const run={id:'r',status:'completed',results:[{outcome:{ok:true,result:'a'.repeat(30000)}}]};
  const small=journalRun(run);assert.equal(small.results[0].outcome.resultTruncated,true);
  assert.equal(small.results[0].outcome.resultLength,30000);assert.equal(run.results[0].outcome.result.length,30000);
  const prior=Array.from({length:8},(_,i)=>({id:String(i),status:i===7?'completed':'paused'}));
  assert.equal(keepRecipeRuns(prior,{id:'next',status:'ready'}).some(r=>r.id==='7'),false);
  assert.throws(()=>keepRecipeRuns(prior.map(r=>({...r,status:'paused'})),{id:'next',status:'ready'}),/limit/);
  assert.equal(interruptedRecipe({...run,status:'paused'}).status,'interrupted');
  const data={},store=createRecipeStorage({get:async key=>({[key]:structuredClone(data[key])}),set:async patch=>Object.assign(data,structuredClone(patch))});
  const h=harness();await Promise.all([store.save(h.recipe),store.save({...h.recipe,id:'another'})]);
  assert.equal((await store.definitions()).length,2);
  await store.writeRun({id:'active',status:'running',results:[]});await assert.rejects(store.clear(),/Stop/);
  for(let i=0;i<28;i++)await store.save({...h.recipe,id:'recipe-'+i});
  await assert.rejects(store.save({...h.recipe,id:'last'}),/30 definitions/);assert.equal((await store.definitions()).length,30);
});
