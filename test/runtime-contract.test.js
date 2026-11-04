import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRuntimeContract } from '../src/core/runtime-contract.js';
test('qualified wire shapes are chosen before invocation',()=>{
  assert.equal(selectRuntimeContract({schemaEncoding:'string'}).argsEncoding,'string');
  assert.equal(selectRuntimeContract({schemaEncoding:'object'}).argsEncoding,'object');
  assert.equal(selectRuntimeContract({schemaEncoding:'number'}),null);
  assert.equal(selectRuntimeContract({schemaEncoding:'object',refused:true}),null);
  assert.equal(selectRuntimeContract({inventoryOnly:true}),null);
});
test('direct is selected only if the executor is absent and a callback was captured',()=>{
  assert.equal(selectRuntimeContract({hasExecute:false,captured:true,runtimeId:'navigator'}).engine,'direct');
  assert.equal(selectRuntimeContract({hasExecute:false}),null);
  assert.equal(selectRuntimeContract({schemaEncoding:'object',captured:true}).engine,'native');
});
test('omitted schemas use the separately qualified execute arity, never a failed call',()=>{
  assert.equal(selectRuntimeContract({schemaEncoding:'missing',executeArity:1}).argsEncoding,'object');
  assert.equal(selectRuntimeContract({schemaEncoding:'missing',executeArity:2}).argsEncoding,'string');
  assert.equal(selectRuntimeContract({schemaEncoding:'missing',executeArity:0}),null);
  assert.equal(selectRuntimeContract({schemaEncoding:'number',executeArity:1}),null);
});
