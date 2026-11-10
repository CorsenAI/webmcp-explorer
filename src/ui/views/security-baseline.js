// The baseline box of the Security section (S3): save today's review as the reference for the
// site, read what changed since, update or forget it. Dates and counts; the detail is the
// findings list above, filtered by the "New since baseline" chip.

import { el, badge, t } from '../dom.js';
import { makeBaseline, diffBaseline } from '../../core/security/baseline.js';
import { severityLabel } from './security.js';
import { saveText } from '../components/export-bar.js';

const when = (ms) => new Date(ms).toLocaleString();
const names = (list) => (list.length ? list.slice(0, 6).join(', ') + (list.length > 6 ? '…' : '') : '—');
const PART_KEY = { description: 'baseline_partDescription', schema: 'baseline_partSchema', annotations: 'baseline_partAnnotations' };
// "name (description, input schema)" when the baseline recorded the parts, else the name alone.
const changedLabel = (c) => (c.parts?.length ? `${c.name} (${c.parts.map((p) => t(PART_KEY[p])).join(', ')})` : c.name);

export function renderBaseline(root, { result, review, baseline, onChanged = () => {} }) {
  const origin = result?.topOrigin ?? null;
  const box = el('details', { class: 'ck-bar sec-baseline' }, [
    el('summary', { text: t('baseline_title'), title: t('baseline_titleHelp') }),
  ]);
  if (baseline) box.open = true;
  root.append(box);
  if (!origin) return null;
  const send = (m) => chrome.runtime.sendMessage(m).catch(() => null);

  const save = async () => {
    const next = makeBaseline(review, result);
    await send({ type: 'security-baseline-save', baseline: next });
    onChanged(next);
  };

  // A baseline file exported from Explorer for this site: the way back after a reinstall, or a
  // colleague's review. The file is read here and checked field by field in the background.
  const importStatus = el('p', { class: 'field-note sec-baseline-import-status', hidden: '' });
  // Not shown: the Import button opens it. It still carries a name and a hint, like every control.
  const picker = el('input', { type: 'file', accept: '.json,application/json', hidden: '', class: 'sec-baseline-file',
    'aria-label': t('baseline_import'), title: t('baseline_importHelp') });
  const importButton = el('button', { text: t('baseline_import'), title: t('baseline_importHelp') });
  importButton.addEventListener('click', () => picker.click());
  picker.addEventListener('change', async () => {
    const chosen = picker.files?.[0];
    picker.value = '';
    if (!chosen) return;
    let file = null;
    if (chosen.size <= 2_000_000) { try { file = JSON.parse(await chosen.text()); } catch { file = null; } }
    const out = await send({ type: 'security-baseline-import', file, origin });
    if (out?.baseline) { onChanged(out.baseline); return; }
    importStatus.hidden = false;
    importStatus.textContent = out?.error === 'other-site' ? t('baseline_importOtherSite', [String(out.origin)]) : t('baseline_importInvalid');
  });

  if (!baseline) {
    const button = el('button', { class: 'primary', text: t('baseline_save'), title: t('baseline_saveHelp') });
    button.addEventListener('click', save);
    box.append(el('p', { class: 'field-desc', text: t('baseline_none') }), el('div', { class: 'row-inline' }, [button, importButton, picker]), importStatus);
    return null;
  }

  const diff = diffBaseline(baseline, review, result);
  box.append(el('p', { class: 'field-desc', text: t('baseline_savedAt', [when(baseline.at), String(baseline.findings.length), String(baseline.tools.length)]) }));
  if (baseline.truncated) box.append(el('p', { class: 'field-note', text: t('baseline_truncated') }));
  const changed = diff.added.length || diff.resolved.length || diff.toolsAdded.length || diff.toolsRemoved.length || diff.contractsChanged.length;
  box.append(el('p', { class: 'field-desc sec-since', title: t('baseline_sinceHelp') }, changed ? [
    diff.regressed ? badge(severityLabel(diff.maxAdded), diff.maxAdded === 'high' || diff.maxAdded === 'critical' ? 'danger' : 'warn') : null,
    el('span', { text: t('baseline_since', [String(diff.added.length), diff.maxAdded ? severityLabel(diff.maxAdded) : 'none', String(diff.resolved.length),
      String(diff.toolsAdded.length), String(diff.toolsRemoved.length), String(diff.contractsChanged.length)]) }),
  ].filter(Boolean) : [el('span', { text: t('baseline_noChange') })]));
  if (diff.newRules?.length) box.append(el('p', { class: 'field-note', text: t('baseline_newRules', [String(diff.newRules.length)]) }));
  if (diff.contractsChanged.length) box.append(el('p', { class: 'field-note sec-contracts-changed', text: t('baseline_toolsChanged', [names(diff.contractsChanged.map(changedLabel))]) }));
  const rewritten = diff.contractsChanged.filter((c) => c.parts?.includes('description')).map((c) => c.name);
  if (rewritten.length) box.append(el('p', { class: 'field-note nn-notice sec-description-changed', text: t('baseline_descriptionChanged', [names(rewritten)]) }));
  if (diff.toolsAdded.length) box.append(el('p', { class: 'field-note', text: t('baseline_toolsAdded', [names(diff.toolsAdded)]) }));
  if (diff.toolsRemoved.length) box.append(el('p', { class: 'field-note', text: t('baseline_toolsRemoved', [names(diff.toolsRemoved)]) }));
  if (baseline.lastDiff) {
    box.append(el('p', { class: 'field-note', text: t('baseline_lastCheck', [when(baseline.lastDiff.at), String(baseline.lastDiff.added), String(baseline.lastDiff.resolved)]) }));
  }
  const update = el('button', { text: t('baseline_update'), title: t('baseline_updateHelp') });
  update.addEventListener('click', save);
  const forget = el('button', { text: t('baseline_forget'), title: t('baseline_forgetHelp') });
  forget.addEventListener('click', async () => {
    await send({ type: 'security-baseline-forget', origin });
    onChanged(null);
  });
  const exportButton = el('button', { text: t('baseline_export'), title: t('baseline_exportHelp') });
  exportButton.addEventListener('click', async () => {
    const out = await send({ type: 'security-baseline-export', origin });
    if (!out?.file) return;
    let host = 'site';
    try { host = new URL(origin).host.replace(/[^A-Za-z0-9.-]/g, '-'); } catch { /* keep the default */ }
    saveText(`webmcp-baseline-${host}`, `${JSON.stringify(out.file, null, 2)}\n`, 'json');
  });
  box.append(el('div', { class: 'row-inline' }, [update, forget, exportButton, importButton, picker]), importStatus);
  return diff;
}
