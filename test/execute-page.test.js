import test from 'node:test';
import assert from 'node:assert/strict';

// page/execute.js is written to be injected into a page's main world, so it only reaches for
// globals a page has. Those are stood up here, with a fake modelContext whose executeTool
// behaves like the one measured on Chrome 152 and 153 (tools/probe-platform.mjs): a JSON
// string in, a string out, and an AbortError the moment the signal aborts.

globalThis.window = globalThis;
globalThis.location = { origin: 'http://a.test' };

const { executeToolInPage, cancelToolInPage } = await import('../src/page/execute.js');

function runtime(behaviour, tools) {
  const list = tools ?? [{ name: 'search', origin: 'http://a.test', window: globalThis, inputSchema: '{"type":"object"}' }];
  const calls = [];
  globalThis.document = {
    modelContext: {
      getTools: async () => list,
      executeTool: (tool, args, options) => {
        calls.push({ args, hasSignal: Boolean(options?.signal) });
        return behaviour(tool, args, options);
      },
    },
  };
  return calls;
}

const abortError = () => new DOMException('signal is aborted without reason', 'AbortError');

// Chrome's behaviour: settle with AbortError on abort, whatever the tool does.
function chromeLike(work) {
  return (tool, args, options) => new Promise((resolve, reject) => {
    const signal = options?.signal;
    if (signal?.aborted) { reject(abortError()); return; }
    signal?.addEventListener('abort', () => reject(abortError()), { once: true });
    work(args).then(resolve, reject);
  });
}

test('arguments go as a JSON string, the way Chrome 152 and 153 take them', async () => {
  const calls = runtime(chromeLike(async (args) => `got:${args}`));
  const out = await executeToolInPage('search', 'http://a.test', '{"q":"x"}', 'call-1');
  assert.equal(out.ok, true);
  assert.equal(out.result, 'got:{"q":"x"}');
  assert.equal(out.argsEncoding, 'string');
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0].args, 'string');
  assert.equal(calls[0].hasSignal, true, 'a signal is always passed, so the call can be cancelled');
});

test('a runtime that hands the schema back as an object gets the arguments as an object, first time', async () => {
  // What the specification describes (RegisteredTool.inputSchema typed object, executeTool step 9).
  const specTools = [{ name: 'search', origin: 'http://a.test', window: globalThis, inputSchema: { type: 'object' } }];
  const calls = runtime(chromeLike(async (args) => {
    if (typeof args !== 'object') throw new TypeError('step 9: input is not an Object');
    return JSON.stringify(args);
  }), specTools);
  const out = await executeToolInPage('search', 'http://a.test', '{"q":"x"}', 'call-spec');
  assert.equal(out.ok, true);
  assert.equal(out.result, '{"q":"x"}');
  assert.equal(out.argsEncoding, 'object');
  assert.equal(calls.length, 1, 'chosen before the call, not found by failing first');
  assert.equal(typeof calls[0].args, 'object');
});

test('a schema given back as a string means the string form, whatever the specification says', async () => {
  const chromeTools = [{ name: 'search', origin: 'http://a.test', window: globalThis, inputSchema: '{"type":"object"}' }];
  const calls = runtime(chromeLike(async (args) => `got:${typeof args}`), chromeTools);
  const out = await executeToolInPage('search', 'http://a.test', '{"q":"x"}', 'call-chrome');
  assert.equal(out.argsEncoding, 'string');
  assert.equal(out.result, 'got:string');
  assert.equal(calls.length, 1);
});

test('a binding-looking TypeError on the object form is never retried', async () => {
  const specTools = [{ name: 'search', origin: 'http://a.test', window: globalThis, inputSchema: { type: 'object' } }];
  const calls = runtime(chromeLike(async (args) => {
    if (typeof args === 'object') throw new TypeError("Failed to execute 'executeTool' on 'ModelContext': parameter 2 is not of type 'DOMString'.");
    throw new TypeError("Failed to execute 'executeTool' on 'ModelContext': still no");
  }), specTools);
  const out = await executeToolInPage('search', 'http://a.test', '{"q":"x"}', 'call-both');
  assert.equal(out.ok, false);
  assert.equal(out.code, 'tool-threw');
  assert.equal(out.argsEncoding, 'object');
  assert.equal(calls.length, 1, 'no retry after dispatch');
});

for (const asynchronous of [false, true]) {
  for (const message of ['receipt failed after debit', "Failed to execute 'executeTool' on 'ModelContext': receipt failed after debit"]) {
    test(`pay debits once then throws (${asynchronous ? 'async' : 'sync'}): ${message}`, async () => {
      let counter = 0;
      function pay() { counter += 1; throw new TypeError(message); }
      const calls = runtime(asynchronous ? async () => pay() : () => pay(), [
        { name: 'pay', origin: 'http://a.test', window: globalThis, inputSchema: '{"type":"object"}' },
      ]);
      const out = await executeToolInPage('pay', 'http://a.test', '{}', `pay-${asynchronous}-${message}`);
      assert.equal(counter, 1);
      assert.equal(calls.length, 1);
      assert.equal(out.code, 'tool-threw');
      assert.equal(out.dispatchState, 'dispatched');
      assert.equal(out.effectState, 'unknown');
      assert.equal(out.attempts, 1);
    });
  }
}

