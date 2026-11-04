import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { invocationStore } from '../src/storage/invocations.js';
const receipts=new Map();
mock.method(invocationStore,'reserve',async r=>{if(receipts.has(r.id))return {fresh:false,record:receipts.get(r.id)};receipts.set(r.id,r);return {fresh:true,record:r};});
mock.method(invocationStore,'complete',async()=>{});

// The service-worker side of a declarative form that waits for a person (form-wait.js). chrome.* is stood up just far
// enough for background/agent.js and background/evals.js to run: storage in memory, a page whose tool never answers
// until its call is aborted — what Chrome 155 and 157 do for a form without toolautosubmit (measured 2026-10-21) —
// and a scripted OpenAI-compatible provider. History writes fail (no IndexedDB) and are recorded as historyError.

const areas = { local: new Map(), session: new Map() };
const area = (map) => ({
  get: async (keys) => {
    if (keys == null) return Object.fromEntries(map);
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    return Object.fromEntries(list.filter((k) => map.has(k)).map((k) => [k, structuredClone(map.get(k))]));
  },
  set: async (items) => { for (const [k, v] of Object.entries(items)) map.set(k, structuredClone(v)); },
  remove: async (keys) => { for (const k of [].concat(keys)) map.delete(k); },
});

const messages = [];
const injections = [];
const pending = new Map();
let onPageDispatch = () => {};
globalThis.chrome = {
  runtime: {
    onConnect: { addListener() {} },
    sendMessage: async (msg) => { messages.push(structuredClone(msg)); },
    getPlatformInfo: async () => ({}),
    getURL: () => 'chrome-extension://fixture-id/',
  },
  storage: { local: area(areas.local), session: area(areas.session) },
  tabs: { onUpdated: { addListener() {}, removeListener() {} }, onRemoved: { addListener() {}, removeListener() {} } },
  scripting: {
    executeScript: async ({ func, args }) => {
      injections.push(func.name);
      if (func.name === 'identifyExecutionDocument') return [{documentId:'form-document',result:null}];
      if (func.name === 'executeToolInPage') {
        // The form is filled in and waits: nothing settles until the call is aborted.
        return new Promise((resolve) => { pending.set(args[3], resolve); onPageDispatch(); });
      }
      if (func.name === 'cancelToolInPage') {
        const resolve = pending.get(args[0]);
        pending.delete(args[0]);
        resolve?.([{ result: { ok: false, code: 'cancelled', cancelled: true, durationMs: 1 } }]);
        return [{ result: { found: Boolean(resolve) } }];
      }
      return [{ result: null }];
    },
  },
};

