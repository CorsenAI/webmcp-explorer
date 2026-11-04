import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSuite, createCase, suiteProblems, unknownTools, totalRuns, suiteFromTools,
} from '../src/core/evals/suite.js';
import { scoreRun, scoreCase, scoreSuite, toolsCalled, OUTCOME } from '../src/core/evals/score.js';
import { compareSuites, CHANGE } from '../src/core/evals/compare.js';
import { STATUS, DONE_REASON } from '../src/core/agent/loop.js';

// A finished run, shaped the way loop.js leaves it.
function runWith({ calls = [], status = STATUS.done, doneReason = DONE_REASON.answered,
  error = null, steps = 2, byAlias = null } = {}) {
  const aliases = byAlias ?? Object.fromEntries(
    [...new Set(calls.filter(Boolean))].map((name) => [name, { name, logicalId: `id-${name}` }]));
  return {
    status,
    doneReason,
    error,
    steps,
    toolCalls: calls.length,
    byAlias: aliases,
    transcript: [
      { role: 'user', text: 'goal' },
      ...calls.map((alias) => ({ role: 'tool', alias, ok: true, text: 'x' })),
    ],
  };
}

const aCase = (over = {}) => createCase({ goal: 'find a laptop', expectTool: 'search_products', ...over });

test('a case keeps the tool name the user typed, not an alias', () => {
  const entry = aCase();
  assert.equal(entry.expectTool, 'search_products');
  assert.equal(entry.repeat, 1);
});

test('repeat is clamped to something a person would wait for', () => {
  assert.equal(createCase({ repeat: 0 }).repeat, 1);
  assert.equal(createCase({ repeat: 999 }).repeat, 20);
  assert.equal(createCase({ repeat: 5 }).repeat, 5);
});

test('ids are unique across suites and cases', () => {
  const ids = [createCase().id, createCase().id, createSuite().id, createSuite().id];
  assert.equal(new Set(ids).size, 4);
});

test('a suite with no cases is refused', () => {
  assert.deepEqual(suiteProblems(createSuite()), ['no-cases']);
});

test('a case that checks nothing is reported, because it would pass trivially', () => {
  const suite = createSuite({ cases: [{ goal: 'do something' }] });
  assert.ok(suiteProblems(suite).includes('case-0-no-expectation'));
});

test('a case with no goal is reported', () => {
  const suite = createSuite({ cases: [{ goal: '  ', expectTool: 't' }] });
  assert.ok(suiteProblems(suite).includes('case-0-no-goal'));
});

test('expecting a tool first without naming one is contradictory', () => {
  const suite = createSuite({ cases: [{ goal: 'g', forbidTools: ['x'], expectFirst: true }] });
  assert.ok(suiteProblems(suite).includes('case-0-first-without-tool'));
});

test('expecting and forbidding the same tool is contradictory', () => {
  const suite = createSuite({
    cases: [{ goal: 'g', expectTool: 'a', forbidTools: ['a'] }],
  });
  assert.ok(suiteProblems(suite).includes('case-0-contradictory'));
});

test('a valid suite has no problems', () => {
  const suite = createSuite({ cases: [{ goal: 'g', expectTool: 'a' }] });
  assert.deepEqual(suiteProblems(suite), []);
});

test('tools a suite mentions but the page does not expose are listed', () => {
  const suite = createSuite({
    cases: [
      { goal: 'g', expectTool: 'search_products' },
      { goal: 'h', expectTool: 'gone', forbidTools: ['also_gone', 'add_to_cart'] },
    ],
  });
  const missing = unknownTools(suite, [{ name: 'search_products' }, { name: 'add_to_cart' }]);
  assert.deepEqual(missing.sort(), ['also_gone', 'gone']);
});

test('the number of runs a suite will make is known before starting', () => {
  const suite = createSuite({
    cases: [{ goal: 'g', expectTool: 'a', repeat: 3 }, { goal: 'h', expectTool: 'b', repeat: 2 }],
  });
  assert.equal(totalRuns(suite), 5);
});

test('a starter suite is one case per tool, expecting that tool first', () => {
  const suite = suiteFromTools([
    { name: 'search_products', description: 'Search the catalogue.' },
    { name: 'add_to_cart', description: '' },
  ], 'http://localhost:8777');
  assert.equal(suite.cases.length, 2);
  assert.equal(suite.origin, 'http://localhost:8777');
  assert.equal(suite.cases[0].expectTool, 'search_products');
  assert.ok(suite.cases[0].expectFirst);
  assert.match(suite.cases[0].goal, /Search the catalogue/);
  // A tool with no description still gets a usable goal.
  assert.match(suite.cases[1].goal, /add_to_cart/);
});

