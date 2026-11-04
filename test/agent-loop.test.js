import test from 'node:test';
import assert from 'node:assert/strict';

import { DIALECTS } from '../src/core/agent/providers.js';
import {
  createRun, nextAction, applyModelResponse, applyToolResults, cancelRun, failRun,
  interruptRun, isFinished, markCallingModel, finalText, runStats, STATUS, DONE_REASON,
} from '../src/core/agent/loop.js';

const tool = (over = {}) => ({
  name: 'search_products',
  description: 'Search the catalogue',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  schemaError: null,
  origin: 'http://localhost:8777',
  frameId: 0,
  notInjected: false,
  logicalId: 'id-1',
  ...over,
});

const start = (over = {}) => createRun({
  goal: 'find a laptop', tools: [tool()], dialect: DIALECTS.openaiChat, ...over,
});

const modelCalls = (calls) => ({ text: '', calls, stop: 'tool_calls', usage: null });

test('a new run opens with the goal as the first turn', () => {
  const run = start();
  assert.deepEqual(run.transcript, [{ role: 'user', text: 'find a laptop' }]);
  assert.equal(run.status, STATUS.ready);
  assert.deepEqual(nextAction(run), { kind: 'call-model' });
});

test('a continued session replays the prior transcript before the new goal', () => {
  const prior = [
    { role: 'user', text: 'find a laptop' },
    { role: 'assistant', text: 'found 3', calls: [] },
    { role: 'user', text: 'add the cheapest' },
  ];
  const run = start({ prior, goal: 'now clear the cart' });
  assert.deepEqual(run.transcript, [
    ...prior,
    { role: 'user', text: 'now clear the cart' },
  ]);
  // The continued run is a normal run: the model is asked next, and the answer appends.
  assert.deepEqual(nextAction(run), { kind: 'call-model' });
  const answered = applyModelResponse(run, { text: 'cleared', calls: [] });
  assert.equal(answered.status, STATUS.done);
  assert.equal(finalText(answered), 'cleared');
});

test('a fresh run without prior history is unchanged', () => {
  assert.deepEqual(start().transcript, [{ role: 'user', text: 'find a laptop' }]);
});

test('the tool lookup survives structuredClone across the message boundary', () => {
  const run = start();
  const cloned = structuredClone(run);
  assert.deepEqual(cloned.byAlias, run.byAlias);
  assert.equal(cloned.byAlias.search_products.logicalId, 'id-1');
});

test('a text answer with no tool call ends the run', () => {
  const run = applyModelResponse(start(), { text: 'The MacBook is cheapest.', calls: [] });
  assert.equal(run.status, STATUS.done);
  assert.equal(run.doneReason, DONE_REASON.answered);
  assert.equal(finalText(run), 'The MacBook is cheapest.');
  assert.deepEqual(nextAction(run), { kind: 'done', reason: DONE_REASON.answered });
});

test('a tool call becomes work for the caller, resolved to a real tool', () => {
  const run = applyModelResponse(start(),
    modelCalls([{ id: 'c1', alias: 'search_products', args: { q: 'mac' } }]));
  const action = nextAction(run);
  assert.equal(action.kind, 'run-tools');
  assert.equal(action.calls[0].target.logicalId, 'id-1');
  assert.equal(action.calls[0].target.frameId, 0);
  assert.deepEqual(action.calls[0].args, { q: 'mac' });
});

test('a result comes back as a tool turn and the loop asks the model again', () => {
  let run = applyModelResponse(start(),
    modelCalls([{ id: 'c1', alias: 'search_products', args: { q: 'mac' } }]));
  run = applyToolResults(run, [{ id: 'c1', ok: true, result: '{"products":["MacBook"]}' }]);
  const last = run.transcript[run.transcript.length - 1];
  assert.equal(last.role, 'tool');
  assert.equal(last.text, '{"products":["MacBook"]}');
  assert.equal(run.toolCalls, 1);
  assert.deepEqual(nextAction(run), { kind: 'call-model' });
});

test('a tool the page does not have is answered, not crashed on', () => {
  const run = applyModelResponse(start(),
    modelCalls([{ id: 'c1', alias: 'no_such_tool', args: {} }]));
  const last = run.transcript[run.transcript.length - 1];
  assert.equal(last.role, 'tool');
  assert.equal(last.ok, false);
  assert.match(last.text, /No tool named no_such_tool/);
  assert.deepEqual(nextAction(run), { kind: 'call-model' });
});

test('unreadable arguments are handed back so the model can retry', () => {
  const run = applyModelResponse(start(), modelCalls([{
    id: 'c1', alias: 'search_products', args: {}, argsError: 'arguments are not valid JSON',
  }]));
  const last = run.transcript[run.transcript.length - 1];
  assert.equal(last.ok, false);
  assert.match(last.text, /could not be read/);
  assert.equal(run.toolCalls, 0);
  assert.deepEqual(nextAction(run), { kind: 'call-model' });
});

