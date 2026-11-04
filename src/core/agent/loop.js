// The agent loop as a pure state machine. No fetch, no chrome.*, no timers.
//
// Keeping the loop pure is what makes it testable without a key, a network or a browser: the
// transport hands it a parsed response and gets back the next thing to do. It is also what
// lets the panel replay a run: the state is data.
//
// The loop never executes anything itself. It says "run these tools", and the caller — the
// service worker, which alone can reach the page — comes back with results.

import { declareTools } from './tools.js';
import { DEFAULT_SYSTEM } from './messages.js';

export const STATUS = {
  ready: 'ready',
  callingModel: 'calling-model',
  runningTools: 'running-tools',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
  // Chrome stopped the extension's background worker while the run was in flight. Measured,
  // not theoretical: a 50-second provider call loses the worker at about 35 seconds.
  interrupted: 'interrupted',
};

export const DONE_REASON = {
  answered: 'answered',
  stepLimit: 'step-limit',
  toolLimit: 'tool-limit',
  cancelled: 'cancelled',
  error: 'error',
  interrupted: 'interrupted',
};

const DEFAULTS = { maxSteps: 8, maxToolCalls: 24 };

export function createRun({
  goal, tools = [], dialect, system = DEFAULT_SYSTEM,
  maxSteps = DEFAULTS.maxSteps, maxToolCalls = DEFAULTS.maxToolCalls,
  prior = [],
}) {
  const { declarations, byAlias, renamed, excluded, adapted } = declareTools(tools, dialect);
  return {
    goal,
    dialect,
    system,
    declarations,
    // Kept as a plain object so a run survives structuredClone across the message boundary.
    byAlias: Object.fromEntries([...byAlias].map(([alias, tool]) => [alias, {
      logicalId: tool.logicalId,
      name: tool.name,
      origin: tool.origin,
      frameId: tool.frameId,
      documentId: tool.documentId, runtimeId: tool.runtimeId, executionContract: tool.executionContract,
      // A declarative form without toolautosubmit waits for a person to submit it (form-wait.js); the run says so while it waits.
      ...(tool.registrationType === 'declarative' ? {
        declarative: true,
        ...(typeof tool.autoSubmit === 'boolean' ? { autoSubmit: tool.autoSubmit } : {}),
      } : {}),
    }])),
    renamed,
    adapted,
    excluded: excluded.map((entry) => ({
      name: entry.tool.name, reason: entry.reason, detail: entry.detail ?? null,
    })),
    // A continued session replays what was already said before the new goal, so the model
    // answers in the context of the conversation rather than from nothing.
    sessionId: null,
    transcript: [...prior, { role: 'user', text: goal }],
    status: STATUS.ready,
    doneReason: null,
    error: null,
    steps: 0,
    toolCalls: 0,
    maxSteps,
    maxToolCalls,
    pending: [],
  };
}

// What the caller should do next. Pure: asking twice gives the same answer.
// Terminal states, in one place: three of them existed before and a fourth was added, and a
// list spelled out at each site is a list that grows a hole.
export const TERMINAL = new Set([
  STATUS.done, STATUS.failed, STATUS.cancelled, STATUS.interrupted,
]);

export function isFinished(run) {
  return TERMINAL.has(run?.status);
}

export function nextAction(run) {
  if (isFinished(run)) {
    return { kind: 'done', reason: run.doneReason };
  }
  if (run.pending.length) return { kind: 'run-tools', calls: run.pending };
  if (run.steps >= run.maxSteps) return { kind: 'done', reason: DONE_REASON.stepLimit };
  return { kind: 'call-model' };
}

// A run that has ended stays ended: a model answer or tool result arriving after Cancel (or after a failure) is the
// answer to a question nobody is asking any more, and folding it in would reopen the run.
export function markCallingModel(run) {
  if (isFinished(run)) return run;
  return { ...run, status: STATUS.callingModel };
}

// Folds a parsed model response into the run. Tool calls are resolved to real tools here, so
// the caller only ever sees calls it can actually execute.
export function applyModelResponse(run, parsed) {
  if (isFinished(run)) return run;
  const steps = run.steps + 1;
  const calls = parsed.calls ?? [];

  const entry = {
    role: 'assistant',
    text: parsed.text ?? '',
    ...(parsed.replay ? { replay: parsed.replay } : {}),
    calls: calls.map((call) => ({ id: call.id, alias: call.alias, args: call.args ?? {},
      ...(call.providerCallId ? { providerCallId: call.providerCallId } : {}),
    })),
    usage: parsed.usage ?? null,
    stop: parsed.stop ?? null,
  };
  const transcript = [...run.transcript, entry];

  if (!calls.length) {
    return {
      ...run,
      transcript,
      steps,
      status: STATUS.done,
      doneReason: DONE_REASON.answered,
      pending: [],
    };
  }

  // A call the loop cannot honour is answered immediately with a tool result the model can
  // recover from. Failing the whole run instead would hide a fixable mistake.
  const pending = [];
  const immediate = [];
  for (const call of calls) {
    const target = run.byAlias[call.alias];
    if (!target) {
      immediate.push({
        id: call.id,
        alias: call.alias,
        ok: false,
        text: `No tool named ${call.alias} is available on this page.`,
      });
      continue;
    }
    if (call.argsError) {
      immediate.push({
        id: call.id,
        alias: call.alias,
        ok: false,
        text: `Your arguments could not be read: ${call.argsError}. `
          + 'Send them again as a JSON object matching the schema.',
      });
      continue;
    }
    pending.push({ id: call.id, alias: call.alias, args: call.args ?? {}, target });
  }

  let next = {
    ...run,
    transcript: [...transcript, ...immediate.map(toToolEntry)],
    steps,
    status: pending.length ? STATUS.runningTools : STATUS.ready,
    pending,
  };

  if (pending.length && run.toolCalls + pending.length > run.maxToolCalls) {
    next = {
      ...next,
      status: STATUS.done,
      doneReason: DONE_REASON.toolLimit,
      pending: [],
    };
  }
  return next;
}

