// Saved calls for one tool: the argument sets a developer keeps coming back to, kept across
// reloads and deploys, and re-checked against the schema as it is now.
//
// A saved call may carry an expectation — the call succeeds, fails, or returns the same result
// as the run on screen — and is then a check: Run judges the outcome and says what broke, in
// the row. "Run all checks" does that for every check of the tool, one after the other. A call
// without expectation is a bookmark, and running it judges nothing (core/saved-calls.js).
//
// It lives under the arguments editor, folded by default. A call whose arguments no longer fit
// the schema is flagged `needs review` and cannot be run from here — it can be loaded into the
// editor, fixed and saved again. Nothing here deletes on the user's behalf.

import { el, badge, t } from '../dom.js';
import {
  createSavedCall, reviewSavedCall, judgeSavedCall, expectationFromOutcome, REVIEW, EXPECT, VERDICT,
} from '../../core/saved-calls.js';
import { validateArguments } from '../../core/schema/validate.js';
import { fieldCheckEditor } from '../components/field-check-editor.js';
import { fieldRuleDescription } from '../../core/field-checks.js';

const when = (ms) => new Date(ms).toLocaleString();

// Verdicts and "Run all" summaries outlive one render: running a call rebuilds the detail
// screen around its result, and the box drawn afterwards must still show what was judged.
const VERDICTS = new Map();
const SUMMARIES = new Map();

