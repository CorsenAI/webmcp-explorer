// Drives an agent run: ask the model, execute what it asks for on the page, feed the result
// back, repeat. The decisions all live in core/agent/loop.js; this file only performs.
//
// Runs are held per tab. A run belongs to the page it was started against — its tools are
// that page's tools, and a tool call must land in the frame the tool was discovered in.

import {
  createRun, nextAction, markCallingModel, applyModelResponse, applyToolResults,
  cancelRun, failRun, interruptRun, isFinished, STATUS,
} from '../core/agent/loop.js';
import { DIALECTS } from '../core/agent/providers.js';
import { resolveProvider } from '../storage/custom-connectors.js';
import { buildRequest, parseResponse } from '../core/agent/messages.js';
import { formNotSubmitted } from '../core/agent/form-wait.js';
import { loadAgentConfig } from '../storage/agent-config.js';
import { profileText } from '../storage/prompt-profiles.js';
import { callModel } from './agent-transport.js';
import { runTool, cancelTool, newCallId } from './execute.js';
import { recordExecution } from './live.js';
import { hold, release } from './keepalive.js';
import { saveRunState, dropRunState, loadRunStates, replaceRunStates }
  from '../storage/run-state.js';
import { getSession, saveSession } from '../storage/agent-sessions.js';

const runs = new Map();

// Every meaningful transition is both broadcast and written down. The broadcast is for a panel
// that is open; the note is for a service worker that is about to be killed (D-050).
function publish(tabId) {
  const state = runs.get(tabId);
  if (!state) return;
  saveRunState(tabId, state.run);
  const run = state.run;
  // The eval runner follows its run from here, so its progress can say what the run waits on.
  state.onUpdate?.(run);
  const broadcast = () => chrome.runtime.sendMessage({ type: 'agent-update', tabId, run }).catch(() => {});
  // Publish completion after its conversation is readable. Otherwise an immediate follow-up
  // or the history refresh can race the write and silently start a conversation without context.
  if (state.archive !== false && isFinished(run)) {
    state.archiving = archiveRun(run).catch(() => {});
    state.archiving.then(broadcast);
  } else broadcast();
}

// The persisted form of a run. Continuing a session later feeds this transcript back to the
// model, so the record keeps everything the next request needs: the turns, the budgets, who
// ran it. Per origin — the run is archived against the site whose tools it drove.
async function archiveRun(run) {
  if (!run?.topOrigin || !isFinished(run)) return;
  const prior = run.sessionId ? await getSession(run.topOrigin, run.sessionId) : null;
  const firstUser = run.transcript.find((entry) => entry.role === 'user');
  await saveSession(run.topOrigin, {
    id: run.sessionId ?? run.id,
    title: prior?.title ?? firstUser?.text ?? run.goal,
    createdAt: prior?.createdAt ?? run.startedAt ?? Date.now(),
    updatedAt: Date.now(),
    status: run.status,
    doneReason: run.doneReason ?? null,
    error: run.error ?? null,
    providerId: run.providerId ?? null,
    model: run.model ?? null,
    maxSteps: run.maxSteps,
    maxToolCalls: run.maxToolCalls,
    transcript: run.transcript,
    // Grouping is user organisation, not run output: a continued session keeps the group it
    // was moved to, exactly as it keeps its title and creation date.
    groupId: prior?.groupId ?? undefined,
  });
}

export function agentRun(tabId) {
  const live = runs.get(tabId)?.run;
  if (live) return live;
  // A run this worker never saw, because it was started by a previous instance of the worker.
  // Recovery has already marked it interrupted; returning it is what stops the panel from
  // showing "no run yet" for work the user actually started (D-050).
  return recovered.get(tabId) ?? null;
}

// Runs inherited from a worker that was killed. Kept apart from live runs so nothing can ever
// try to drive one.
const recovered = new Map();

// Called once when the worker starts. Anything that was still in flight cannot be resumed: the
// provider call is gone, and re-issuing it could spend the user's money twice and run the
// page's tools twice. It is marked interrupted, which is a fact the panel can show.
export async function recoverRuns() {
  const stored = await loadRunStates();
  const next = {};
  for (const [tabId, run] of Object.entries(stored)) {
    const settled = isFinished(run) ? run : interruptRun(run);
    next[tabId] = settled;
    recovered.set(Number(tabId), settled);
  }
  await replaceRunStates(next);
  // Counted by final state, not by "did this instance do the interrupting". A worker can be
  // killed twice, and the second one inheriting an already-interrupted run must report the
  // same thing as the first.
  const interrupted = Object.values(next)
    .filter((run) => run.status === STATUS.interrupted).length;
  // A run the previous worker left finished is archived now, or it never reaches a session:
  // recovery does not republish, so the normal archive-on-publish path never fires for it.
  for (const run of Object.values(next)) {
    if (isFinished(run) && run.topOrigin) archiveRun(run).catch(() => {});
  }
  // Distinct names: these are merged with the eval recovery, and a shared key silently
  // overwrote this count once already.
  return { inheritedRuns: Object.keys(next).length, interruptedRuns: interrupted };
}