// Results come back in any order; they are appended in the order the model asked for them so
// a replay of the transcript reads the way the conversation happened.
export function applyToolResults(run, results = []) {
  if (isFinished(run)) return run;
  const byId = new Map(results.map((r) => [r.id, r]));
  const entries = run.pending.map((call) => {
    const result = byId.get(call.id);
    if (!result) {
      return toToolEntry({
        id: call.id, alias: call.alias, ok: false, text: 'Explorer did not run this call.',
      });
    }
    return toToolEntry({
      id: call.id,
      alias: call.alias,
      ok: result.ok !== false,
      text: resultText(result),
      mocked: result.mocked === true,
      durationMs: result.durationMs ?? null,
      ...(result.dispatchState ? {dispatchState:result.dispatchState,effectState:result.effectState,engine:result.engine,attempts:result.attempts} : {}),
    });
  });

  const uncertain = results.some(result => result.effectState === 'unknown' && !result.mocked);
  return {
    ...run,
    transcript: [...run.transcript, ...entries],
    ...(uncertain ? { doneReason: DONE_REASON.interrupted, error: 'A tool action may have happened. Review the page before a new request; Explorer will not retry it.' } : {}),
    toolCalls: run.toolCalls + run.pending.length,
    pending: [],
    status: uncertain ? STATUS.interrupted : STATUS.ready,
  };
}

// A tool answered; whatever it said is what the model sees, verbatim. An error becomes text
// too, because a model that is told a tool failed can try something else.
function resultText(result) {
  if (result.ok === false) {
    return `Error: ${result.error ?? result.code ?? 'the tool failed with no message.'}`;
  }
  const value = result.result;
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toToolEntry(entry) {
  return { role: 'tool', ...entry };
}

export function cancelRun(run) {
  return {
    ...run, status: STATUS.cancelled, doneReason: DONE_REASON.cancelled, pending: [],
  };
}

// A run the worker was killed under. It is never resumed: the provider call is gone, and
// re-issuing it could spend the user's money twice and run the page's tools twice. Saying so
// is the honest outcome; showing it as still running, or losing it, is not.
export function interruptRun(run) {
  if (isFinished(run)) return run;
  return {
    ...run,
    status: STATUS.interrupted,
    doneReason: DONE_REASON.interrupted,
    pending: [],
  };
}

export function failRun(run, error) {
  return {
    ...run,
    status: STATUS.failed,
    doneReason: DONE_REASON.error,
    error: String(error?.message ?? error),
    pending: [],
  };
}

// The last thing the model said, which is what the panel shows as the answer.
export function finalText(run) {
  for (let i = run.transcript.length - 1; i >= 0; i -= 1) {
    const entry = run.transcript[i];
    if (entry.role === 'assistant' && entry.text) return entry.text;
  }
  return '';
}

export function runStats(run) {
  const usage = run.transcript.reduce((acc, entry) => {
    if (entry.role !== 'assistant' || !entry.usage) return acc;
    return {
      input: (acc.input ?? 0) + (entry.usage.input ?? 0),
      output: (acc.output ?? 0) + (entry.usage.output ?? 0),
    };
  }, { input: 0, output: 0 });

  // A stored session may predate the counters (or simply not carry them — the transcript is
  // the record, the counters are live-run bookkeeping). Counting the transcript's own turns
  // is the same fact read from the other end, and it is never `undefined` on screen.
  const steps = Number.isFinite(run.steps)
    ? run.steps
    : run.transcript.filter((e) => e.role === 'assistant').length;
  const toolCalls = Number.isFinite(run.toolCalls)
    ? run.toolCalls
    : run.transcript.filter((e) => e.role === 'tool').length;

  return {
    steps,
    toolCalls,
    failedToolCalls: run.transcript.filter((e) => e.role === 'tool' && e.ok === false).length,
    mockedToolCalls: run.transcript.filter((e) => e.role === 'tool' && e.mocked).length,
    usage,
  };
}
