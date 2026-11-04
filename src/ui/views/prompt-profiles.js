// Prompt profiles: the persona the Agent Lab answers as (F13).
//
// One select picks the active prompt; the folded editor writes them. A profile is a name and
// the system-prompt text — nothing else: it carries no key and no endpoint, and the tool
// schemas, the tool-call format and the safety refusals live in the transport and the loop,
// not here, so no prompt can switch them off. The default entry is not a profile: it is what
// ships with the product (core/agent's DEFAULT_SYSTEM), and it is always the fallback — for
// an un-profiled configuration and for a deleted selection alike.

import { el, t } from '../dom.js';
import { DEFAULT_PROMPT_TEXT } from '../../storage/prompt-profiles.js';

// Returns the section element; the caller places it among the setup rows. `onChange` is the
// setup screen's own save channel (agent-config-save patches), so picking a profile is one
// ordinary configuration act, not a second write path.
export function renderPromptProfiles({ profiles, activeId, onChange }) {
  const section = el('div', { class: 'field pp-section' });

  // The composer's always-visible bar owns the id `ag-prompt`; this copy in the setup fold
  // is the same control, so its id says which copy it is.
  const select = el('select', { id: 'ag-prompt-setup', title: t('prompt_chooseHelp') });
  const defaultOption = el('option', { value: '', text: t('prompt_defaultLabel') });
  defaultOption.selected = !activeId;
  select.append(defaultOption);
  for (const p of profiles) {
    const option = el('option', { value: p.id, text: p.name });
    option.selected = p.id === activeId;
    select.append(option);
  }
  // The profile list itself never rewrites through this channel — only the active id.
  select.addEventListener('change', () => onChange({ promptProfileId: select.value || null }));

  section.append(
    el('label', { class: 'field-label', for: 'ag-prompt-setup', text: t('prompt_choose') }),
    select,
    el('p', { class: 'field-desc', text: t('prompt_help') }),
    editor(profiles, onChange),
  );
  return section;
}

function editor(profiles, onChange) {
  const list = el('div', { class: 'pp-list' });
  for (const p of profiles) list.append(profileRow(p, onChange, profiles));
  if (!profiles.length) {
    list.append(el('p', { class: 'field-desc', text: t('prompt_none') }));
  }

  const name = el('input', {
    type: 'text', id: 'pp-name', maxlength: '40', title: t('prompt_nameHelp'),
  });
  const text = el('textarea', {
    id: 'pp-text', rows: '6', title: t('prompt_textHelp'),
    placeholder: t('prompt_textPlaceholder'),
  });
  const status = el('p', { class: 'field-note', id: 'pp-status', role: 'status' });
  const save = el('button', { class: 'primary', text: t('prompt_save'), title: t('prompt_saveHelp') });
  const cancel = el('button', { text: t('prompt_cancel'), title: t('prompt_cancelHelp') });

  // Editing an existing profile reuses the same form: the row's edit button loads it here and
  // Save updates it in place. The id the form carries decides update-versus-create.
  let editingId = null;
  const clear = () => {
    editingId = null;
    name.value = '';
    text.value = '';
    save.textContent = t('prompt_save');
  };
  cancel.addEventListener('click', clear);

  for (const btn of list.querySelectorAll('.pp-edit')) {
    btn.addEventListener('click', () => {
      const profile = profiles.find((p) => p.id === btn.dataset.id);
      if (!profile) return;
      editingId = profile.id;
      name.value = profile.name;
      text.value = profile.text;
      save.textContent = t('prompt_update');
      name.focus();
    });
  }

  save.addEventListener('click', async () => {
    save.disabled = true;
    status.textContent = '';
    const out = await chrome.runtime.sendMessage({
      type: 'prompt-profile-save',
      id: editingId, name: name.value.trim(), text: text.value,
    });
    save.disabled = false;
    if (out?.errors?.length) { status.textContent = out.errors.join(' '); return; }
    if (out?.error) { status.textContent = out.error; return; }
    clear();
    status.textContent = t('prompt_saved');
    onChange({});
  });

  const showDefault = el('details', { class: 'pp-default' }, [
    el('summary', { text: t('prompt_showDefault'), title: t('prompt_showDefaultHelp') }),
    el('pre', { class: 'pp-default-text mono', text: DEFAULT_PROMPT_TEXT }),
  ]);

  return el('details', { class: 'pp-host' }, [
    el('summary', { text: t('prompt_manage'), title: t('prompt_manageHelp') }),
    list,
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'pp-name', text: t('prompt_name') }),
      name,
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'pp-text', text: t('prompt_text') }),
      text,
    ]),
    el('div', { class: 'row-inline' }, [save, cancel, status]),
    showDefault,
  ]);
}

function profileRow(profile, onChange, all) {
  const del = el('button', { text: t('prompt_delete'), title: t('prompt_deleteHelp') });
  del.addEventListener('click', async () => {
    const out = await chrome.runtime.sendMessage({ type: 'prompt-profile-delete', id: profile.id });
    if (out?.deleted) onChange({});
  });
  const edit = el('button', {
    class: 'pp-edit', text: t('prompt_edit'), title: t('prompt_editHelp'),
  });
  edit.dataset.id = profile.id;
  return el('div', { class: 'pp-row' }, [
    el('div', { class: 'cc-row-main' }, [
      el('span', { class: 'cc-label', text: profile.name }),
      el('span', { class: 'cc-meta', text: profile.text.slice(0, 80) }),
    ]),
    el('div', { class: 'row-inline' }, [edit, del]),
  ]);
}
