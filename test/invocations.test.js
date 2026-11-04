import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvocationGuard } from '../src/storage/invocations.js';
function store() {
  const receipts = new Map();
  return { receipts, reserve: async r => {
    if (receipts.has(r.id)) return { fresh: false, record: receipts.get(r.id) };
    receipts.set(r.id, structuredClone(r)); return { fresh: true, record: r };
  }, complete: async () => {} };
}
const request = { callId: 'request-1', documentId: 'doc-1', toolName: 'pay', args: { amount: 1 } };
test('concurrent copies share a single dispatch; a restarted worker cannot replay it', async () => {
  const saved = store(), invoke = createInvocationGuard(saved); let count = 0;
  const pay = async () => { count++; await new Promise(r => setTimeout(r, 10)); return { ok: false, effectState: 'unknown' }; };
  const [a,b] = await Promise.all([invoke(request,pay),invoke(request,pay)]);
  assert.equal(count,1); assert.deepEqual(a,b);
  assert.equal((await createInvocationGuard(saved)(request,pay)).code,'already-invoked');
  assert.equal(count,1);
});
test('a different payload cannot reuse an id; history deletion does not remove the receipt', async () => {
  const saved=store(), invoke=createInvocationGuard(saved); let count=0;
  await invoke(request,async()=>{count++;return {ok:true};});
  assert.equal((await invoke({...request,args:{amount:2}},async()=>{count++;})).code,'request-conflict');
  assert.equal(saved.receipts.size,1); assert.equal(count,1);
});
test('reservation failure blocks dispatch, completion failure retains the tombstone', async () => {
  let count=0;
  const failing = createInvocationGuard({reserve:async()=>{throw Error('quota');}});
  assert.equal((await failing(request,()=>{count++;})).code,'reservation-failed'); assert.equal(count,0);
  const saved=store();saved.complete=async()=>{throw Error('disk');};
  const invoke=createInvocationGuard(saved);
  assert.equal((await invoke(request,async()=>{count++;return {ok:true};})).receiptError,true);
  await invoke(request,()=>{count++;});assert.equal(count,1);
});
