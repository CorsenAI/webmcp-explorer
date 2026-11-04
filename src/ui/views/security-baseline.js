// The baseline box of the Security section (S3): save today's review as the reference for the
// site, read what changed since, update or forget it. Dates and counts; the detail is the
// findings list above, filtered by the "New since baseline" chip.

import { el, badge, t } from '../dom.js';
import { makeBaseline, diffBaseline } from '../../core/security/baseline.js';
import { severityLabel } from './security.js';

const when = (ms) => new Date(ms).toLocaleString();
const names = (list) => (list.length ? list.slice(0, 6).join(', ') + (list.length > 6 ? '…' : '') : '—');

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

  if (!baseline) {
    const button = el('button', { class: 'primary', text: t('baseline_save'), title: t('baseline_saveHelp') });
    button.addEventListener('click', save);
    box.append(el('p', { class: 'field-desc', text: t('baseline_none') }), el('div', { class: 'row-inline' }, [button]));
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
  if (diff.contractsChanged.length) box.append(el('p', { class: 'field-note', text: t('baseline_toolsChanged', [names(diff.contractsChanged.map((c) => c.name))]) }));
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
  box.append(el('div', { class: 'row-inline' }, [update, forget]));
  return diff;
}
