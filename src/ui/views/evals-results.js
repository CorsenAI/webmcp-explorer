// Suite results, and the before/after comparison that is the point of the feature.
//
// Two things this refuses to do, because both would turn a real finding into a wrong number:
// it never shows a pass rate for a case nothing could be judged on, and it never folds an
// errored attempt into a failure. "3/8 passed" is worthless if two of the five were the
// endpoint being down.

import { el, badge, t } from '../dom.js';
import { OUTCOME } from '../../core/evals/score.js';
import { CHANGE } from '../../core/evals/compare.js';
import { staleness, STALE } from '../../core/evals/stale.js';
import { exportBar } from '../components/export-bar.js';
import { evalReport } from '../../core/export/report.js';

function outcomeBadge(outcome) {
  const map = {
    [OUTCOME.pass]: [t('evalsResults_passed'), 'ok'],
    [OUTCOME.fail]: [t('evalsResults_failed'), 'danger'],
    [OUTCOME.errored]: [t('evalsResults_couldNotRun'), 'warn'],
    [OUTCOME.cancelled]: [t('evalsResults_cancelled'), 'warn'],
  };
  return map[outcome] ?? [outcome, 'accent'];
}

function changeBadge(change) {
  const map = {
    [CHANGE.fixed]: [t('evalsResults_fixed'), 'ok', t('evalsResults_fixedHelp')],
    [CHANGE.broken]: [t('evalsResults_broken'), 'danger', t('evalsResults_brokenHelp')],
    [CHANGE.stillPassing]: [t('evalsResults_stillPassing'), 'accent', null],
    [CHANGE.stillFailing]: [t('evalsResults_stillFailing'), 'warn', null],
    [CHANGE.unjudged]: [t('evalsResults_notComparable'), 'warn', t('evalsResults_notComparableHelp')],
  };
  return map[change];
}

function missText(code) {
  if (code === 'expected-tool-not-called') return t('evalsResults_expectedToolNeverCalled');
  if (code === 'expected-tool-not-first') return t('evalsResults_theExpectedToolWasCalled');
  if (code.startsWith('forbidden-tool-called:')) {
    return t('evalsResults_calledForbidden', [code.slice('forbidden-tool-called:'.length)]);
  }
  return code;
}

const percent = (rate) => `${Math.round(rate * 100)}%`;

export function renderResults(root, { result, comparison, before, after, onCompare, currentTools = null }) {
  if (!result) {
    root.replaceChildren(el('p', {
      class: 'muted',
      text: t('evalsResults_noResultYetRunThe'),
    }));
    return;
  }

  // Which cases were judged against a contract that has since moved (L-16 lifted). Only when
  // the page's tools are known; a result is never declared fresh by default.
  const stale = currentTools ? staleness(result, currentTools) : { known: false, byCase: {}, count: 0 };

  const nodes = [summary(result, stale)];
  if (result.unknownTools?.length) {
    nodes.push(el('p', {
      class: 'field-note',
      text: t('evalsResults_unknownToolsNote', [String(result.unknownTools.join(', '))]),
    }));
  }
  if (result.overrides?.length) {
    nodes.push(overrideNote(result.overrides));
  }

  for (const entry of result.cases) nodes.push(caseRow(entry, stale.byCase[entry.caseId] ?? null));

  if (onCompare) {
    const button = el('button', {
      text: t('evalsResults_compareWithThePreviousRun'),
      title: t('evalsResults_sameGoalsRunTwiceWhat'),
    });
    button.addEventListener('click', onCompare);
    nodes.push(el('div', { class: 'form-actions' }, [button]));
  }

  if (comparison) nodes.push(comparisonBlock(comparison, before, after));

  nodes.push(exportBar({
    label: t('evalsResults_exportThisResult'),
    build: () => evalReport(result, { comparison, before }),
    note: t('evalsResults_theReportNamesTheGoals'),
  }));

  root.replaceChildren(...nodes);
}

function summary(result, stale = { count: 0 }) {
  const chips = [];
  chips.push(badge(t('evalsResults_nPassed', [String(result.passed), String(result.total)]),
    result.failed ? 'warn' : 'ok'));
  if (stale.count) {
    chips.push(badge(stale.count === 1
      ? t('evalsResults_staleOne') : t('evalsResults_staleCount', [String(stale.count)]),
    'warn', t('evalsResults_staleHelp')));
  }
  if (result.failed) chips.push(badge(t('evalsResults_nFailed', [String(result.failed)]), 'danger'));
  if (result.errored) {
    chips.push(badge(t('evalsResults_nCouldNotRun', [String(result.errored)]), 'warn',
      t('evalsResults_nCouldNotRunHelp')));
  }
  if (result.cancelled) chips.push(badge(t('evalsResults_cancelled'), 'warn'));
  if (result.passRate !== null) {
    chips.push(badge(t('evalsResults_ofAttempts', [percent(result.passRate)]), 'accent',
      t('evalsResults_ofAttemptsHelp')));
  }
  if (result.label) chips.push(badge(result.label, 'accent', t('evalsResults_yourLabel')));
  return el('div', { class: 'card-meta' }, chips);
}

