import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipe, recipeStep, recipeProblems, parseRecipe, recipeInputs,
  resolveRecipeArguments, reviewRecipeTarget, validateRecipeCall, recipeDefinitionText } from '../src/core/recipes.js';

const tool = (name, schema = {type:'object'}) => ({name,logicalId:name,origin:'https://shop.test',frameKey:'top',frameIndexPath:[],
  contractFp:'contract-'+name,offeredFp:'contract-'+name,frameId:0,inputSchema:schema});
function example() {
  const a=recipeStep(tool('search',{type:'object',properties:{query:{type:'string'}},required:['query']}),{query:''},{id:'search-step'});
  a.bindings=[{path:'/query',source:'input',input:'query'}];
  const b=recipeStep(tool('details',{type:'object',properties:{id:{type:'string'}},required:['id']}),{id:''},{id:'detail-step'});
  b.bindings=[{path:'/id',source:'step',stepId:a.id,pointer:'/products/0/id'}];
  return createRecipe({id:'recipe-1',name:'Find product',topOrigin:'https://shop.test',sourceUrl:'https://shop.test/catalogue',
    inputs:[{name:'query',defaultJson:'"jacket"'}],steps:[a,b],at:0});
}

test('a recipe definition round-trips independently of run data and resolves typed dependent calls', () => {
  const recipe=parseRecipe(recipeDefinitionText(example()));assert.deepEqual(recipeProblems(recipe),[]);
  const inputs=recipeInputs(recipe,{query:'"backpack"'});
  assert.deepEqual(resolveRecipeArguments(recipe.steps[0],inputs,[]),{query:'backpack'});
  const results=[{stepId:'search-step',outcome:{ok:true,result:'{"products":[{"id":"p-02"}]}'}}];
  assert.deepEqual(resolveRecipeArguments(recipe.steps[1],inputs,results),{id:'p-02'});
  assert.equal(JSON.stringify(recipe).includes('p-02'),false,'observed output is not stored in the definition');
});

test('forward references, unknown inputs, overlapping paths and invalid placeholders are rejected before execution', () => {
  for(const mutate of [
    r=>{r.steps[0].bindings=[{path:'/query',source:'step',stepId:'detail-step',pointer:'/id'}];},
    r=>{r.steps[0].bindings[0].input='missing';},
    r=>{r.steps[0].bindings.push({path:'',source:'input',input:'query'});},
    r=>{r.steps[0].bindings[0].path='/absent';},
    r=>{r.steps[1].bindings[0].pointer='/~broken';},
    r=>{r.steps[1].id=r.steps[0].id;},
  ]) {const r=example();mutate(r);assert(recipeProblems(r).length);}
});

test('missing, failed and truncated earlier output never becomes a guessed argument', () => {
  const r=example(),inputs=recipeInputs(r);
  for(const outcome of [{ok:true,result:'{"products":[]}'},{ok:false,error:'missing'},{ok:true,result:'{}',resultTruncated:true},{ok:true,result:'not JSON'}]) {
    assert.throws(()=>resolveRecipeArguments(r.steps[1],inputs,[{stepId:'search-step',outcome}]));
  }
  assert.throws(()=>recipeInputs(r,{query:'undefined'}));
  assert.throws(()=>recipeInputs(r,{other:'"x"'}));
});

test('binding preserves JSON types and escaped names without prototype setters', () => {
  const r=example();r.steps[1].argsJson='{"a/b":{"~n":null},"__proto__":null}';
  r.steps[1].bindings=[{path:'/a~1b/~0n',source:'step',stepId:'search-step',pointer:'/value'},
    {path:'/__proto__',source:'step',stepId:'search-step',pointer:'/flag'}];
  assert.deepEqual(recipeProblems(r),[]);
  const args=resolveRecipeArguments(r.steps[1],{},[{stepId:'search-step',outcome:{ok:true,result:'{"value":[false,null,0,""],"flag":{"marker":true}}'}}]);
  assert.deepEqual(args['a/b']['~n'],[false,null,0,'']);assert.deepEqual(args.__proto__,{marker:true});
  assert.equal(Object.getPrototypeOf(args),Object.prototype);assert.equal({}.marker,undefined);
});

test('numbers that cannot survive the existing argument transport are rejected without rounding', () => {
  const r=example();r.steps[1].bindings[0].pointer='/id';
  for(const number of ['9007199254740993','1e400','1.00000000000000001','1e-400']) {
    assert.throws(()=>resolveRecipeArguments(r.steps[1],{},[{stepId:'search-step',outcome:{ok:true,result:`{"id":${number}}`}}]),/cannot be preserved/);
  }
  assert.deepEqual(resolveRecipeArguments(r.steps[1],{},[{stepId:'search-step',outcome:{ok:true,result:'{"id":1.1}'}}]),{id:1.1});
});

test('target identity needs origin, exact frame position, unchanged contract and a current document', () => {
  const r=example(),step=r.steps[0];const discovery={tools:[tool('search')],frames:[{frameId:0,documentId:'doc-1'}]};
  const found=reviewRecipeTarget(step,discovery);assert.equal(found.documentId,'doc-1');
  for(const mutate of [d=>d.tools[0].origin='https://other.test',d=>d.tools.push({...d.tools[0]}),
    d=>d.tools[0].frameIndexPath=[1],d=>d.tools[0].contractFp='changed',d=>d.tools[0].offeredFp='overridden',
    d=>d.tools[0].disabled=true,d=>d.tools[0].frameId=null,d=>d.frames=[]]) {
    const changed=structuredClone(discovery);mutate(changed);assert(reviewRecipeTarget(step,changed).error);
  }
});

test('resolved arguments validate against the actual schema before a call', () => {
  const step=example().steps[0];const target={tool:tool('search',{type:'object',properties:{query:{type:'string'}},required:['query']}),documentId:'doc'};
  assert.throws(()=>validateRecipeCall(step,{query:3},target),/string/);
  assert.equal(validateRecipeCall(step,{query:'x'},target).documentId,'doc');
});

test('invalid/future/oversized imports remain data and fail validation', () => {
  const r=example();assert.throws(()=>parseRecipe(JSON.stringify({...r,version:2})),/version/);
  assert.throws(()=>parseRecipe('{"kind":"x","kind":"y"}'),/duplicate/);
  assert.throws(()=>parseRecipe(' '.repeat(200001)),/200000/);
  const tooMany={...r,steps:Array.from({length:21},(_,i)=>({...r.steps[0],id:'step-'+i}))};
  assert.match(recipeProblems(tooMany).join(' '),/20 steps/);
  r.steps[0].expect={kind:'fields',version:99,rules:[]};assert(recipeProblems(r).length);
  r.steps[0].expect={kind:'ok'};r.steps[0].argsJson='{"query":"$(run anything)"}';
  r.steps[0].bindings=[];assert.deepEqual(resolveRecipeArguments(r.steps[0],{},[]),{query:'$(run anything)'});
});
