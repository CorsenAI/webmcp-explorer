// Runs an eval suite: every case, every attempt, one after another, and scores the result.
//
// Sequential on purpose. Running goals in parallel would have several agents acting on the
// same page at once — the second one would see the state the first one left — and the results
// would say more about the interleaving than about the tools.

import { STATUS } from '../core/agent/loop.js';
import { runAgentOnce, cancelAgent } from './agent.js';
import { awaitingForms, FORM_WAIT_MS } from '../core/agent/form-wait.js';
import { scoreSuite } from '../core/evals/score.js';
import { totalRuns, unknownTools } from '../core/evals/suite.js';
import { appendResult } from '../storage/evals.js';
import { listOverrides } from '../storage/overrides.js';
import { hold, release } from './keepalive.js';
import { saveEvalState, dropEvalState, loadEvalStates, replaceEvalStates }
  from '../storage/run-state.js';

const active = new Map();

function publish(tabId) {
  const state = active.get(tabId);
  if (!state) return;
  // Written down as well as broadcast, so a killed worker cannot make a suite disappear.
  saveEvalState(tabId, state.progress);
  chrome.runtime.sendMessage({
    type: 'evals-update', tabId, progress: state.progress,
  }).catch(() => {});
}

// Suites inherited from a worker that was killed. A suite is never resumed: the runs it had
// already made are gone with the worker, and restarting it would repeat model calls the user
// has already paid for.
const interrupted = new Map();

export function evalsProgress(tabId) {
  return active.get(tabId)?.progress ?? interrupted.get(tabId) ?? null;
}

export async function recoverEvals() {
  const stored = await loadEvalStates();
  const next = {};
  for (const [tabId, progress] of Object.entries(stored)) {
    if (progress?.finishedAt) continue;
    const settled = { ...progress, interrupted: true, finishedAt: Date.now() };
    next[tabId] = settled;
    interrupted.set(Number(tabId), settled);
  }
  await replaceEvalStates(next);
  return { interruptedSuites: Object.keys(next).length };
}

// Stops the suite now: the attempt in flight is cancelled with it — including a tool call waiting on the page, which
// may never end on its own (a declarative form waits for a person, form-wait.js) — and is scored as cancelled.
export function cancelEvals(tabId) {
  const state = active.get(tabId);
  if (!state) return { cancelled: false };
  state.cancelled = true;
  cancelAgent(tabId);
  return { cancelled: true };
}

export function forgetEvals(tabId) {
  active.delete(tabId);
  interrupted.delete(tabId);
  dropEvalState(tabId);
}

export async function runSuite({ tabId, suite, tools, topOrigin, label = null }) {
  if (active.has(tabId)) return { error: 'A suite is already running on this tab.' };

  const missing = unknownTools(suite, tools);
  const state = {
    cancelled: false,
    progress: {
      suiteId: suite.id,
      name: suite.name,
      label,
      total: totalRuns(suite),
      done: 0,
      currentCase: null,
      // Named before the first run, because a suite expecting a tool the page no longer
      // exposes will fail for a reason that has nothing to do with the model.
      unknownTools: missing,
      startedAt: Date.now(),
    },
  };
  interrupted.delete(tabId);
  active.set(tabId, state);
  // A suite is a sequence of provider calls, each of which can outlive the worker's idle
  // timeout on its own (D-050).
  hold();
  publish(tabId);

  const runsByCase = {};
  try {
    for (const testCase of suite.cases) {
      runsByCase[testCase.id] = [];
      for (let attempt = 0; attempt < testCase.repeat; attempt += 1) {
        if (state.cancelled) break;

        state.progress.currentCase = { id: testCase.id, goal: testCase.goal, attempt: attempt + 1 };
        publish(tabId);

        const outcome = await runAgentOnce({
          tabId, goal: testCase.goal, tools, topOrigin, formWaitMs: FORM_WAIT_MS,
          onUpdate: (run) => {
            // A cancel that arrived while this attempt was being set up lands on it as soon as it exists.
            if (state.cancelled) {
              Promise.resolve().then(() => cancelAgent(tabId));
              return;
            }
            const forms = awaitingForms(run);
            const before = state.progress.awaitingForms ?? [];
            if (forms.join('\n') === before.join('\n')) return;
            if (forms.length) state.progress.awaitingForms = forms;
            else delete state.progress.awaitingForms;
            publish(tabId);
          },
        });
        delete state.progress.awaitingForms;
        if (outcome.error) {
          // A configuration problem is not a result about the page. Stop rather than fill the
          // table with identical failures.
          state.progress.error = outcome.error;
          state.progress.finishedAt = Date.now();
          saveEvalState(tabId, state.progress);
          // No release() here: the finally below runs on this return, and releasing twice
          // would drop a hold belonging to another operation.
          chrome.runtime.sendMessage({
            type: 'evals-update', tabId, progress: state.progress,
          }).catch(() => {});
          return { error: outcome.error };
        }
        runsByCase[testCase.id].push(outcome.run);
        state.progress.done += 1;
        if (outcome.run.status === STATUS.interrupted) {
          state.progress.interrupted = true;
          state.progress.error = outcome.run.error;
          publish(tabId);
          break;
        }
        publish(tabId);
      }
      if (state.cancelled || state.progress.interrupted) break;
    }
  } finally {
    active.delete(tabId);
    release();
  }

  const result = {
    ...scoreSuite(suite, runsByCase),
    label,
    ranAt: Date.now(),
    origin: topOrigin ?? null,
    cancelled: state.cancelled,
    interrupted: state.progress.interrupted === true,
    ...(state.progress.interrupted ? {error:state.progress.error} : {}),
    unknownTools: missing,
    // The contract each tool was offered with, so a later screen can tell that a case was
    // judged against a description or schema that has since changed (core/evals/stale.js).
    tools: Object.fromEntries((tools ?? []).map((tool) => [tool.name, {
      declaredFp: tool.contractFp ?? null,
      offeredFp: tool.offeredFp ?? tool.contractFp ?? null,
    }])),
    // Which overrides were in force. A result obtained with a rewritten description means
    // something else than one obtained without, and a comparison is worthless if the two
    // sides cannot be told apart later (D-030).
    overrides: (await listOverrides())
      .filter((o) => o.enabled !== false)
      .map((o) => ({
        logicalId: o.logicalId,
        changedDescription: typeof o.description === 'string',
        changedSchema: o.inputSchema !== null && o.inputSchema !== undefined,
        disabled: Boolean(o.disabled),
        mockMode: o.mock?.mode ?? 'off',
      })),
  };

  await appendResult(suite.id, result);
  state.progress.currentCase = null;
  state.progress.finishedAt = Date.now();
  await dropEvalState(tabId);
  chrome.runtime.sendMessage({
    type: 'evals-update', tabId, progress: state.progress,
  }).catch(() => {});
  return { result };
}