function preview(args) {
  const text = JSON.stringify(args ?? {});
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

const short = (text) => (text.length > 60 ? `${text.slice(0, 57)}…` : text);

// The expectation, in words, for the badge's tooltip.
export function expectationHelp(expect) {
  if (!expect) return '';
  if (expect.kind === EXPECT.fields) return (expect.rules ?? []).map(fieldRuleDescription).join('\n');
  if (expect.kind === EXPECT.ok) return t('savedCalls_checkOkHelp');
  if (expect.kind === EXPECT.error) return t('savedCalls_checkErrorHelp');
  if (expect.kind === EXPECT.equals) return t('savedCalls_checkEqualsHelp', [short(expect.value ?? '')]);
  return t('savedCalls_checkJsonHelp', [short(expect.value ?? '')]);
}

export function verdictLine(judgement) {
  const text = judgement.verdict === VERDICT.pass
    ? t('savedCalls_pass', [judgement.reason])
    : judgement.verdict === VERDICT.fail
      ? t('savedCalls_fail', [judgement.reason])
      : t('savedCalls_noVerdict', [judgement.reason]);
  const tone = judgement.verdict === VERDICT.pass ? 'sc-pass' : judgement.verdict === VERDICT.fail ? 'sc-fail' : 'sc-none';
  const line = el('div', { class: `sc-verdict ${tone}` }, [el('p', { class: 'field-note', text })]);
  if (judgement.rules?.length) line.append(el('details', { class: 'fc-verdict' }, [
    el('summary', { text: t('fieldChecks_ruleResults', [String(judgement.rules.length)]), title: t('fieldChecks_ruleResultsHelp') }),
    ...judgement.rules.map(rule => el('p', { class: `field-note ${rule.pass ? 'sc-pass' : 'sc-fail'}`, text: `${rule.pass ? '✓' : '✕'} ${rule.reason}` })),
  ]));
  return line;
}

export function renderSavedCalls(root, { tool, topOrigin = null, draft = {}, currentArguments, onLoad, onRun, lastOutcome = () => null, onRerender = null }) {
  const summary = el('summary', { text: t('savedCalls_title'), title: t('help_savedCalls') });
  const listHost = el('div', {}, [el('p', { class: 'field-desc', text: t('savedCalls_none') })]);
  // The save/error line. Identified and announced: it is a live region, and the scenario
  // test needs one unambiguous selector — `.field-note` alone also matches the collapsed
  // field-check editor's own notes, which are empty most of the time. Both the id and the
  // class are kept: the two merged scenario suites select it each their own way.
  const status = el('p', { class: 'field-note sc-status', id: 'sc-status', role: 'status', hidden: '' });

  const name = el('input', {
    type: 'text', id: 'sc-name', placeholder: t('savedCalls_namePlaceholder'),
    title: t('savedCalls_saveHelp'),
    'aria-label': t('savedCalls_namePlaceholder'),
  });
  name.value = draft.name ?? '';
  name.addEventListener('input', () => { draft.name = name.value; });

  // What the result must be. "The same result as the last run" is only offered when there is
  // a run on screen to take it from, and it is the default then: a result you are looking at
  // is the most natural thing to pin down.
  const expect = el('select', { id: 'sc-expect', title: t('savedCalls_expectHelp') });
  const outcome = lastOutcome();
  expect.append(
    el('option', { value: 'none', text: t('savedCalls_expectNone') }),
    el('option', { value: 'ok', text: t('savedCalls_expectOk') }),
    el('option', { value: 'error', text: t('savedCalls_expectError') }),
  );
  if (outcome && outcome.code !== 'cancelled') {
    expect.append(el('option', { value: 'result', text: t('savedCalls_expectLastResult') }));
    expect.value = 'result';
  }
  expect.append(el('option', { value: 'fields', text: t('fieldChecks_expectFields') }));
  if (draft.originalExpect) expect.append(el('option', { value: 'keep', text: t('fieldChecks_keepSaved') }));
  if (draft.mode && [...expect.options].some(o => o.value === draft.mode)) expect.value = draft.mode;
  const fields = fieldCheckEditor({ draft: (draft.fields ??= {}), outcome });
  fields.element.hidden = expect.value !== 'fields';
  expect.addEventListener('change', () => { draft.mode = expect.value; fields.element.hidden = expect.value !== 'fields'; });

  const save = el('button', { text: t('savedCalls_save'), title: t('savedCalls_saveHelp') });
  save.addEventListener('click', async () => {
    status.hidden = true;
    let args = currentArguments();
    // Editing only an expectation must not materialize defaults/unchecked booleans from
    // the generated form into arguments that were originally omitted. Deliberate argument
    // edits still use the normal editor's values and validation.
    if (draft.id && JSON.stringify(args) === JSON.stringify(draft.editorArgsAtLoad)) {
      args = structuredClone(draft.originalArgs);
    }
    const check = args === null || args === undefined ? { valid: false } : validateArguments(tool.inputSchema, args);
    if (!check.valid) {
      say(t('savedCalls_notValid'));
      return;
    }
    let selected;
    try { selected = chosenExpectation(); } catch (error) { say(error.message); return; }
    save.disabled = true;
    const saved = createSavedCall({ tool, topOrigin, id: draft.id, name: name.value, args, expect: selected });
    let out;
    try { out = await chrome.runtime.sendMessage({ type: 'saved-call-save', saved }); }
    catch (error) { say(error.message); return; }
    finally { save.disabled = false; }
    if (out?.error) return say(out.error);
    name.value = '';
    draft.name = ''; draft.id = undefined;
    say(t('savedCalls_saved', [String(out.kept)]));
    box.open = true;
    await refresh();
  });

  const runAll = el('button', { text: t('savedCalls_runAll'), title: t('savedCalls_runAllHelp'), hidden: '' });
  runAll.addEventListener('click', runAllChecks);

  const box = el('details', { class: 'sc-bar' });
  box.append(
    summary,
    el('div', { class: 'row-inline' }, [name, save]),
    el('div', { class: 'row-inline' }, [
      el('label', { class: 'field-label', for: 'sc-expect', text: t('savedCalls_expectLabel') }), expect, runAll,
    ]),
    fields.element,
    status,
    listHost,
  );
  box.open = draft.open === true;
  box.addEventListener('toggle', () => { draft.open = box.open; });
  root.append(box);

  refresh();

  function chosenExpectation() {
    const value = expect.value;
    if (value === 'fields') return fields.expectation();
    if (value === 'keep') return draft.originalExpect;
    if (value === 'ok') return { kind: EXPECT.ok };
    if (value === 'error') return { kind: EXPECT.error };
    if (value === 'result') return expectationFromOutcome(lastOutcome());
    return null;
  }

  function say(text) {
    status.textContent = text;
    status.hidden = false;
  }

  let calls = [];
  const verdicts = VERDICTS;
  // A summary from an earlier "Run all checks" on this tool, still worth showing.
  if (SUMMARIES.has(tool.logicalId)) say(SUMMARIES.get(tool.logicalId));

  async function refresh() {
    const list = await chrome.runtime.sendMessage({ type: 'saved-calls-list', logicalId: tool.logicalId });
    calls = Array.isArray(list) ? list : [];
    summary.textContent = calls.length
      ? t('savedCalls_titleCount', [String(calls.length)])
      : t('savedCalls_title');
    runAll.hidden = !calls.some((saved) => saved.expect);
    if (!calls.length) {
      listHost.replaceChildren(el('p', { class: 'field-desc', text: t('savedCalls_none') }));
      return;
    }
    listHost.replaceChildren(...calls.map((saved) => row(saved)));
  }

  // Runs every check in order; a call that needs review is not run and says why.
  async function runAllChecks() {
    runAll.disabled = true;
    const counts = { pass: 0, fail: 0, skipped: 0, bookmarks: 0 };
    for (const saved of calls) {
      if (!saved.expect) { counts.bookmarks += 1; continue; }
      const review = reviewSavedCall(saved, tool);
      if (review.status === REVIEW.needsReview) {
        counts.skipped += 1;
        verdicts.set(saved.id, { verdict: VERDICT.notAcheck, reason: t('savedCalls_skippedNeedsReview', [review.problems[0] ?? '']) });
        continue;
      }
      const judgement = judgeSavedCall(saved, await onRun(structuredClone(saved.args)));
      verdicts.set(saved.id, judgement);
      if (judgement.verdict === VERDICT.pass) counts.pass += 1;
      else if (judgement.verdict === VERDICT.fail) counts.fail += 1;
    }
    runAll.disabled = false;
    const summary = t('savedCalls_runAllSummary', [String(counts.pass), String(counts.fail), String(counts.skipped), String(counts.bookmarks)]);
    SUMMARIES.set(tool.logicalId, summary);
    // The screen was rebuilt around the last result; draw the box again where it is now.
    if (onRerender) onRerender();
    else {
      say(summary);
      listHost.replaceChildren(...calls.map((saved) => row(saved)));
      box.open = true;
    }
  }

  function row(saved) {
    const review = reviewSavedCall(saved, tool);
    const chips = [];
    if (saved.expect) chips.push(badge(t('savedCalls_checkBadge'), 'ok', expectationHelp(saved.expect)));
    if (review.status === REVIEW.needsReview) {
      chips.push(badge(t('savedCalls_needsReview'), 'warn',
        [t('savedCalls_needsReviewHelp'), ...review.problems].join('\n')));
    } else if (review.contractChanged) {
      chips.push(badge(t('savedCalls_contractChanged'), 'accent', t('savedCalls_contractChangedHelp')));
    }

    const load = el('button', { text: t('savedCalls_load'), title: t('savedCalls_loadHelp') });
    load.addEventListener('click', () => onLoad(structuredClone(saved.args)));
    const edit = el('button', { text: t('fieldChecks_editSaved'), title: t('fieldChecks_editSavedHelp') });
    edit.addEventListener('click', () => {
      draft.id = saved.id; draft.name = saved.name; draft.open = true;
      draft.originalArgs = structuredClone(saved.args);
      draft.originalExpect = structuredClone(saved.expect);
      draft.mode = saved.expect?.kind === EXPECT.fields ? 'fields' : saved.expect ? 'keep' : 'none';
      draft.fields = { rules: structuredClone(saved.expect?.rules ?? []) };
      onLoad(structuredClone(saved.args));
      draft.editorArgsAtLoad = structuredClone(currentArguments());
      root.querySelector('#sc-name')?.focus();
    });

    const run = el('button', { text: t('savedCalls_run'), title: t('savedCalls_runHelp') });
    if (review.status === REVIEW.needsReview) {
      run.disabled = true;
      run.title = t('savedCalls_runBlocked', [review.problems[0] ?? '']);
    }
    run.addEventListener('click', async () => {
      const result = await onRun(structuredClone(saved.args));
      if (!saved.expect) return;
      verdicts.set(saved.id, judgeSavedCall(saved, result));
      // The screen was rebuilt around the result; the verdict is drawn where the row is now.
      if (onRerender) onRerender();
      else {
        const current = listHost.querySelector(`[data-saved="${saved.id}"]`);
        if (current) current.replaceWith(row(saved));
      }
    });

    const remove = el('button', { text: t('savedCalls_delete'), title: t('savedCalls_deleteHelp') });
    remove.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'saved-call-delete', logicalId: tool.logicalId, id: saved.id });
      verdicts.delete(saved.id);
      await refresh();
    });

    const judgement = saved.expect ? verdicts.get(saved.id) : null;
    return el('div', { class: 'card sc-row', 'data-saved': saved.id }, [
      el('p', { class: 'card-name', text: saved.name }),
      el('p', { class: 'card-origin mono', text: preview(saved.args) }),
      el('p', { class: 'card-origin', text: t('savedCalls_savedAt', [when(saved.savedAt)]) }),
      chips.length ? el('div', { class: 'card-meta' }, chips) : null,
      judgement ? verdictLine(judgement) : null,
      el('div', { class: 'row-inline' }, [load, run, edit, remove]),
    ]);
  }
}
