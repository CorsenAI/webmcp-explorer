// Renders a form from a schema model and reads arguments back out of it.
// Never uses innerHTML: every label and description comes from the inspected page (D-019).

import { el, t } from '../dom.js';

export function setPath(target, path, value) {
  let cursor = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[path[path.length - 1]] = value;
}

export function getPath(source, path) {
  let cursor = source;
  for (const key of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

function controlFor(field, value) {
  const id = `f-${field.path.join('-')}`;

  if (field.control === 'checkbox') {
    const input = el('input', { type: 'checkbox', id });
    input.checked = value === true;
    return input;
  }

  if (field.control === 'radio') {
    const group = el('div', { class: 'radio-group', role: 'radiogroup' });
    for (const option of field.options ?? []) {
      const optionId = `${id}-${option}`;
      const input = el('input', { type: 'radio', name: id, id: optionId, value: String(option) });
      input.checked = value === option;
      group.append(el('label', { class: 'radio', for: optionId }, [input, document.createTextNode(` ${option}`)]));
    }
    return group;
  }

  if (field.control === 'select') {
    const select = el('select', { id });
    if (!field.required) select.append(el('option', { value: '', text: t('schemaForm_notSpecified') }));
    for (const option of field.options ?? []) {
      const node = el('option', { value: String(option), text: String(option) });
      if (value === option) node.selected = true;
      select.append(node);
    }
    return select;
  }

  if (field.control === 'textarea' || field.control === 'json') {
    const area = el('textarea', { id, rows: field.control === 'json' ? '4' : '3' });
    area.value = field.control === 'json'
      ? (value === undefined ? '' : JSON.stringify(value, null, 2))
      : (value ?? '');
    if (field.control === 'json') area.classList.add('mono');
    return area;
  }

  if (field.control === 'list') {
    const area = el('textarea', { id, rows: '2' });
    area.value = Array.isArray(value) ? value.join('\n') : '';
    area.placeholder = t('schemaForm_oneValuePerLine');
    return area;
  }

  const input = el('input', {
    id,
    type: field.control === 'number' ? 'number' : field.control,
    step: field.integer ? '1' : undefined,
    min: field.minimum,
    max: field.maximum,
  });
  input.value = value === undefined || value === null ? '' : String(value);
  return input;
}

const UNSUPPORTED_HELP = {
  ref: t('schemaForm_thisPropertyUsesRefWhich'),
  'one-of': t('schemaForm_thisPropertyUsesOneofExplorer'),
  'any-of': t('schemaForm_thisPropertyUsesAnyofExplorer'),
  'all-of': t('schemaForm_thisPropertyUsesAllofEdit'),
  'array-of-objects': t('schemaForm_anArrayOfObjectsIs'),
  'array-of-unknown': t('schemaForm_explorerCannotTellWhatThis'),
  'tuple-array': t('schemaForm_tupleArraysAreEditedAs'),
  'union-type': t('schemaForm_thisPropertyAllowsSeveralTypes'),
  'too-deep': t('schemaForm_thisPropertyIsNestedToo'),
};

export function renderForm(root, model, values = {}) {
  root.replaceChildren();

  if (model.fields.length === 0) {
    root.append(el('p', { class: 'muted', text: t('schemaForm_thisToolTakesNoArguments') }));
    return;
  }

  let currentGroup = null;
  for (const field of model.fields) {
    if (field.group && field.group !== currentGroup) {
      currentGroup = field.group;
      root.append(el('p', { class: 'field-group', text: currentGroup }));
    }
    if (!field.group) currentGroup = null;

    const id = `f-${field.path.join('-')}`;
    const label = el('label', { class: 'field-label', for: id, text: field.label });
    if (field.required) {
      label.append(el('span', { class: 'req', text: ' *', title: t('schemaForm_required') }));
    }

    const wrap = el('div', { class: 'field' }, [label]);
    if (field.description) {
      wrap.append(el('p', { class: 'field-desc', text: field.description }));
    }

    const unsupported = model.unsupported.find((u) => u.path.join('.') === field.path.join('.'));
    if (unsupported) {
      wrap.append(el('p', {
        class: 'field-note',
        text: UNSUPPORTED_HELP[unsupported.reason] ?? t('schemaForm_editThisPropertyAsJson'),
      }));
    }

    const control = controlFor(field, getPath(values, field.path));
    control.dataset.path = field.path.join('.');
    control.dataset.control = field.control;
    if (field.description) control.title = field.description;
    wrap.append(control);
    root.append(wrap);
  }
}

// Reads the form back. Empty optional fields are omitted rather than sent as "" — an empty
// string is a value, and sending one where the user left a blank would change the call.
export function readForm(root, model) {
  const out = {};
  const errors = [];

  for (const field of model.fields) {
    const selector = `[data-path="${CSS.escape(field.path.join('.'))}"]`;
    const node = field.control === 'radio'
      ? root.querySelector(`${selector} input:checked`)
      : root.querySelector(selector);

    if (field.control === 'radio') {
      if (node) setPath(out, field.path, node.value);
      continue;
    }
    if (!node) continue;

    if (field.control === 'checkbox') {
      setPath(out, field.path, node.checked);
      continue;
    }

    const raw = node.value;
    if (raw === '' ) {
      if (field.required) {
        errors.push({ path: field.path, message: t('schemaForm_isRequired', [String(field.label)]) });
      }
      continue;
    }

    if (field.control === 'json') {
      try {
        setPath(out, field.path, JSON.parse(raw));
      } catch {
        errors.push({ path: field.path, message: t('schemaForm_notValidJson', [String(field.label)]) });
      }
      continue;
    }

    if (field.control === 'list') {
      const items = raw.split('\n').map((line) => line.trim()).filter(Boolean);
      setPath(out, field.path, field.itemControl === 'number' ? items.map(Number) : items);
      continue;
    }

    if (field.control === 'number') {
      const value = Number(raw);
      if (Number.isNaN(value)) {
        errors.push({ path: field.path, message: t('schemaForm_mustBeNumber', [String(field.label)]) });
        continue;
      }
      setPath(out, field.path, value);
      continue;
    }

    setPath(out, field.path, raw);
  }

  return { values: out, errors };
}