// First turn: call the form. Later turns: answer with what the tool said.
const seen = [];
globalThis.fetch = async (url, init = {}) => {
  const body = JSON.parse(init.body ?? '{}');
  seen.push(body);
  const tool = body.messages?.filter((m) => m.role === 'tool').at(-1);
  const message = tool
    ? { role: 'assistant', content: `The tool said: ${tool.content}` }
    : { role: 'assistant', content: null, tool_calls: [{ id: 'k1', type: 'function',
      function: { name: 'subscribe_newsletter', arguments: '{"email":"dev@example.test"}' } }] };
  return new Response(JSON.stringify({ choices: [{ message, finish_reason: tool ? 'stop' : 'tool_calls' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
};

areas.local.set('agentConfig', { providerId: 'openai-compatible', baseUrl: 'http://localhost:8777/mock/v1',
  model: 'mock-1', maxSteps: 3, maxToolCalls: 3 });

const { runAgentOnce, startAgent, agentRun, cancelAgent } = await import('../src/background/agent.js');
const { runSuite, cancelEvals } = await import('../src/background/evals.js');
const { FORM_NOT_SUBMITTED } = await import('../src/core/agent/form-wait.js');

const TOOLS = [{ name: 'subscribe_newsletter', description: 'Subscribe an email address to the newsletter.',
  inputSchema: { type: 'object', properties: { email: { type: 'string' } } }, schemaError: null,
  origin: 'http://localhost:8777', frameId: 0, notInjected: false, logicalId: 'decl-1', registrationType: 'declarative' }];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Each test has a timeout: the defect they cover is a wait that never ends, which must fail rather than hang.
test('an unattended run stops waiting for an unsubmitted form, cancels it on the page and tells the model', { timeout: 10000 }, async () => {
  injections.length = 0;
  seen.length = 0;
  const startedAt = Date.now();
  const { run } = await runAgentOnce({ tabId: 1, goal: 'subscribe me', tools: TOOLS, topOrigin: 'http://localhost:8777',
    formWaitMs: 120 });
  assert.ok(Date.now() - startedAt < 4000, 'the run ends instead of waiting for a person');
  assert.ok(injections.includes('cancelToolInPage'), 'the call was aborted in the page, which releases the form');
  const result = run.transcript.find((e) => e.role === 'tool');
  assert.equal(result.ok, false);
  assert.match(result.text, /waited for a person to press its submit button/);
  assert.equal(seen.length, 1, 'an uncertain cancellation is not sent back to the model for another attempt');
  assert.equal(run.status, 'interrupted');
  assert.equal(run.doneReason, 'interrupted');
  assert.ok(FORM_NOT_SUBMITTED);
});

test('Agent Lab, with a person in front of it, keeps waiting for the form and says so; Cancel ends the wait', { timeout: 10000 }, async () => {
  injections.length = 0;
  messages.length = 0;
  await startAgent({ tabId: 2, goal: 'subscribe me', tools: TOOLS, topOrigin: 'http://localhost:8777' });
  await wait(300);
  assert.equal(agentRun(2).status, 'running-tools', 'still waiting: nobody submitted the form');
  assert.ok(!injections.includes('cancelToolInPage'), 'no limit is applied when a person can submit');
  const published = messages.filter((m) => m.type === 'agent-update' && m.tabId === 2).at(-1);
  assert.equal(published.run.byAlias.subscribe_newsletter.declarative, true, 'the panel can tell it is a form');
  const out = cancelAgent(2);
  assert.equal(out.cancelled, true);
  await wait(50);
  assert.ok(injections.includes('cancelToolInPage'), 'Cancel aborts the waiting call in the page');
  assert.equal(agentRun(2).status, 'cancelled');
});

test('Evals: the progress names the form being waited on, and Cancel stops the attempt in flight', { timeout: 10000 }, async () => {
  injections.length = 0;
  messages.length = 0;
  const dispatched=Promise.withResolvers();onPageDispatch=dispatched.resolve;
  const suite = { id: 's1', name: 'Forms', cases: [{ id: 'c1', goal: 'subscribe me', expectTool: 'subscribe_newsletter',
    expectFirst: false, forbidTools: [], repeat: 3 }] };
  const running = runSuite({ tabId: 3, suite, tools: TOOLS, topOrigin: 'http://localhost:8777' });
  let waitingOn = null;
  for (let i = 0; i < 40 && !waitingOn; i += 1) {
    await wait(25);
    waitingOn = messages.filter((m) => m.type === 'evals-update' && m.tabId === 3)
      .map((m) => m.progress.awaitingForms).find((names) => names?.length) ?? null;
  }
  assert.deepEqual(waitingOn, ['subscribe_newsletter'], 'the screen can say which form is waiting');
  // Progress is published before the async invocation reservation. On a slower host,
  // cancelling there correctly prevents dispatch; this case specifically tests an in-page wait.
  await dispatched.promise;onPageDispatch=()=>{};
  assert.equal(pending.size,1,'the page is actually waiting before Cancel is clicked');
  const clickedAt = Date.now();
  assert.equal(cancelEvals(3).cancelled, true);
  const { result } = await running;
  assert.ok(Date.now() - clickedAt < 4000, 'the suite stops now, not after an attempt that never ends');
  assert.ok(injections.includes('cancelToolInPage'), 'the waiting call was aborted in the page');
  assert.equal(result.cancelled, true);
  assert.equal(result.cases[0].attempts, 1, 'no further attempt was started');
  assert.equal(result.cases[0].cancelled, 1, 'the attempt in flight is recorded as cancelled, not as a failure');
  assert.equal(result.cases[0].passRate, null);
});