test('a failed tool result reaches the model as text it can act on', () => {
  let run = applyModelResponse(start(),
    modelCalls([{ id: 'c1', alias: 'search_products', args: {} }]));
  run = applyToolResults(run, [{ id: 'c1', ok: false, error: 'Upstream is down' }]);
  const last = run.transcript[run.transcript.length - 1];
  assert.equal(last.ok, false);
  assert.equal(last.text, 'Error: Upstream is down');
});

test('a non-string result is serialised rather than dropped', () => {
  let run = applyModelResponse(start(),
    modelCalls([{ id: 'c1', alias: 'search_products', args: {} }]));
  run = applyToolResults(run, [{ id: 'c1', ok: true, result: { products: [1] } }]);
  assert.equal(run.transcript[run.transcript.length - 1].text, '{"products":[1]}');
});

test('results are ordered the way the model asked, whatever order they arrive in', () => {
  let run = applyModelResponse(start(), modelCalls([
    { id: 'c1', alias: 'search_products', args: {} },
    { id: 'c2', alias: 'search_products', args: {} },
  ]));
  run = applyToolResults(run, [
    { id: 'c2', ok: true, result: 'second' },
    { id: 'c1', ok: true, result: 'first' },
  ]);
  const texts = run.transcript.filter((e) => e.role === 'tool').map((e) => e.text);
  assert.deepEqual(texts, ['first', 'second']);
});

test('a call the caller never answered is recorded rather than lost', () => {
  let run = applyModelResponse(start(), modelCalls([
    { id: 'c1', alias: 'search_products', args: {} },
    { id: 'c2', alias: 'search_products', args: {} },
  ]));
  run = applyToolResults(run, [{ id: 'c1', ok: true, result: 'first' }]);
  const last = run.transcript[run.transcript.length - 1];
  assert.equal(last.ok, false);
  assert.match(last.text, /did not run/);
});

test('the step limit stops the loop instead of looping forever', () => {
  let run = start({ maxSteps: 2 });
  for (let i = 0; i < 2; i += 1) {
    run = applyModelResponse(run,
      modelCalls([{ id: `c${i}`, alias: 'search_products', args: {} }]));
    run = applyToolResults(run, [{ id: `c${i}`, ok: true, result: 'x' }]);
  }
  assert.equal(run.steps, 2);
  assert.deepEqual(nextAction(run), { kind: 'done', reason: DONE_REASON.stepLimit });
});

test('the tool-call budget stops a run that keeps calling tools', () => {
  const run = applyModelResponse(start({ maxToolCalls: 1 }), modelCalls([
    { id: 'c1', alias: 'search_products', args: {} },
    { id: 'c2', alias: 'search_products', args: {} },
  ]));
  assert.equal(run.status, STATUS.done);
  assert.equal(run.doneReason, DONE_REASON.toolLimit);
  assert.deepEqual(run.pending, []);
});

test('a mocked result is counted so the run cannot be mistaken for a real one', () => {
  let run = applyModelResponse(start(),
    modelCalls([{ id: 'c1', alias: 'search_products', args: {} }]));
  run = applyToolResults(run, [{ id: 'c1', ok: true, result: 'x', mocked: true }]);
  assert.equal(runStats(run).mockedToolCalls, 1);
});

test('token usage adds up across steps', () => {
  let run = applyModelResponse(start(), {
    text: '', calls: [{ id: 'c1', alias: 'search_products', args: {} }],
    usage: { input: 10, output: 2 },
  });
  run = applyToolResults(run, [{ id: 'c1', ok: true, result: 'x' }]);
  run = applyModelResponse(run, { text: 'done', calls: [], usage: { input: 20, output: 5 } });
  assert.deepEqual(runStats(run).usage, { input: 30, output: 7 });
  assert.equal(runStats(run).toolCalls, 1);
});

test('a stored session without live counters reads its stats from the transcript', () => {
  // The session shape archived by background/agent.js carries the transcript and budgets but
  // not the live run's counters — the transcript chips rendered "undefined model turns"
  // until this derivation existed (measured in a real screenshot, 2026-09-16).
  const session = {
    transcript: [
      { role: 'user', text: 'one' },
      { role: 'assistant', text: 'two' },
      { role: 'tool', ok: true, result: 'three' },
      { role: 'assistant', text: 'four' },
    ],
    maxSteps: 8, maxToolCalls: 24,
  };
  const stats = runStats(session);
  assert.equal(stats.steps, 2);
  assert.equal(stats.toolCalls, 1);
  assert.equal(stats.failedToolCalls, 0);
});

test('cancelling stops the loop and says so', () => {
  const run = cancelRun(applyModelResponse(start(),
    modelCalls([{ id: 'c1', alias: 'search_products', args: {} }])));
  assert.equal(run.status, STATUS.cancelled);
  assert.deepEqual(nextAction(run), { kind: 'done', reason: DONE_REASON.cancelled });
  assert.deepEqual(run.pending, []);
});

test('a transport failure is recorded with its message', () => {
  const run = failRun(start(), new Error('401 Invalid API key'));
  assert.equal(run.status, STATUS.failed);
  assert.match(run.error, /Invalid API key/);
  assert.deepEqual(nextAction(run), { kind: 'done', reason: DONE_REASON.error });
});

