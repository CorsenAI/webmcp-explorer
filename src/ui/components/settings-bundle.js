// The settings bundle (F14): carry what you configured to another browser or machine.
//
// Export is one JSON download built by the worker: provider selection, model, budgets, the
// custom connectors (descriptions only) and the prompt profiles. API keys are memory-only by
// rule (D-051) and therefore cannot be in the file — that is stated on the button, not hidden.
// Import is paste-and-apply, the same shape the recipe importer uses: a file the user drops
// into a text box, parsed with JSON.parse and re-validated entry by entry in the worker —
// nothing here trusts the file's own claims.

import { el, t } from '../dom.js';
import { saveText } from '../components/export-bar.js';

export function renderSettingsBundle(host, { onApplied, onFail }) {
  const doExport = async () => {
    exportButton.disabled = true;
    try {
      const out = await chrome.runtime.sendMessage({ type: 'settings-export' });
      if (out?.error) { onFail(out.error); return; }
      const day = new Date().toISOString().slice(0, 10);
      saveText(`webmcp-explorer-settings-${day}`, JSON.stringify(out.bundle, null, 2), 'json');
    } finally {
      exportButton.disabled = false;
    }
  };
  const exportButton = el('button', {
    text: t('settings_bundleExport'), title: t('settings_bundleExportHelp'),
  });
  exportButton.addEventListener('click', doExport);

  const area = el('textarea', {
    rows: '5', class: 'mono', id: 'sb-import',
    placeholder: t('settings_bundleImportPlaceholder'),
    title: t('settings_bundleImportHelp'),
  });
  const status = el('p', { class: 'field-note', id: 'sb-status', role: 'status', hidden: true });
  const say = (text) => { status.textContent = text; status.hidden = false; };
  const importButton = el('button', {
    class: 'primary', text: t('settings_bundleImport'), title: t('settings_bundleImportButtonHelp'),
  });
  importButton.addEventListener('click', async () => {
    let bundle;
    try {
      bundle = JSON.parse(area.value);
    } catch {
      say(t('settings_bundleNotJson'));
      return;
    }
    importButton.disabled = true;
    const out = await chrome.runtime.sendMessage({ type: 'settings-import', bundle });
    importButton.disabled = false;
    area.value = '';
    if (out?.error) { say(out.error); return; }
    say(t('settings_bundleApplied', [
      String(out.connectors), String(out.promptProfiles),
      out.droppedConnectors ? String(out.droppedConnectors) : '0',
    ]));
    onApplied();
  });

  host.replaceChildren(
    el('p', { class: 'field-desc', text: t('settings_bundleBody') }),
    el('div', { class: 'row-inline' }, [exportButton]),
    el('p', { class: 'field-label', for: 'sb-import', text: t('settings_bundleImportTitle') }),
    area,
    el('div', { class: 'row-inline' }, [importButton, status]),
  );
}
