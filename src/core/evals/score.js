// Scoring a finished agent run against one eval case, and aggregating a whole suite.
//
// The distinction that carries the whole feature: a case that fails because the model chose
// the wrong tool is a finding about the page. A case that fails because the endpoint was down
// is a finding about the network. Collapsing the two into "3/8 passed" would make the number
// worthless, so an errored run is never counted as a failure.
//
// Pure JavaScript: no chrome.*, no fetch.

import { STATUS, DONE_REASON } from '../agent/loop.js';

export const OUTCOME = {
  pass: 'pass',
  fail: 'fail',
  errored: 'errored',
  cancelled: 'cancelled',
};

// The tools a run actually executed, in order, under their real WebMCP names.
export function toolsCalled(run) {
  const names = [];
  for (const entry of run?.transcript ?? []) {
    if (entry.role !== 'tool' || (entry.dispatchState === 'not-dispatched' && !entry.mocked)) continue;
    // A call that never resolved to a real tool has no page-side name; it is a model mistake,
    // recorded as such rather than attributed to a tool that was never asked for.
    const target = run.byAlias?.[entry.alias];
    names.push(target ? target.name : null);
  }
  return names;
}

export function scoreRun(testCase, run) {
  if (!run) {
    return { outcome: OUTCOME.errored, reason: 'no-run', called: [], first: null };
  }
  if (run.status === STATUS.cancelled) {
    return { outcome: OUTCOME.cancelled, reason: DONE_REASON.cancelled, called: [], first: null };
  }
  if (run.status === STATUS.failed || run.status === STATUS.interrupted) {
    return {
      outcome: OUTCOME.errored,
      reason: run.doneReason ?? DONE_REASON.error,
      error: run.error ?? null,
      called: toolsCalled(run),
      first: toolsCalled(run).find(Boolean) ?? null,
    };
  }

  const called = toolsCalled(run);
  const first = called.find((name) => name !== null) ?? null;
  const facts = {
    called,
    first,
    steps: run.steps,
    toolCalls: run.toolCalls,
    // A run that stopped on a budget did not necessarily fail its expectation — it may have
    // called the right tool first and then kept going. Recorded, not conflated.
    hitBudget: run.doneReason === DONE_REASON.stepLimit
      || run.doneReason === DONE_REASON.toolLimit,
  };

  const misses = [];
  if (testCase.expectTool) {
    if (!called.includes(testCase.expectTool)) misses.push('expected-tool-not-called');
    else if (testCase.expectFirst && first !== testCase.expectTool) {
      misses.push('expected-tool-not-first');
    }
  }
  for (const name of testCase.forbidTools ?? []) {
    if (called.includes(name)) misses.push(`forbidden-tool-called:${name}`);
  }

  return {
    outcome: misses.length ? OUTCOME.fail : OUTCOME.pass,
    misses,
    ...facts,
  };
}

// Several attempts at the same case. A model is not deterministic, so the useful number is
// how often it got there, not whether it once did.
export function scoreCase(testCase, runs = []) {
  const scores = runs.map((run) => scoreRun(testCase, run));
  const counted = scores.filter((s) => s.outcome === OUTCOME.pass || s.outcome === OUTCOME.fail);
  const passes = scores.filter((s) => s.outcome === OUTCOME.pass).length;
  const errored = scores.filter((s) => s.outcome === OUTCOME.errored).length;

  return {
    caseId: testCase.id,
    goal: testCase.goal,
    expectTool: testCase.expectTool,
    attempts: scores.length,
    passes,
    errored,
    cancelled: scores.filter((s) => s.outcome === OUTCOME.cancelled).length,
    // Undefined rather than 0 when nothing could be judged: a rate of 0 % would read as
    // "the model always got it wrong", which is a different and false statement.
    passRate: counted.length ? passes / counted.length : null,
    outcome: verdictFor(scores, counted, passes),
    firstChoices: tally(scores.map((s) => s.first)),
    misses: tally(scores.flatMap((s) => s.misses ?? [])),
    scores,
  };
}

function verdictFor(scores, counted, passes) {
  if (!scores.length) return OUTCOME.errored;
  if (!counted.length) {
    return scores.every((s) => s.outcome === OUTCOME.cancelled)
      ? OUTCOME.cancelled : OUTCOME.errored;
  }
  if (passes === counted.length) return OUTCOME.pass;
  return OUTCOME.fail;
}

export function scoreSuite(suite, runsByCase = {}) {
  const cases = (suite?.cases ?? []).map(
    (entry) => scoreCase(entry, runsByCase[entry.id] ?? []));

  const judged = cases.filter((c) => c.passRate !== null);
  return {
    suiteId: suite?.id ?? null,
    name: suite?.name ?? '',
    cases,
    passed: cases.filter((c) => c.outcome === OUTCOME.pass).length,
    failed: cases.filter((c) => c.outcome === OUTCOME.fail).length,
    errored: cases.filter((c) => c.outcome === OUTCOME.errored).length,
    cancelled: cases.filter((c) => c.outcome === OUTCOME.cancelled).length,
    total: cases.length,
    // Averaged over the cases that could be judged at all.
    passRate: judged.length
      ? judged.reduce((sum, c) => sum + c.passRate, 0) / judged.length
      : null,
  };
}

function tally(values) {
  const counts = new Map();
  for (const value of values) {
    if (value === null || value === undefined) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
}
