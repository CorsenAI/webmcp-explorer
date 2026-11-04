// Comparing two suite results — the point of the whole feature.
//
// "Did rewriting that description make the model pick my tool?" cannot be answered by one run
// or by one number. It is answered by running the same goals twice, before and after, and
// looking at what moved. This is where an override stops being a toy.
//
// Pure JavaScript: no chrome.*, no fetch.

import { OUTCOME } from './score.js';

export const CHANGE = {
  fixed: 'fixed',
  broken: 'broken',
  stillPassing: 'still-passing',
  stillFailing: 'still-failing',
  unjudged: 'unjudged',
};

function classify(before, after) {
  const judged = (c) => c && (c.outcome === OUTCOME.pass || c.outcome === OUTCOME.fail);
  // A case that could not be judged on either side says nothing about the change. Calling it
  // "broken" because the endpoint was down would be the most misleading thing this file could
  // do.
  if (!judged(before) || !judged(after)) return CHANGE.unjudged;

  const wasPass = before.outcome === OUTCOME.pass;
  const isPass = after.outcome === OUTCOME.pass;
  if (!wasPass && isPass) return CHANGE.fixed;
  if (wasPass && !isPass) return CHANGE.broken;
  return isPass ? CHANGE.stillPassing : CHANGE.stillFailing;
}

export function compareSuites(before, after) {
  const beforeById = new Map((before?.cases ?? []).map((c) => [c.caseId, c]));
  const afterById = new Map((after?.cases ?? []).map((c) => [c.caseId, c]));
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])];

  const cases = ids.map((caseId) => {
    const a = beforeById.get(caseId) ?? null;
    const b = afterById.get(caseId) ?? null;
    const change = classify(a, b);

    return {
      caseId,
      goal: b?.goal ?? a?.goal ?? '',
      expectTool: b?.expectTool ?? a?.expectTool ?? null,
      change,
      before: summarise(a),
      after: summarise(b),
      // The pass rate is what actually moved when both sides ran several attempts; a case can
      // stay "failing" while going from 0/5 to 2/5, which is real progress.
      passRateDelta: a?.passRate !== null && a?.passRate !== undefined
        && b?.passRate !== null && b?.passRate !== undefined
        ? Number((b.passRate - a.passRate).toFixed(4))
        : null,
      firstChoiceChanged: topChoice(a) !== topChoice(b),
    };
  });

  const counts = Object.fromEntries(Object.values(CHANGE).map((k) => [k, 0]));
  for (const entry of cases) counts[entry.change] += 1;

  return {
    cases,
    counts,
    // A verdict on the change as a whole, deliberately conservative: anything that broke is
    // reported even if more cases were fixed than broken.
    netPassRateDelta: netDelta(before, after),
    regressed: counts[CHANGE.broken] > 0,
    improved: counts[CHANGE.fixed] > 0,
  };
}

function summarise(entry) {
  if (!entry) return null;
  return {
    outcome: entry.outcome,
    passes: entry.passes,
    attempts: entry.attempts,
    passRate: entry.passRate,
    errored: entry.errored,
    firstChoices: entry.firstChoices,
    misses: entry.misses,
  };
}

function topChoice(entry) {
  return entry?.firstChoices?.[0]?.value ?? null;
}

function netDelta(before, after) {
  if (before?.passRate === null || before?.passRate === undefined) return null;
  if (after?.passRate === null || after?.passRate === undefined) return null;
  return Number((after.passRate - before.passRate).toFixed(4));
}