test('the tools a run executed are read back under their real names', () => {
  const run = runWith({ calls: ['search_products', 'add_to_cart'] });
  assert.deepEqual(toolsCalled(run), ['search_products', 'add_to_cart']);
});

test('a call that resolved to no tool is recorded as a model mistake, not a tool', () => {
  const run = runWith({ calls: ['ghost'], byAlias: {} });
  assert.deepEqual(toolsCalled(run), [null]);
  const score = scoreRun(aCase(), run);
  assert.equal(score.first, null);
  assert.equal(score.outcome, OUTCOME.fail);
});

test('calling the expected tool passes', () => {
  const score = scoreRun(aCase(), runWith({ calls: ['search_products'] }));
  assert.equal(score.outcome, OUTCOME.pass);
  assert.deepEqual(score.misses, []);
});

test('not calling the expected tool fails, and says which check missed', () => {
  const score = scoreRun(aCase(), runWith({ calls: ['add_to_cart'] }));
  assert.equal(score.outcome, OUTCOME.fail);
  assert.deepEqual(score.misses, ['expected-tool-not-called']);
});

test('calling it but not first fails only when the case asked for first', () => {
  const run = runWith({ calls: ['add_to_cart', 'search_products'] });
  assert.equal(scoreRun(aCase(), run).outcome, OUTCOME.pass);
  const strict = scoreRun(aCase({ expectFirst: true }), run);
  assert.equal(strict.outcome, OUTCOME.fail);
  assert.deepEqual(strict.misses, ['expected-tool-not-first']);
  assert.equal(strict.first, 'add_to_cart');
});

test('a forbidden tool fails the case and is named', () => {
  const score = scoreRun(
    aCase({ forbidTools: ['add_to_cart'] }),
    runWith({ calls: ['search_products', 'add_to_cart'] }));
  assert.equal(score.outcome, OUTCOME.fail);
  assert.deepEqual(score.misses, ['forbidden-tool-called:add_to_cart']);
});

test('a transport failure is errored, never a failure of the page', () => {
  const score = scoreRun(aCase(), runWith({
    status: STATUS.failed, doneReason: DONE_REASON.error, error: '401 Invalid API key',
  }));
  assert.equal(score.outcome, OUTCOME.errored);
  assert.match(score.error, /Invalid API key/);
});

test('a cancelled run is neither a pass nor a failure', () => {
  const score = scoreRun(aCase(), runWith({
    status: STATUS.cancelled, doneReason: DONE_REASON.cancelled,
  }));
  assert.equal(score.outcome, OUTCOME.cancelled);
});

test('hitting a budget is recorded without deciding the verdict', () => {
  const score = scoreRun(aCase(), runWith({
    calls: ['search_products'], doneReason: DONE_REASON.stepLimit,
  }));
  assert.equal(score.outcome, OUTCOME.pass);
  assert.equal(score.hitBudget, true);
});

test('a case is only a pass when every judged attempt passed', () => {
  const entry = aCase({ repeat: 3 });
  const result = scoreCase(entry, [
    runWith({ calls: ['search_products'] }),
    runWith({ calls: ['add_to_cart'] }),
    runWith({ calls: ['search_products'] }),
  ]);
  assert.equal(result.outcome, OUTCOME.fail);
  assert.equal(result.passes, 2);
  assert.equal(result.attempts, 3);
  assert.equal(result.passRate, 2 / 3);
});

test('errored attempts are excluded from the rate, not counted as failures', () => {
  const result = scoreCase(aCase({ repeat: 3 }), [
    runWith({ calls: ['search_products'] }),
    runWith({ status: STATUS.failed, doneReason: DONE_REASON.error, error: 'down' }),
    runWith({ calls: ['search_products'] }),
  ]);
  assert.equal(result.passRate, 1);
  assert.equal(result.errored, 1);
  assert.equal(result.outcome, OUTCOME.pass);
});

test('a case where nothing could be judged has no pass rate at all', () => {
  const result = scoreCase(aCase({ repeat: 2 }), [
    runWith({ status: STATUS.failed, doneReason: DONE_REASON.error, error: 'down' }),
    runWith({ status: STATUS.failed, doneReason: DONE_REASON.error, error: 'down' }),
  ]);
  // Not 0: "the model always got it wrong" would be a different and false statement.
  assert.equal(result.passRate, null);
  assert.equal(result.outcome, OUTCOME.errored);
});

test('the tools the model reached for first are tallied, most frequent first', () => {
  const result = scoreCase(aCase({ repeat: 3 }), [
    runWith({ calls: ['add_to_cart'] }),
    runWith({ calls: ['add_to_cart'] }),
    runWith({ calls: ['search_products'] }),
  ]);
  assert.deepEqual(result.firstChoices, [
    { value: 'add_to_cart', count: 2 },
    { value: 'search_products', count: 1 },
  ]);
});