// Tool calls the run has on the page right now. Cancelling the run must not leave them
// running to completion behind the user's back.
function cancelInflightCalls(tabId, state) {
  for (const callId of state?.inflightCalls ?? []) {
    cancelTool(tabId, callId).catch(() => {});
  }
}

export function cancelAgent(tabId) {
  recovered.delete(tabId);
  const state = runs.get(tabId);
  if (!state) return { cancelled: false };
  // A run that already finished has nothing to cancel, and rewriting it would be a lie: the
  // session store would show an answered conversation as `cancelled` the moment the user
  // starts the next chat on the same tab (measured in the session-groups scenario). Only a
  // live run is cancelled, settled and archived here.
  if (isFinished(state.run)) return { cancelled: false };
  state.controller.abort();
  cancelInflightCalls(tabId, state);
  state.run = cancelRun(state.run);
  settle(state);
  releaseHold(state);
  publish(tabId);
  return { cancelled: true };
}

// The keep-alive is released exactly once per run, whichever way the run ends.
function releaseHold(state) {
  if (!state?.holding) return;
  state.holding = false;
  release();
}

// Resolving twice is harmless and expected: a run can be cancelled while drive() is already
// on its way out.
function settle(state) {
  if (!state?.settle) return;
  const resolve = state.settle;
  state.settle = null;
  resolve(state.run);
}

export function forgetAgent(tabId) {
  const state = runs.get(tabId);
  if (state) {
    state.controller.abort();
    cancelInflightCalls(tabId, state);
    settle(state);
    releaseHold(state);
  }
  runs.delete(tabId);
  recovered.delete(tabId);
  dropRunState(tabId);
}

// `formWaitMs` bounds how long a call to a declarative form may wait for a person (form-wait.js): null in Agent Lab,
// where a person can submit it; set by the unattended eval runner.
export async function startAgent({
  tabId, goal, tools, topOrigin, sessionId = null, archive = true, formWaitMs = null, onUpdate = null,
}) {
  const config = await loadAgentConfig();
  const provider = await resolveProvider(config.providerId);
  if (!provider) return { error: 'Choose your AI in Model setup before sending a message.' };
  // The system prompt is whatever the chosen profile says, falling back to the product
  // default (profileText never returns empty — a run without a system prompt would silently
  // drop the rules that name this surface and its refusals).
  config.system = await profileText(config.promptProfileId);

  cancelAgent(tabId);
  await runs.get(tabId)?.archiving;

  // Continuing a stored conversation: its transcript is replayed before the new goal, so the
  // model answers with the context of everything said so far.
  let prior = [];
  if (sessionId) {
    const session = await getSession(topOrigin, sessionId);
    if (session) prior = session.transcript ?? [];
    else sessionId = null;
  }

  const run = createRun({
    goal,
    tools,
    dialect: provider.dialect,
    system: config.system ?? undefined,
    maxSteps: config.maxSteps,
    maxToolCalls: config.maxToolCalls,
    prior,
  });
  // Only non-secret provenance travels with the run. Settings may change before it is
  // read or exported, and a restored run must still name the model that actually ran.
  run.id = crypto.randomUUID();
  run.sessionId = sessionId;
  run.model = config.model || null;
  run.providerId = provider.id;
  // The origin travels on the run itself so a run recovered after a worker restart can still
  // be archived against the site it ran on.
  run.topOrigin = topOrigin;
  run.startedAt = Date.now();

  recovered.delete(tabId);
  const state = {
    run, config, topOrigin, controller: new AbortController(), holding: false,
    inflightCalls: new Set(), archive, formWaitMs, onUpdate,
  };
  // Evals need to await a run rather than poll it, so every run carries the promise of its
  // own end. It settles on every exit — answered, budget, cancel, transport failure.
  state.done = new Promise((resolve) => { state.settle = resolve; });
  runs.set(tabId, state);
  publish(tabId);

  if (provider.dialect === DIALECTS.none) {
    // Manual mode stops here: the caller asks for the prompt, pastes a reply back. No
    // keep-alive: nothing is in flight while the user is carrying the prompt around.
    return { started: true, manual: true, run: state.run };
  }

  // Held for the duration of the run and no longer. Measured: a 50-second provider call
  // otherwise loses the worker at about 35 seconds (D-050).
  state.holding = true;
  hold();

  drive(tabId).catch((error) => {
    const current = runs.get(tabId);
    if (!current) return;
    current.run = failRun(current.run, error);
    settle(current);
    releaseHold(current);
    publish(tabId);
  });

  return { started: true, manual: false, run: state.run };
}

