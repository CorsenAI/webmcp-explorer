// Custom connectors: the user's own model endpoints (F10/D-112).
//
// What a connector is allowed to say is decided in the worker
// (src/storage/custom-connectors.js); this screen collects it. A connector appears in the
// provider list with a "(custom)" mark; the endpoint disclosure, the http refusal and the
// key rules of every provider apply to it unchanged — this editor adds no authority, only a
// description.
//
// The parent owns the provider list: every change here calls onChange, which re-reads the
// configuration and re-renders this section with the fresh connectors.

import { el, t } from '../dom.js';

// The three dialects a connector may speak — the same three every built-in provider uses.
export const DIALECT_LABEL = {
  'openai-chat': 'OpenAI-compatible',
  'anthropic-messages': 'Anthropic messages',
  'gemini-generate': 'Google Gemini',
};

export function renderConnectorEditor(root, { connectors, onChange }) {
  const passphrase=el('input',{type:'password',autocomplete:'off',id:'connector-vault-passphrase',placeholder:t('vault_passphrase'),title:t('vault_passphraseHelp'),'aria-label':t('vault_passphrase')});
  const passHost=field(t('vault_passphrase'),passphrase);passHost.hidden=true;
  chrome.runtime.sendMessage({type:'agent-vault-status'}).then(state=>{passHost.hidden=state?.mode!=='encrypted';}).catch(()=>{});
  const list = el('div', { class: 'cc-list' });
  for (const c of connectors) list.append(connectorRow(c, onChange, passphrase));
  if (!connectors.length) {
    list.append(el('p', { class: 'field-desc', text: t('connector_none') }));
  }

  const form = addForm(onChange);
  root.replaceChildren(
    el('p', { class: 'field-desc', text: t('connector_help') }),
    passHost,
    list,
    form,
  );
}

function connectorRow(connector, onChange, passphrase) {
  const status=el('p',{class:'field-note',role:'status',hidden:true});
  const del = el('button', { text: t('connector_delete'), title: t('connector_deleteHelp') });
  del.addEventListener('click', async () => {
    del.disabled=true;
    try {
      const out=await chrome.runtime.sendMessage({type:'connector-delete',id:bareId(connector.id),passphrase:passphrase.value});
      if(out?.deleted)onChange({});else {status.hidden=false;status.textContent=t('vault_error');}
    } catch {status.hidden=false;status.textContent=t('vault_error');}
    finally {passphrase.value='';del.disabled=false;}
  });
  return el('div', { class: 'cc-row' }, [
    el('div', { class: 'cc-row-main' }, [
      el('span', { class: 'cc-label', text: connector.label }),
      el('span', {
        class: 'cc-meta mono',
        text: `${DIALECT_LABEL[connector.dialect] ?? connector.dialect} · ${connector.baseUrl}`,
        title: connector.baseUrl,
      }),
    ]),
    del,status,
  ]);
}

// The panel knows the configuration id (`custom:<uuid>`); the worker keys by the bare id.
function bareId(id) {
  return id.startsWith('custom:') ? id.slice('custom:'.length) : id;
}

function addForm(onChange) {
  const name = el('input', { type: 'text', id: 'cc-name', maxlength: '60', title: t('connector_nameHelp') });
  const dialect = el('select', { id: 'cc-dialect', title: t('connector_dialectHelp') });
  for (const [value, label] of Object.entries(DIALECT_LABEL)) {
    dialect.append(el('option', { value, text: label }));
  }
  const url = el('input', {
    type: 'url', id: 'cc-url', class: 'mono', placeholder: 'https://host/v1',
    title: t('connector_urlHelp'),
  });
  const keyNeeded = el('input', { type: 'checkbox', id: 'cc-key', title: t('connector_keyHelp') });

  const add = el('button', { class: 'primary', text: t('connector_add'), title: t('connector_addHelp') });
  const status = el('p', { class: 'field-note', id: 'cc-status', role: 'status' });

  add.addEventListener('click', async () => {
    add.disabled = true;
    status.textContent = '';
    const out = await chrome.runtime.sendMessage({
      type: 'connector-add',
      label: name.value.trim(),
      dialect: dialect.value,
      baseUrl: url.value.trim(),
      keyRequired: keyNeeded.checked,
    });
    add.disabled = false;
    if (out?.errors?.length) { status.textContent = out.errors.join(' '); return; }
    if (out?.error) { status.textContent = out.error; return; }
    name.value = ''; url.value = ''; keyNeeded.checked = false;
    status.textContent = t('connector_added');
    onChange({});
  });

  return el('div', { class: 'cc-add' }, [
    el('h4', { class: 'field-label', text: t('connector_addOne') }),
    field(t('connector_name'), name),
    field(t('connector_dialect'), dialect),
    field(t('connector_url'), url),
    field(t('connector_key'), el('div', { class: 'row-inline' }, [keyNeeded])),
    el('div', { class: 'row-inline' }, [add, status]),
  ]);
}

function field(labelText, control) {
  return el('div', { class: 'field' }, [
    el('label', { class: 'field-label', text: labelText }),
    control,
  ]);
}
