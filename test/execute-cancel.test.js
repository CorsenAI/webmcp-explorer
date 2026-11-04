import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { invocationStore } from '../src/storage/invocations.js';
const receipts = new Map();
mock.method(invocationStore, 'reserve', async record => {
  if (receipts.has(record.id)) return { fresh: false, record: receipts.get(record.id) };
  receipts.set(record.id, record); return { fresh: true, record };
});
mock.method(invocationStore, 'complete', async () => {});

// The service-worker side of a cancellation: the page's controller is aborted through a second
// injection, and a page that does not answer any more is settled from here. chrome.* is stood
// up just far enough for background/execute.js to run; history writes fail (no IndexedDB) and
// are recorded as historyError, which is the behaviour the module promises.

const injections = [];
let pageBehaviour = null;
let cancelBehaviour = () => ({ found: false });

const listeners = { updated: new Set(), removed: new Set() };
globalThis.chrome = {
  runtime: { onConnect: { addListener() {} }, sendMessage: async () => {} },
  storage: { local: { get: async () => ({}), set: async () => {} } },
  tabs: {
    onUpdated: { addListener: (f) => listeners.updated.add(f), removeListener: (f) => listeners.updated.delete(f) },
    onRemoved: { addListener: (f) => listeners.removed.add(f), removeListener: (f) => listeners.removed.delete(f) },
  },
  scripting: {
    executeScript: async ({ target, func, args }) => {
      injections.push({ target, name: func.name, args });
      if (func.name === 'identifyExecutionDocument') return [{ documentId: 'document-test', result: null }];
      if (func.name === 'cancelToolInPage') return [{ result: cancelBehaviour(args[0]) }];
      return [{ result: await pageBehaviour(args) }];
    },
  },
};

const { runTool, cancelTool, inflightCallIds, CANCELLED } = await import('../src/background/execute.js');

const call = (callId) => ({
  frameId: 0, toolName: 'slow', origin: 'http://a.test', args: { ms: 5000 },
  tool: { logicalId: 'lid', name: 'slow' }, topOrigin: 'http://a.test', callId,
});

test('a page that confirms the abort settles the call itself, with the in-page duration', {timeout:5000}, async () => {
  injections.length = 0;
  let release = null;
  const dispatched = Promise.withResolvers();
  pageBehaviour = () => new Promise((resolve) => { release = resolve; dispatched.resolve(); });
  cancelBehaviour = () => {
    // The runtime settles the injection with the page-side cancelled outcome.
    release({ ok: false, code: 'cancelled', cancelled: true, durationMs: 412 });
    return { found: true };
  };

  const pending = runTool(7, call('c-1'));
  await dispatched.promise;
  assert.deepEqual(inflightCallIds(), ['c-1']);

  cancelTool(7, 'c-1'); // not awaited: it waits out a grace period the page does not need
  const out = await pending;
  assert.equal(out.code, 'cancelled');
  assert.equal(out.durationMs, 412, 'the page\'s own measurement wins when it answers');
  assert.equal(out.callId, 'c-1');
  assert.equal(typeof out.roundTripMs, 'number');
  assert.deepEqual(inflightCallIds(), []);

  const abort = injections.find((i) => i.name === 'cancelToolInPage');
  assert.ok(abort, 'the page-side controller was aborted');
  assert.deepEqual(abort.target, { tabId: 7, documentIds: ['document-test'] });
  assert.deepEqual(abort.args, ['c-1']);
});

test('a page that no longer answers is settled from the worker as cancelled', {timeout:5000}, async () => {
  injections.length = 0;
  const dispatched = Promise.withResolvers();
  pageBehaviour = () => { dispatched.resolve(); return new Promise(() => {}); }; // never settles, like a page mid-navigation
  cancelBehaviour = () => ({ found: false });

  const pending = runTool(7, call('c-2'));
  await dispatched.promise;
  const verdict = await cancelTool(7, 'c-2');
  assert.deepEqual(verdict, { cancelled: true, inPage: false });
  const out = await pending;
  assert.equal(out.code, 'cancelled');
  assert.equal(out.durationMs, null, 'no in-page measurement exists for a call the page never settled');
  assert.equal(out.error, CANCELLED.error);
  assert.deepEqual(inflightCallIds(), []);
});

test('cancelling a call that is not in flight is refused, not invented', async () => {
  assert.deepEqual(await cancelTool(7, 'nope'), { cancelled: false, reason: 'not-in-flight' });
});

test('a call that ends normally is forgotten and gets its id back', async () => {
  pageBehaviour = async () => ({ ok: true, result: 'done', durationMs: 3 });
  const out = await runTool(7, { ...call(undefined), args: {} });
  assert.equal(out.ok, true);
  assert.equal(typeof out.callId, 'string', 'an id is issued when the caller gave none');
  assert.deepEqual(inflightCallIds(), []);
});
test('cancellation while pinning or reserving a document prevents dispatch and later replay',async()=>{
  let dispatched=0;pageBehaviour=async()=>{dispatched++;return {ok:true,result:'charged'};};
  const request=call('cancel-before-dispatch');
  const pending=runTool(7,request);
  assert.equal((await cancelTool(7,request.callId)).cancelled,true);
  const out=await pending;assert.equal(out.cancelled,true);assert.equal(out.attempts,0);assert.equal(dispatched,0);
  assert.equal((await runTool(7,request)).code,'already-invoked');assert.equal(dispatched,0);
});