// One pass of the loop, repeated until it says it is done. Every transition is published so
// the panel shows the conversation as it happens rather than at the end.
async function drive(tabId) {
  for (;;) {
    const state = runs.get(tabId);
    if (!state) return;

    const action = nextAction(state.run);
    if (action.kind === 'done') {
      if (state.run.status !== STATUS.done && state.run.status !== STATUS.failed
        && state.run.status !== STATUS.cancelled && state.run.status !== STATUS.interrupted) {
        state.run = { ...state.run, status: STATUS.done, doneReason: action.reason };
      }
      settle(state);
      releaseHold(state);
      publish(tabId);
      return;
    }

    if (action.kind === 'call-model') {
      state.run = markCallingModel(state.run);
      publish(tabId);

      const answer = await callModel({
        config: state.config, run: state.run, signal: state.controller.signal,
      });
      if (!runs.has(tabId)) return;
      if (answer.aborted) { settle(state); releaseHold(state); return; }
      if (!answer.ok) {
        state.run = failRun(state.run, new Error(answer.error));
        settle(state);
        releaseHold(state);
        publish(tabId);
        return;
      }
      state.run = applyModelResponse(state.run, answer.parsed);
      publish(tabId);
      continue;
    }

    const results = await executeAll(tabId, state, action.calls);
    if (!runs.has(tabId)) return;
    state.run = applyToolResults(state.run, results);
    publish(tabId);
  }
}

// Tool calls in one turn are independent, so they run together. The page decides the real
// ordering; the loop restores the model's ordering when folding the results back.
function executeAll(tabId, state, calls) {
  return Promise.all(calls.map(async (call) => {
    const callId = `agent:${state.run.id ?? state.id}:${state.run.steps}:${call.id}`;
    state.inflightCalls.add(callId);
    // A form that waits for a person is not waited on forever by a run nobody watches: its call is aborted in the
    // page, which releases the form (measured on Chrome 155 and 157), and the model is told why.
    const limit = (call.target.declarative && call.target.autoSubmit !== true) ? state.formWaitMs : null;
    let expired = false;
    const timer = limit ? setTimeout(() => {
      expired = true;
      cancelTool(tabId, callId).catch(() => {});
    }, limit) : null;
    try {
      let outcome = await runTool(tabId, {
        frameId: call.target.frameId,
        documentId: call.target.documentId,
        toolName: call.target.name,
        origin: call.target.origin,
        args: call.args,
        tool: { ...call.target, logicalId: call.target.logicalId, name: call.target.name },
        topOrigin: state.topOrigin,
        callId,
      });
      if (expired && outcome.cancelled) outcome = formNotSubmitted(outcome, limit);
      // An agent call is a real execution: it belongs in the timeline and the history like any
      // other, so a developer can compare what the agent did with what they did by hand.
      recordExecution(tabId, { ...outcome, viaAgent: true });
      return { id: call.id, ...outcome };
    } finally {
      clearTimeout(timer);
      state.inflightCalls.delete(callId);
    }
  }));
}

// Manual mode: hand over exactly what would have been sent, and take back what the model
// said. Nothing leaves the machine — the developer carries it.
export async function manualPrompt(tabId) {
  const state = runs.get(tabId);
  if (!state) return { error: 'No run in progress.' };

  // Manual mode has no dialect of its own; the OpenAI shape is the one most chat UIs and
  // playgrounds understand, and it is the one whose reply the parser below reads back.
  const { body } = buildRequest({
    dialect: DIALECTS.openaiChat,
    model: state.config.model || 'your-model',
    system: state.config.system ?? undefined,
    transcript: state.run.transcript,
    declarations: state.run.declarations,
  });
  return { request: JSON.stringify(body, null, 2) };
}

export async function manualReply(tabId, text) {
  const state = runs.get(tabId);
  if (!state) return { error: 'No run in progress.' };

  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { error: 'Paste the model reply first.' };

  // Either a full API response, or plain prose the developer copied out of a chat window.
  let parsed;
  try {
    parsed = parseResponse(DIALECTS.openaiChat, JSON.parse(trimmed));
  } catch {
    parsed = { text: trimmed, calls: [], stop: 'stop', usage: null };
  }

  state.run = applyModelResponse(state.run, parsed);
  publish(tabId);

  const action = nextAction(state.run);
  if (action.kind === 'run-tools') {
    const results = await executeAll(tabId, state, action.calls);
    if (!runs.has(tabId)) return { run: state.run };
    state.run = applyToolResults(state.run, results);
    publish(tabId);
  }
  return { run: state.run };
}

// Runs one goal to completion and hands back the finished run. Used by the eval runner, which
// needs to await a run rather than watch it. Evals are measurements, not conversations: they
// are never archived as sessions, or iterating a suite would fill the history.
export async function runAgentOnce(options) {
  const started = await startAgent({ ...options, archive: false });
  if (started.error) return { error: started.error };
  if (started.manual) {
    return { error: 'Manual mode cannot run an eval: it needs you in the loop.' };
  }
  const state = runs.get(options.tabId);
  if (!state) return { error: 'The run was replaced before it started.' };
  return { run: await state.done };
}
