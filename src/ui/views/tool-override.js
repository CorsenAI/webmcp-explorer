// The Mock Lab: change what a tool looks like and what it returns, without touching the
// site (D-004 rule 6, D-030).
//
// Everything here is applied on Explorer's side of the boundary. The original description
// and schema stay visible next to the replacement, because an override the user cannot
// compare against the real thing is a trap rather than a tool.

import { el, badge, t } from '../dom.js';
import { createOverride, MOCK_MODES } from '../../core/overrides.js';

function modeLabel(mode) {
  const map = {
    off: t('toolOverride_off'),
    success: t('toolOverride_success'),
    empty: t('toolOverride_emptyResult'),
    error: t('toolOverride_error'),
    timeout: t('toolOverride_timeout'),
    malformed: t('toolOverride_malformed'),
  };
  return map[mode];
}

function modeHelpText(mode) {
  const map = {
    off: t('toolOverride_callsReachTheRealTool'),
    success: t('toolOverride_returnThePayloadBelowInstead'),
    empty: t('toolOverride_returnAnEmptyStringThe'),
    error: t('toolOverride_failWithTheMessageBelow'),
    timeout: t('toolOverride_failAsATimeoutAfter'),
    malformed: t('toolOverride_returnDeliberatelyInvalidJsonTo'),
  };
  return map[mode];
}

export function renderToolOverride(root, { tool, existing, onSaved, onRemoved }) {
  const state = existing
    ? structuredClone(existing)
    : createOverride(tool.logicalId);
  state.mock = state.mock ?? createOverride(tool.logicalId).mock;

  const disable = el('input', { type: 'checkbox', id: 'ov-disable' });
  disable.checked = Boolean(state.disabled);

  const description = el('textarea', { id: 'ov-desc', rows: '3' });
  description.value = state.description ?? '';
  description.placeholder = t('toolOverride_leaveEmptyToKeepThe');

  const schema = el('textarea', { id: 'ov-schema', rows: '5', class: 'mono' });
  schema.value = state.inputSchema ? JSON.stringify(state.inputSchema, null, 2) : '';
  schema.placeholder = t('toolOverride_leaveEmptyToKeepThe2');

  const payload = el('textarea', { id: 'ov-payload', rows: '4', class: 'mono' });
  payload.value = state.mock.result ?? '';

  const errorText = el('input', { type: 'text', id: 'ov-error' });
  errorText.value = state.mock.error ?? '';
  errorText.placeholder = t('toolOverride_simulatedFailure');

  const latency = el('input', { type: 'number', id: 'ov-latency', min: '0', step: '50' });
  latency.value = String(state.mock.latencyMs ?? 0);

  const once = el('input', { type: 'checkbox', id: 'ov-once' });
  once.checked = Boolean(state.mock.once);

  const modeHelp = el('p', { class: 'field-desc' });
  const modes = el('div', { class: 'radio-group' });
  for (const mode of MOCK_MODES) {
    const id = `ov-mode-${mode}`;
    const input = el('input', { type: 'radio', name: 'ov-mode', id, value: mode });
    input.checked = (state.mock.mode ?? 'off') === mode;
    input.addEventListener('change', () => {
      state.mock.mode = mode;
      syncMode();
    });
    modes.append(el('label', { class: 'radio', for: id, title: modeHelpText(mode) },
      [input, document.createTextNode(` ${modeLabel(mode)}`)] ));
  }

  const payloadField = field(t('toolOverride_response'), payload);
  const errorField = field(t('toolOverride_errorMessage'), errorText);
  const latencyField = field(t('toolOverride_latencyMs'), latency, t('toolOverride_latencyHelp'));

  const status = el('p', { class: 'field-note', hidden: '' });

  const apply = el('button', { class: 'primary', text: t('toolOverride_applyOverride'), title: t('help_applyOverride') });
  apply.addEventListener('click', save);

  const remove = el('button', { text: t('evalsEditor_remove'), title: t('toolOverride_deleteThisOverrideEntirely') });
  remove.disabled = !existing;
  remove.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'override-delete', logicalId: tool.logicalId });
    onRemoved();
  });

  root.replaceChildren(
    banner(),
    el('div', { class: 'field' }, [
      el('label', { class: 'radio', for: 'ov-disable' },
        [disable, document.createTextNode(t('toolOverride_disableThisTool'))]),
      el('p', { class: 'field-desc', text: t('toolOverride_theToolStaysListedAnd') }),
    ]),
    original(t('toolOverride_descriptionDeclared'), tool.originalDescription ?? tool.description),
    field(t('toolOverride_descriptionOverride'), description),
    original(t('toolOverride_schemaDeclared'), tool.originalInputSchema ?? tool.inputSchema
      ? JSON.stringify(tool.originalInputSchema ?? tool.inputSchema, null, 2)
      : t('toolOverride_none')),
    field(t('toolOverride_schemaOverride'), schema),
    ...(state.annotations ? [el('p', { class: 'field-note', text: t('toolOverride_annotationsActive', [JSON.stringify(state.annotations)]) })] : []),
    el('p', { class: 'field-group', text: t('toolOverride_mockResponse') }),
    modes,
    modeHelp,
    payloadField,
    errorField,
    latencyField,
    el('div', { class: 'field' }, [
      el('label', { class: 'radio', for: 'ov-once' },
        [once, document.createTextNode(t('toolOverride_applyOnceThenUseThe'))]),
    ]),
    status,
    el('div', { class: 'form-actions' }, [apply, remove]),
  );

  syncMode();

  function banner() {
    if (!existing) return el('p', { class: 'field-desc', text: t('toolOverride_noOverrideOnThisTool') });
    return el('div', { class: 'card-meta' }, [badge(t('toolOverride_overrideActive'), 'warn',
      t('toolOverride_explorerIsChangingWhatThis'))]);
  }

  function original(label, value) {
    const box = el('details', { class: 'tree-raw' });
    box.append(el('summary', { text: label, title: t('help_originalOverride') }), el('pre', { class: 'result-body mono', text: value ?? t('toolOverride_none') }));
    return box;
  }

  function field(label, control, help) {
    return el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: control.id, text: label }),
      help ? el('p', { class: 'field-desc', text: help }) : null,
      control,
    ]);
  }

  function syncMode() {
    const mode = state.mock.mode ?? 'off';
    modeHelp.textContent = modeHelpText(mode);
    payloadField.hidden = mode !== 'success';
    errorField.hidden = mode !== 'error';
    latencyField.hidden = mode === 'off';
  }

  async function save() {
    status.hidden = true;
    let parsedSchema = null;
    if (schema.value.trim()) {
      try {
        parsedSchema = JSON.parse(schema.value);
      } catch (cause) {
        status.textContent = t('toolOverride_schemaNotJson', [String(cause.message)]);
        status.hidden = false;
        return;
      }
    }

    const override = {
      logicalId: tool.logicalId,
      enabled: true,
      disabled: disable.checked,
      description: description.value.trim() ? description.value : null,
      inputSchema: parsedSchema,
      // Hints set by "Test this fix" (engine v3) survive an edit of the other fields.
      annotations: state.annotations ?? null,
      mock: {
        mode: state.mock.mode ?? 'off',
        result: payload.value,
        error: errorText.value,
        latencyMs: Number(latency.value) || 0,
        once: once.checked,
      },
    };

    await chrome.runtime.sendMessage({ type: 'override-save', override });
    onSaved(override);
  }
}
