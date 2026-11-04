import test from 'node:test';
import assert from 'node:assert/strict';

import { DIALECTS } from '../src/core/agent/providers.js';
import { createRun, applyModelResponse, applyToolResults, STATUS } from '../src/core/agent/loop.js';
import { awaitingForms, formNotSubmitted, FORM_WAIT_MS, FORM_NOT_SUBMITTED } from '../src/core/agent/form-wait.js';

// A declarative form without toolautosubmit waits for a person to submit it (Chrome declarative API docs;
// webmachinelearning/webmcp#307). The run must be able to say so, and an unattended run must be able to stop waiting.

const tool = (over = {}) => ({
  name: 'search_products', description: 'Search', inputSchema: { type: 'object', properties: {} }, schemaError: null,
  origin: 'http://localhost:8777', frameId: 0, notInjected: false, logicalId: 'id-1', registrationType: 'unknown',
  ...over,
});
const TOOLS = [
  tool(),
  tool({ name: 'subscribe_newsletter', logicalId: 'id-2', registrationType: 'declarative', autoSubmit: false }),
  tool({ name: 'ping_server', logicalId: 'id-3', registrationType: 'declarative', autoSubmit: true }),
];
const start = () => createRun({ goal: 'subscribe me', tools: TOOLS, dialect: DIALECTS.openaiChat });
const calls = (...aliases) => ({ text: '', stop: 'tool_calls', usage: null,
  calls: aliases.map((alias, i) => ({ id: `c${i}`, alias, args: {} })) });

test('the run knows which of its tools are declarative forms, and the flag survives structuredClone', () => {
  const run = structuredClone(start());
  assert.equal(run.byAlias.subscribe_newsletter.declarative, true);
  assert.equal(run.byAlias.subscribe_newsletter.autoSubmit, false);
  assert.equal(run.byAlias.ping_server.declarative, true);
  assert.equal(run.byAlias.ping_server.autoSubmit, true);
  assert.equal(run.byAlias.search_products.declarative, undefined, 'imperative or unknown tools carry no flag');
});

test('a run executing a declarative tool reports the form it waits on; auto-submitting forms are excluded', () => {
  const run = start();
  assert.deepEqual(awaitingForms(run), [], 'not running tools yet');
  const both = applyModelResponse(run, calls('search_products', 'subscribe_newsletter', 'ping_server'));
  assert.equal(both.status, STATUS.runningTools);
  assert.deepEqual(awaitingForms(both), ['subscribe_newsletter']);
  assert.deepEqual(awaitingForms(applyModelResponse(run, calls('search_products', 'ping_server'))), []);
  const after = applyToolResults(both, [
    { id: 'c0', ok: true, result: 'x' },
    { id: 'c1', ok: true, result: 'y' },
    { id: 'c2', ok: true, result: 'z' },
  ]);
  assert.deepEqual(awaitingForms(after), [], 'the wait ends with the results');
  assert.deepEqual(awaitingForms(null), []);
});

test('an unsubmitted form becomes an error the model can act on, keeping the call facts', () => {
  const out = formNotSubmitted({ ok: false, code: 'cancelled', cancelled: true, callId: 'k', durationMs: 3 }, 30000);
  assert.equal(out.ok, false);
  assert.equal(out.code, FORM_NOT_SUBMITTED);
  assert.equal(out.cancelled, true);
  assert.equal(out.callId, 'k');
  assert.match(out.error, /submit button/);
  assert.match(out.error, /toolautosubmit/);
  assert.match(out.error, /within 30 s/);
  assert.match(out.error, /effects are unknown/);
  assert.equal(FORM_WAIT_MS, 30000);
});
