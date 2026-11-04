// A small rule form alongside saved calls; the caller owns its draft across detail tabs.
import { el, t } from '../dom.js';
import { readableValue } from './readable-value.js';
import { parseFieldJson, exactJsonText, jsonType } from '../../core/json-pointer.js';
import { FIELD_OPERATORS, MAX_FIELD_RULES, fieldRuleDescription, validateFieldExpectation } from '../../core/field-checks.js';

export function fieldCheckEditor({ draft, outcome }) {
  draft.rules ??= [];
  draft.path ??= '';
  draft.op ??= 'exists';
  draft.value ??= '';
  const root = el('div', { class: 'fc-editor' });
  const notice = el('p', { class: 'field-note', role: 'status', hidden: '' });
  const list = el('div', { class: 'fc-rules' });
  const path = el('input', { type: 'text', class: 'mono fc-path', title: t('fieldChecks_pathHelp'), 'aria-label': t('fieldChecks_path') });
  path.value = draft.path;
  const op = el('select', { class: 'fc-op', title: t('fieldChecks_operatorHelp'), 'aria-label': t('fieldChecks_operator') },
    FIELD_OPERATORS.map(value => el('option', { value, text: t(`fieldChecks_op_${value.replaceAll('-', '_')}`) })));
  op.value = draft.op;
  const value = el('textarea', { rows: '2', class: 'mono fc-value', title: t('fieldChecks_valueHelp'), 'aria-label': t('fieldChecks_value') });
  value.value = draft.value;
  const valueLabel = el('label', { class: 'field-label' }, [document.createTextNode(t('fieldChecks_value')), value]);
  const valueNote = el('p', { class: 'field-desc' });
  const add = el('button', { class: 'fc-add', title: t('fieldChecks_addHelp') });
  const cancel = el('button', { text: t('fieldChecks_cancelEdit'), title: t('fieldChecks_cancelEditHelp') });
  const picker = el('details', { class: 'fc-picker' }, [
    el('summary', { text: t('fieldChecks_chooseResult'), title: t('fieldChecks_chooseResultHelp') }),
  ]);
  let picked = false;
  picker.addEventListener('toggle', () => {
    if (!picker.open || picked) return;
    picked = true;
    try {
      if (outcome?.ok !== true || outcome.resultTruncated) throw Error(t('fieldChecks_needResult'));
      const parsed = parseFieldJson(outcome.result);
      const whole = el('button', { text: t('fieldChecks_wholeResult'), title: t('fieldChecks_wholeResultHelp') });
      whole.addEventListener('click', () => select('', parsed));
      picker.append(el('p', { class: 'field-desc', text: t('fieldChecks_selectHelp') }), whole,
        readableValue(parsed, 0, { onSelect: select }));
    } catch (error) { picker.append(el('p', { class: 'field-note', text: error.message })); }
  });

  for (const control of [path, op, value]) control.addEventListener(control === op ? 'change' : 'input', () => {
    draft.path = path.value; draft.op = op.value; draft.value = value.value; draft.dirty = true;
    sync();
  });
  add.addEventListener('click', () => {
    const rule = { path: draft.path, op: draft.op, ...(['exists', 'missing'].includes(draft.op) ? {} : { value: draft.value }) };
    const error = validateFieldExpectation({ kind: 'fields', version: 1, rules: [rule] });
    if (error) return say(error);
    if (draft.editIndex != null) draft.rules[draft.editIndex] = rule;
    else {
      if (draft.rules.length >= MAX_FIELD_RULES) return say(t('fieldChecks_limit', [String(MAX_FIELD_RULES)]));
      draft.rules.push(rule);
    }
    clearEdit(); paintRules(); say(t('fieldChecks_added')); path.focus();
  });
  cancel.addEventListener('click', () => { clearEdit(); path.focus(); });

  root.append(el('p', { class: 'field-desc', text: t('fieldChecks_intro') }), list, picker,
    el('label', { class: 'field-label' }, [document.createTextNode(t('fieldChecks_path')), path]),
    el('p', { class: 'field-desc', text: t('fieldChecks_pathHelp') }),
    el('label', { class: 'field-label' }, [document.createTextNode(t('fieldChecks_operator')), op]),
    valueLabel, valueNote, el('div', { class: 'row-inline' }, [add, cancel]), notice);
  sync(); paintRules();
  return { element: root, expectation() {
    if (draft.dirty) throw Error(t('fieldChecks_pendingRule'));
    const expect = { kind: 'fields', version: 1, rules: structuredClone(draft.rules) };
    const error = validateFieldExpectation(expect); if (error) throw Error(error);
    return expect;
  } };

  function select(pointer, item) {
    draft.path = path.value = pointer;
    draft.op = op.value = jsonType(item) === 'array' ? 'length-min' : 'equals';
    draft.value = value.value = jsonType(item) === 'array' ? String(item.length ? 1 : 0) : exactJsonText(item);
    draft.dirty = true;
    sync(); picker.open = false; op.focus();
  }
  function sync() {
    valueLabel.hidden = ['exists', 'missing'].includes(op.value);
    valueNote.hidden = valueLabel.hidden;
    valueNote.textContent = op.value === 'text-contains' ? t('fieldChecks_textValueNote') : t('fieldChecks_jsonValueNote');
    add.textContent = draft.editIndex != null ? t('fieldChecks_updateRule') : t('fieldChecks_addRule');
    cancel.hidden = !draft.dirty && draft.editIndex == null;
  }
  function clearEdit() {
    draft.editIndex = null; draft.dirty = false;
    draft.path = path.value = ''; draft.op = op.value = 'exists'; draft.value = value.value = '';
    notice.hidden = true; sync();
  }
  function say(text) { notice.hidden = false; notice.textContent = text; }
  function paintRules() {
    list.replaceChildren(...draft.rules.map((rule, index) => {
      const edit = el('button', { text: t('fieldChecks_editRule'), title: t('fieldChecks_editRuleHelp', [String(index + 1)]) });
      const remove = el('button', { text: t('fieldChecks_removeRule'), title: t('fieldChecks_removeRuleHelp', [String(index + 1)]) });
      edit.addEventListener('click', () => {
        draft.editIndex = index; draft.dirty = false;
        draft.path = path.value = rule.path; draft.op = op.value = rule.op; draft.value = value.value = rule.value ?? '';
        sync(); path.focus();
      });
      remove.addEventListener('click', () => {
        draft.rules.splice(index, 1); clearEdit(); paintRules(); path.focus();
      });
      return el('div', { class: 'card fc-rule' }, [el('p', { class: 'field-note', text: fieldRuleDescription(rule) }),
        el('div', { class: 'row-inline' }, [edit, remove])]);
    }));
  }
}
