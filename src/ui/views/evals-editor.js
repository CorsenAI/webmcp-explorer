// Editing an eval suite: the goals, and what each one should make the model do.
//
// Every field is a claim the user is making about their own page, so each control says what
// it will check rather than what it is called. "Expect first" in particular is the one that
// finds real problems: a model that eventually calls the right tool after three wrong ones
// has not understood the descriptions.
//
// Two things this deliberately does NOT do, both found by the E2E scenario:
//
//  - It never hands back a whole suite. Each control reports only its own change, and the
//    caller applies it to the live suite. Sending a full copy meant two edits made moments
//    apart were each built from the same stale snapshot, so the first one was silently lost.
//  - It never rebuilds itself on an edit. Only the warnings are refreshed in place, so the
//    control the user is working in keeps its focus and its caret (the D-027 rule).

import { el, badge, t } from '../dom.js';

function problemText(code) {
  const map = {
    'no-goal': t('evalsEditor_hasNoGoal'),
    'no-expectation': t('evalsEditor_checksNothingSoItWould'),
    'first-without-tool': t('evalsEditor_asksForAToolTo'),
    contradictory: t('evalsEditor_expectsAndForbidsTheSame'),
  };
  return map[code] ?? code;
}

// Returns a function that refreshes the warnings without touching anything else.
export function renderSuiteEditor(root, { suite, tools, onRename, onEdit, onRemove, onAdd }) {
  const toolNames = tools.map((tool) => tool.name);

  const name = el('input', { type: 'text', id: 'ev-name' });
  name.value = suite.name;
  name.addEventListener('change', () => onRename(name.value.trim() || t('evalsEditor_untitledSuite')));

  const cases = el('div');
  const refreshers = suite.cases.map((entry, index) => {
    const card = caseCard(entry, index, {
      toolNames,
      onEdit: (patch) => onEdit(index, patch),
      onRemove: () => onRemove(index),
    });
    cases.append(card.node);
    return card.refresh;
  });

  const add = el('button', { text: t('evalsEditor_addACase'), title: t('evalsEditor_oneGoalOneExpectation') });
  add.addEventListener('click', onAdd);

  const datalist = el('datalist', { id: 'ev-tools' });
  for (const toolName of toolNames) datalist.append(el('option', { value: toolName }));

  root.replaceChildren(
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'ev-name', text: t('evalsEditor_suiteName') }),
      name,
      suite.origin
        ? el('p', {
          class: 'field-desc',
          text: t('evalsEditor_writtenAgainstNote', [String(suite.origin)]),
        })
        : null,
    ]),
    datalist,
    cases,
    el('div', { class: 'row-inline' }, [add]),
  );

  return (problems) => {
    refreshers.forEach((refresh, index) => refresh(
      problems
        .filter((code) => code.startsWith(`case-${index}-`))
        .map((code) => code.slice(`case-${index}-`.length)),
    ));
  };
}

function caseCard(entry, index, { toolNames, onEdit, onRemove }) {
  const goal = el('textarea', { id: `ev-goal-${index}`, rows: '2' });
  goal.value = entry.goal;
  goal.placeholder = t('evalsEditor_whatShouldTheAgentBe');
  goal.addEventListener('change', () => onEdit({ goal: goal.value }));

  const expect = el('input', {
    type: 'text', id: `ev-expect-${index}`, class: 'mono', list: 'ev-tools',
    placeholder: t('evalsEditor_toolThatShouldBeCalled'),
  });
  expect.value = entry.expectTool ?? '';

  const first = el('input', { type: 'checkbox', id: `ev-first-${index}` });
  first.checked = entry.expectFirst;
  first.addEventListener('change', () => onEdit({ expectFirst: first.checked }));

  const forbid = el('input', {
    type: 'text', id: `ev-forbid-${index}`, class: 'mono',
    placeholder: t('evalsEditor_toolsThatMustNotBe'),
  });
  forbid.value = entry.forbidTools.join(', ');

  const repeat = el('input', { type: 'number', id: `ev-repeat-${index}`, min: '1', max: '20' });
  repeat.value = String(entry.repeat);
  repeat.addEventListener('change',
    () => onEdit({ repeat: Math.max(1, Math.min(20, Number(repeat.value) || 1)) }));

  const remove = el('button', { text: t('evalsEditor_remove'), title: t('evalsEditor_deleteThisCase') });
  remove.addEventListener('click', onRemove);

  const flags = el('div', { class: 'card-meta' });

  // Naming a tool the page does not expose is worth saying here, while it can still be fixed,
  // rather than at run time where it would look like the model's fault.
  const parseForbid = () => forbid.value.split(',').map((s) => s.trim()).filter(Boolean);
  const refresh = (codes = []) => {
    const chips = codes.map((code) => badge(problemText(code), 'warn'));
    for (const missing of [expect.value.trim(), ...parseForbid()]
      .filter((n) => n && !toolNames.includes(n))) {
      chips.push(badge(t('evalsEditor_notOnThisPage', [String(missing)]), 'danger',
        t('evalsEditor_notOnThisPageHelp')));
    }
    flags.replaceChildren(...chips);
  };

  expect.addEventListener('change', () => {
    onEdit({ expectTool: expect.value.trim() || null });
    refresh();
  });
  forbid.addEventListener('change', () => {
    onEdit({ forbidTools: parseForbid() });
    refresh();
  });

  refresh();

  const node = el('div', { class: 'card ev-case' }, [
    flags,
    goal,
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: expect.id, text: t('evalsEditor_shouldCall') }),
      expect,
    ]),
    el('label', {
      class: 'radio',
      for: first.id,
      title: t('evalsEditor_aModelThatGetsThere'),
    }, [first, document.createTextNode(t('evalsEditor_andCallItFirst'))]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: forbid.id, text: t('evalsEditor_mustNotCall') }),
      forbid,
    ]),
    el('div', { class: 'row-inline' }, [
      el('label', { class: 'field-label', for: repeat.id, text: t('evalsEditor_attempts') }),
      repeat,
      remove,
    ]),
    el('p', {
      class: 'field-desc',
      text: t('evalsEditor_aModelIsNotDeterministic'),
    }),
  ]);

  return { node, refresh };
}