test('a run carries the tools it could not offer, and why', () => {
  const run = createRun({
    goal: 'g',
    dialect: DIALECTS.openaiChat,
    tools: [tool(), tool({ logicalId: 'bad', name: 'broken', schemaError: 'boom' })],
  });
  assert.equal(run.declarations.length, 1);
  assert.deepEqual(run.excluded, [{ name: 'broken', reason: 'schema-unparsed', detail: 'boom' }]);
});

test('a run with no usable tools still starts, and says the list is empty', () => {
  const run = createRun({
    goal: 'g', dialect: DIALECTS.openaiChat,
    tools: [tool({ schemaError: 'boom' })],
  });
  assert.deepEqual(run.declarations, []);
  assert.deepEqual(nextAction(run), { kind: 'call-model' });
});

test('nextAction is a question, not a mutation', () => {
  const run = start();
  const before = structuredClone(run);
  nextAction(run);
  nextAction(run);
  assert.deepEqual(run, before);
});

// --- interruption: the worker was killed under the run (D-050) ---

test('an in-flight run is interrupted, never left looking live', () => {
  const run = interruptRun(markCallingModel(start()));
  assert.equal(run.status, STATUS.interrupted);
  assert.equal(run.doneReason, DONE_REASON.interrupted);
  assert.deepEqual(run.pending, []);
  assert.deepEqual(nextAction(run), { kind: 'done', reason: DONE_REASON.interrupted });
});

test('interrupting a run with tool calls pending drops them rather than re-running them', () => {
  const pending = applyModelResponse(start(),
    modelCalls([{ id: 'c1', alias: 'search_products', args: {} }]));
  assert.equal(pending.pending.length, 1);
  const run = interruptRun(pending);
  assert.deepEqual(run.pending, []);
  assert.equal(nextAction(run).kind, 'done');
});

test('a run that had already finished is left exactly as it was', () => {
  const answered = applyModelResponse(start(), { text: 'done', calls: [] });
  assert.equal(interruptRun(answered), answered);
  const cancelled = cancelRun(start());
  assert.equal(interruptRun(cancelled), cancelled);
  const failed = failRun(start(), new Error('x'));
  assert.equal(interruptRun(failed), failed);
});

test('isFinished names every terminal state, and only those', () => {
  assert.equal(isFinished(start()), false);
  assert.equal(isFinished(markCallingModel(start())), false);
  assert.equal(isFinished(applyModelResponse(start(),
    modelCalls([{ id: 'c1', alias: 'search_products', args: {} }]))), false);
  assert.equal(isFinished(applyModelResponse(start(), { text: 'ok', calls: [] })), true);
  assert.equal(isFinished(cancelRun(start())), true);
  assert.equal(isFinished(failRun(start(), 'x')), true);
  assert.equal(isFinished(interruptRun(start())), true);
  assert.equal(isFinished(null), false);
});

test('the interrupted transcript keeps everything that had happened', () => {
  let run = applyModelResponse(start(),
    modelCalls([{ id: 'c1', alias: 'search_products', args: {} }]));
  run = applyToolResults(run, [{ id: 'c1', ok: true, result: 'seen' }]);
  const before = run.transcript.length;
  const interrupted = interruptRun(markCallingModel(run));
  assert.equal(interrupted.transcript.length, before);
  assert.equal(interrupted.toolCalls, 1);
});

// Cancel lands while a tool call or a model call is still in flight; its late answer must not reopen the run. Found
// with a declarative form that waits for a person: Cancel aborted the call, the aborted result came back, and the
// run went back to "ready", asked the model again and was left showing "Asking the model…" (2026-10-21).
test('late tool results do not reopen a cancelled or failed run', () => {
  const running = applyModelResponse(start(), modelCalls([{ id: 'c1', alias: 'search_products', args: {} }]));
  for (const ended of [cancelRun(running), failRun(running, new Error('x'))]) {
    const late = applyToolResults(ended, [{ id: 'c1', ok: false, code: 'cancelled', error: 'Cancelled' }]);
    assert.equal(late, ended);
    assert.deepEqual(nextAction(late), { kind: 'done', reason: ended.doneReason });
  }
});

test('a late model answer does not reopen a cancelled run', () => {
  const cancelled = cancelRun(markCallingModel(start()));
  assert.equal(applyModelResponse(cancelled, { text: 'too late', calls: [] }), cancelled);
  assert.equal(markCallingModel(cancelled), cancelled);
  assert.equal(cancelled.status, STATUS.cancelled);
});
test('an unknown effect stops the model loop instead of allowing a repair call',()=>{
  const run={status:'running-tools',pending:[{id:'pay-1',alias:'pay'}],transcript:[],toolCalls:0};
  const next=applyToolResults(run,[{id:'pay-1',ok:false,effectState:'unknown',error:'receipt failed'}]);
  assert.equal(next.status,'interrupted');assert.equal(next.pending.length,0);
  assert.equal(nextAction(next).kind,'done');
});