test('a TypeError thrown by the tool itself is a tool failure, never retried', async () => {
  const calls = runtime(chromeLike(async () => { throw new TypeError('boom inside the tool'); }));
  const out = await executeToolInPage('search', 'http://a.test', '{}', 'call-3');
  assert.equal(out.ok, false);
  assert.equal(out.code, 'tool-threw');
  assert.match(out.error, /boom inside/);
  assert.equal(calls.length, 1, 'a tool that ran must not be run again');
});

test('invalid JSON is refused before dispatch', async () => {
  const calls = runtime(chromeLike(async () => {
    const e = new Error('Failed to parse input arguments');
    e.name = 'UnknownError';
    throw e;
  }));
  const out = await executeToolInPage('search', 'http://a.test', '{not json', 'call-4');
  assert.equal(out.code, 'invalid-arguments');
  assert.equal(calls.length, 0);
});

test('cancelToolInPage aborts the in-flight call, which settles as cancelled and is forgotten', async () => {
  runtime(chromeLike(() => new Promise(() => {})));
  const pending = executeToolInPage('search', 'http://a.test', '{}', 'call-5');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(cancelToolInPage('call-5'), { found: true });
  const out = await pending;
  assert.equal(out.ok, false);
  assert.equal(out.code, 'cancelled');
  assert.equal(out.cancelled, true);
  assert.equal(typeof out.durationMs, 'number');
  assert.deepEqual(cancelToolInPage('call-5'), { found: false }, 'settled calls leave the registry');
});

test('cancelling an unknown call id says so instead of aborting something else', () => {
  assert.deepEqual(cancelToolInPage('never-started'), { found: false });
});

test('the registry on window is not enumerable, so a page does not see it in a for-in', async () => {
  runtime(chromeLike(async () => 'x'));
  await executeToolInPage('search', 'http://a.test', '{}', 'call-6');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__webmcpExplorerCalls');
  assert.ok(descriptor);
  assert.equal(descriptor.enumerable, false);
});

test('a null result is reported as null with the navigation flag, as before', async () => {
  runtime(chromeLike(async () => null));
  const out = await executeToolInPage('search', 'http://a.test', '{}', 'call-7');
  assert.equal(out.ok, true);
  assert.equal(out.result, null);
  assert.equal(out.navigated, true);
});

test('a missing call id still runs, and just cannot be cancelled from outside', async () => {
  const calls = runtime(chromeLike(async () => 'fine'));
  const out = await executeToolInPage('search', 'http://a.test', '{}');
  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
});
test('completed page receipts retain no result or argument payload',async()=>{
  runtime(chromeLike(async()=> 'large-result-'.repeat(20000)));
  const out=await executeToolInPage('search','http://a.test','{"private":"fixture"}','bounded-receipt');
  assert.equal(out.ok,true);assert.ok(out.result.length>200000);
  const receipt=window.__webmcpExplorerReceipts.get('bounded-receipt');
  assert.equal(receipt.identity,null);assert.equal((await receipt.promise).result,undefined);
});
test('a direct callback ignoring its signal is released on cancellation without a second call',async t=>{
  let counter=0;
  globalThis.document={modelContext:{getTools:async()=>[{name:'pay',window:globalThis,origin:'http://a.test',inputSchema:{type:'object'}}]}};
  globalThis.__webmcpExplorerHook={execute:()=>{counter++;return new Promise(()=>{});}};
  t.after(()=>{delete globalThis.__webmcpExplorerHook;});
  const pending=executeToolInPage('pay','http://a.test','{}','direct-cancel');
  await new Promise(r=>setImmediate(r));assert.equal(counter,1);
  assert.equal(cancelToolInPage('direct-cancel').found,true);
  const out=await pending;assert.equal(out.cancelled,true);assert.equal(out.effectState,'unknown');
  assert.equal(counter,1);assert.equal(cancelToolInPage('direct-cancel').found,false);
});

test('bridge-reviewed metadata is checked against the chosen RegisteredTool before dispatch', async () => {
  const t={name:'search',origin:'http://a.test',window:globalThis,title:'changed',description:'Read',inputSchema:{type:'object'},annotations:{readOnlyHint:true}};
  const calls=runtime(async()=> 'once',[t]);
  const { bridgeMetadata }=await import('../src/core/bridge/policy.js');
  const expected={runtimeId:'document',engine:'native',argsEncoding:'object',reviewedMetadata:bridgeMetadata({...t,title:'approved'})};
  const refused=await executeToolInPage('search','http://a.test','{}','bridge-meta-changed',expected);
  assert.equal(refused.code,'reviewed-contract-changed');assert.equal(calls.length,0);
  expected.reviewedMetadata=bridgeMetadata(t);
  const accepted=await executeToolInPage('search','http://a.test','{}','bridge-meta-current',expected);
  assert.equal(accepted.ok,true);assert.equal(calls.length,1);
});