test('a suite result separates passed, failed and errored', () => {
  const suite = createSuite({
    cases: [
      { goal: 'a', expectTool: 'search_products' },
      { goal: 'b', expectTool: 'add_to_cart' },
      { goal: 'c', expectTool: 'search_products' },
    ],
  });
  const [c1, c2, c3] = suite.cases;
  const result = scoreSuite(suite, {
    [c1.id]: [runWith({ calls: ['search_products'] })],
    [c2.id]: [runWith({ calls: ['search_products'] })],
    [c3.id]: [runWith({ status: STATUS.failed, doneReason: DONE_REASON.error, error: 'down' })],
  });
  assert.equal(result.passed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.errored, 1);
  assert.equal(result.total, 3);
  assert.equal(result.passRate, 0.5);
});

const suiteFor = (outcomes) => ({
  passRate: null,
  cases: outcomes.map(([caseId, outcome, passRate, first]) => ({
    caseId, goal: caseId, expectTool: 'search_products', outcome,
    passes: 0, attempts: 1, passRate, errored: 0,
    firstChoices: first ? [{ value: first, count: 1 }] : [],
    misses: [],
  })),
});

test('a case that went from failing to passing is reported as fixed', () => {
  const out = compareSuites(
    suiteFor([['c1', OUTCOME.fail, 0]]),
    suiteFor([['c1', OUTCOME.pass, 1]]));
  assert.equal(out.cases[0].change, CHANGE.fixed);
  assert.equal(out.cases[0].passRateDelta, 1);
  assert.equal(out.improved, true);
  assert.equal(out.regressed, false);
});

test('a case that went from passing to failing is reported as broken', () => {
  const out = compareSuites(
    suiteFor([['c1', OUTCOME.pass, 1]]),
    suiteFor([['c1', OUTCOME.fail, 0]]));
  assert.equal(out.cases[0].change, CHANGE.broken);
  assert.equal(out.regressed, true);
});

test('a regression is reported even when more cases improved', () => {
  const out = compareSuites(
    suiteFor([['c1', OUTCOME.fail, 0], ['c2', OUTCOME.fail, 0], ['c3', OUTCOME.pass, 1]]),
    suiteFor([['c1', OUTCOME.pass, 1], ['c2', OUTCOME.pass, 1], ['c3', OUTCOME.fail, 0]]));
  assert.equal(out.counts[CHANGE.fixed], 2);
  assert.equal(out.counts[CHANGE.broken], 1);
  assert.equal(out.regressed, true);
});

test('a case nobody could judge is never called broken', () => {
  const out = compareSuites(
    suiteFor([['c1', OUTCOME.pass, 1]]),
    suiteFor([['c1', OUTCOME.errored, null]]));
  assert.equal(out.cases[0].change, CHANGE.unjudged);
  assert.equal(out.regressed, false);
  assert.equal(out.cases[0].passRateDelta, null);
});

test('progress inside a still-failing case is visible in the rate', () => {
  const out = compareSuites(
    suiteFor([['c1', OUTCOME.fail, 0]]),
    suiteFor([['c1', OUTCOME.fail, 0.4]]));
  assert.equal(out.cases[0].change, CHANGE.stillFailing);
  assert.equal(out.cases[0].passRateDelta, 0.4);
});

test('a change in which tool the model reaches for first is flagged', () => {
  const out = compareSuites(
    suiteFor([['c1', OUTCOME.fail, 0, 'add_to_cart']]),
    suiteFor([['c1', OUTCOME.pass, 1, 'search_products']]));
  assert.equal(out.cases[0].firstChoiceChanged, true);
});

test('a case present on only one side is carried, not dropped', () => {
  const out = compareSuites(
    suiteFor([['c1', OUTCOME.pass, 1]]),
    suiteFor([['c1', OUTCOME.pass, 1], ['c2', OUTCOME.fail, 0]]));
  assert.equal(out.cases.length, 2);
  assert.equal(out.cases[1].change, CHANGE.unjudged);
  assert.equal(out.cases[1].before, null);
});
test('an interrupted action is unjudgeable, never a passing evaluation',()=>{
  const run=runWith({calls:['search_products'],status:STATUS.interrupted,doneReason:DONE_REASON.interrupted,error:'Effect unknown'});
  const score=scoreRun(aCase(),run);assert.equal(score.outcome,OUTCOME.errored);
  assert.equal(score.reason,'interrupted');assert.deepEqual(score.called,['search_products']);
  assert.equal(scoreCase(aCase(),[run]).passRate,null);
});