// A result obtained with a rewritten description is not the same result as one obtained
// without. Saying which overrides were in force is what makes a comparison mean anything.
function overrideNote(overrides) {
  const changed = overrides.filter((o) => o.changedDescription || o.changedSchema);
  const mocked = overrides.filter((o) => o.mockMode !== 'off');
  const disabled = overrides.filter((o) => o.disabled);
  const parts = [];
  if (changed.length) parts.push(t('evalsResults_nRewritten', [String(changed.length)]));
  if (mocked.length) parts.push(t('agentTranscript_nMocked', [String(mocked.length)]));
  if (disabled.length) parts.push(t('evalsResults_nDisabled', [String(disabled.length)]));
  if (!parts.length) return null;

  return el('p', {
    class: 'field-desc',
    text: t('evalsResults_overridesInForceDuringThis', [String(parts.join(', '))]),
  });
}

function caseRow(entry, stale = null) {
  const [text, kind] = outcomeBadge(entry.outcome);
  const chips = [badge(text, kind)];
  if (stale) {
    chips.push(stale.reason === STALE.gone
      ? badge(t('evalsResults_staleGone'), 'warn', t('evalsResults_staleGoneHelp'))
      : badge(t('evalsResults_staleCase'), 'warn', t('evalsResults_staleCaseHelp')));
  }

  if (entry.passRate !== null) {
    chips.push(badge(`${entry.passes}/${entry.attempts - entry.errored}`, 'accent',
      t('evalsResults_attemptsJudged')));
  } else {
    chips.push(badge(t('evalsResults_noRate'), 'warn', t('evalsResults_noRateHelp')));
  }
  if (entry.errored) {
    chips.push(badge(t('evalsResults_nCouldNotRun', [String(entry.errored)]), 'warn'));
  }

  const details = [];
  if (entry.expectTool) {
    details.push(el('p', { class: 'field-desc', text: t('evalsResults_shouldCall1', [String(entry.expectTool)]) }));
  }
  if (entry.firstChoices.length) {
    details.push(el('p', {
      class: 'field-desc',
      // "name (count)" is a data format, not prose; the sentence around it is what translates.
      text: t('evalsResults_reachedForFirst', [entry.firstChoices
        .map((c) => `${c.value} (${c.count})`).join(', ')]),
    }));
  }
  for (const miss of entry.misses) {
    details.push(el('p', {
      class: 'field-desc',
      text: miss.count > 1
        ? t('evalsResults_countTimesMiss', [String(miss.count), missText(miss.value)])
        : missText(miss.value),
    }));
  }

  return el('div', { class: 'card' }, [
    el('div', { class: 'card-meta' }, chips),
    el('p', { class: 'card-desc', text: entry.goal }),
    ...details,
  ]);
}

function comparisonBlock(comparison, before, after) {
  const chips = [];
  if (comparison.improved) chips.push(badge(t('evalsResults_nFixed', [String(comparison.counts.fixed)]), 'ok'));
  if (comparison.regressed) chips.push(badge(t('evalsResults_nBroken', [String(comparison.counts.broken)]), 'danger'));
  if (comparison.netPassRateDelta !== null) {
    const delta = comparison.netPassRateDelta;
    chips.push(badge(t('evalsResults_points', [`${delta >= 0 ? '+' : ''}${Math.round(delta * 100)}`]),
      delta > 0 ? 'ok' : delta < 0 ? 'danger' : 'accent',
      t('evalsResults_pointsHelp')));
  }

  const rows = comparison.cases.map((entry) => {
    const [text, kind, help] = changeBadge(entry.change);
    const chipsRow = [badge(text, kind, help)];
    if (entry.passRateDelta !== null && entry.passRateDelta !== 0) {
      chipsRow.push(badge(
        t('evalsResults_points', [`${entry.passRateDelta > 0 ? '+' : ''}${Math.round(entry.passRateDelta * 100)}`]),
        entry.passRateDelta > 0 ? 'ok' : 'danger',
        t('evalsResults_casePointsHelp')));
    }
    if (entry.firstChoiceChanged) {
      chipsRow.push(badge(t('evalsResults_differentFirstChoice'), 'accent',
        `${entry.before?.firstChoices?.[0]?.value ?? t('evalsResults_nothing')} → `
        + `${entry.after?.firstChoices?.[0]?.value ?? t('evalsResults_nothing')}`));
    }
    return el('div', { class: 'card' }, [
      el('div', { class: 'card-meta' }, chipsRow),
      el('p', { class: 'card-desc', text: entry.goal }),
    ]);
  });

  return el('div', { class: 'ev-compare' }, [
    el('p', { class: 'field-group', text: t('evalsResults_comparedWithThePreviousRun') }),
    el('p', {
      class: 'field-desc',
      text: t('evalsResults_fromArrowTo', [
        before?.label ?? t('evalsResults_previousRun'),
        after?.label ?? t('evalsResults_thisRun'),
      ]),
    }),
    el('div', { class: 'card-meta' }, chips),
    ...rows,
  ]);
}
