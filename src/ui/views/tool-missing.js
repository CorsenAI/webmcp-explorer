// The registerTool() calls that did not end up in getTools(): what became of each, as far as
// Instrumentation Mode could see, with the file and line it came from. The answer a developer
// with a "missing" tool needs first, and one no inspector built on getTools() alone can give.
//
// Four states, never merged (core/registrations.js): rejected, removed, not exposed, not
// observed. A fact about the descriptor (an empty description) is shown beside the state, with
// the measurement it matches (Chrome 153 rejects such a registration, WMP-0039), not as a proven
// cause. The limits of the observation are printed under the list rather than left for the
// reader to discover.

import { el, badge, t } from '../dom.js';
import { REGISTRATION } from '../../core/registrations.js';
import { shortLocation } from '../../core/source.js';
import { diagnosticEvidence } from '../components/diagnostic-evidence.js';

const STATE_TEXT = {
  [REGISTRATION.rejected]: () => t('missingReg_stateRejected'),
  [REGISTRATION.removed]: () => t('missingReg_stateRemoved'),
  [REGISTRATION.notExposed]: () => t('missingReg_stateNotExposed'),
  [REGISTRATION.unknown]: () => t('missingReg_stateUnknown'),
};

const STATE_TONE = {
  [REGISTRATION.rejected]: 'danger',
  [REGISTRATION.removed]: 'accent',
  [REGISTRATION.notExposed]: 'warn',
  [REGISTRATION.unknown]: 'accent',
};

function detailText(row) {
  if (row.detail.kind === 'threw') return t('missingReg_detailThrew', [String(row.detail.message)]);
  if (row.detail.kind === 'promise-rejected') return t('missingReg_detailPromiseRejected', [String(row.detail.message)]);
  if (row.detail.kind === 'signal-aborted') return t('missingReg_detailRemoved');
  if (row.detail.kind === 'returned-not-listed') return t('missingReg_detailNotExposed');
  if (row.detail.kind === 'promise-unobserved') return t('missingReg_detailUnobserved');
  return t('missingReg_detailNoRecord');
}

// Renders the box when there is something to say; returns whether it did.
export function renderMissingRegistrations(root, registrations) {
  if (!registrations) return false;
  const { missing = [], seen = 0, instrumentedFrames = 0 } = registrations;
  if (!instrumentedFrames) return false;

  if (!missing.length) {
    if (seen > 0) root.append(el('p', { class: 'field-desc mr-all', text: t('missingReg_allExposed', [String(seen)]) }));
    return seen > 0;
  }

  const box = el('details', { class: 'mr-bar', open: '' });
  box.append(
    el('summary', { text: t('missingReg_title', [String(missing.length)]), title: t('help_missingRegistrations') }),
    el('p', { class: 'field-desc', text: t('missingReg_intro') }),
  );
  for (const row of missing) {
    const meta = el('div', { class: 'card-meta' }, [
      badge(STATE_TEXT[row.state]?.() ?? row.state, STATE_TONE[row.state] ?? 'accent'),
      row.emptyDescription ? badge(t('missingReg_badgeNoDescription'), 'warn', t('missingReg_emptyDescription')) : null,
      row.registrations > 1 ? badge(t('missingReg_registeredTimes', [String(row.registrations)]), 'accent') : null,
    ]);
    const lines = [el('p', { class: 'field-desc', text: detailText(row) })];
    if (row.emptyDescription) lines.push(el('p', { class: 'field-desc', text: t('missingReg_emptyDescription') }));
    // An abort that came before the registration settled is why the promise rejected; said so.
    if (row.state === REGISTRATION.rejected && row.signalAborted) {
      lines.push(el('p', { class: 'field-desc', text: t('missingReg_abortedBeforeSettled') }));
    }
    const where = row.source?.known
      ? el('p', { class: 'card-origin mono', text: `${row.source.file}:${row.source.line}:${row.source.column}` })
      : null;
    box.append(el('div', { class: 'card mr-row' }, [
      el('p', { class: 'card-name' }, [
        document.createTextNode(row.name),
        Number.isInteger(row.frameId) ? el('span', { class: 'card-origin', text: ` · ${t('missingReg_frame', [String(row.frameId)])}` }) : null,
      ]),
      meta,
      ...lines,
      where,
      row.source?.known ? el('p', { class: 'field-desc', text: t('toolSource_sourceDotLocation', [String(shortLocation(row.source))]) }) : null,
    ]));
  }
  box.append(el('p', { class: 'field-desc', text: t('missingReg_limits') }));
  box.append(diagnosticEvidence({state:'registrations-not-listed',registrations,limits:t('missingReg_limits')}));
  root.append(box);
  return true;
}
