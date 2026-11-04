// The Security section: a review of the page's declared tools as findings with evidence and
// sources (D-127), plus the explicit provisional score approved in D-136. The section
// runs nothing and sends nothing: it reads the discovery the panel already has and the live
// timeline of the tab.

import { el, badge, t } from '../dom.js';
import { exportBar } from '../components/export-bar.js';
import { helpIntro } from '../components/help.js';
import { reviewSecurity } from '../../core/security/review.js';
import { SEVERITY, AXIS, localeKey } from '../../core/security/catalog.js';
import { securityReport } from '../../core/export/security-report.js';
import { listReviewed, setReviewed, reviewedKey } from '../../storage/security.js';
import { renderProbes } from './security-probes.js';
import { renderBaseline } from './security-baseline.js';
import { renderDiscovery } from './security-discovery.js';
import { findingKey } from '../../core/security/baseline.js';
import { renderSecurityScore } from '../components/security-score.js';

export const SEVERITY_KIND = { critical: 'critical', high: 'danger', medium: 'warn', low: 'accent', info: 'muted' };
export const severityLabel = (s) => t(`security_sev_${s}`);
export const findingText = (code, part) => {
  const text = t(localeKey(code, part));
  return text === localeKey(code, part) ? null : text;
};

export function severityBadge(severity, title = t('security_sevHelp')) {
  return badge(severityLabel(severity), SEVERITY_KIND[severity] ?? 'muted', title);
}

const NOT_OBSERVABLE_KEY = {
  'registration-provenance': 'security_no_registration_provenance',
  'ungranted-origins': 'security_no_ungranted_origins',
  'refused-frames': 'security_no_refused_frames',
  lifecycle: 'security_no_lifecycle',
  'authentication-consent': 'security_no_authenticationConsent',
  'schema-limits': 'security_no_schemaLimits',
  'similarity-limit': 'security_no_similarityLimit',
  'origin-scan-not-run': 'security_no_originScan',
  'origin-scan-incomplete': 'security_no_originScanIncomplete',
};

export function renderFinding(f, { onOpenTool = null, reviewed = false, onReviewed = null, isNew = false } = {}) {
  const title = findingText(f.code, 'title') ?? f.code;
  const where = f.toolName
    ? `${f.toolName}${f.frameId !== null && f.frameId !== undefined ? ` · ${t('security_frame', [String(f.frameId)])}` : ''}`
    : t('security_pageFinding');
  const summary = el('summary', { title: t('security_itemHelp') }, [
    severityBadge(f.severity),
    f.ruleId ? badge(f.ruleId, 'muted') : null,
    badge(f.nature === 'observed' ? t('security_natureObserved') : t('security_natureIndicator'), 'muted', t('security_natureHelp')),
    reviewed ? badge(t('security_reviewedBadge'), 'ok') : null,
    isNew ? badge(t('baseline_newChip'), 'warn', t('baseline_newChipHelp')) : null,
    el('span', { class: 'sec-title', text: title }),
    el('span', { class: 'sec-tool', text: where }),
  ].filter(Boolean));

  const body = el('div', { class: 'sec-body' });
  if (f.evidence?.path) body.append(el('p', { class: 'sec-path', text: String(f.evidence.path) }));
  if (f.evidence?.excerpt) {
    body.append(el('p', { class: 'sec-label', text: t('security_evidence') }),
      // Page-authored text: textContent only, never markup (D-019).
      el('pre', { class: 'sec-evidence', text: String(f.evidence.excerpt) }));
  }
  const why = findingText(f.code, 'why');
  if (why) body.append(el('p', { class: 'sec-label', text: t('security_why') }), el('p', { class: 'field-desc', text: why }));
  const fix = findingText(f.code, 'fix');
  if (fix) body.append(el('p', { class: 'sec-label', text: t('security_fix') }), el('p', { class: 'field-desc', text: fix }));
  if (f.remediationCodeSnippet) {
    const status = el('span', { class: 'field-note', role: 'status', 'aria-live': 'polite' });
    const copy = el('button', { text: t('security_copyFix'), title: t('security_copyFixHelp') });
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(f.remediationCodeSnippet); status.textContent = t('security_fixCopied'); }
      catch { status.textContent = t('security_fixCopyError'); }
    });
    body.append(el('details', { class: 'sec-quick-fix' }, [
      el('summary', { text: t('security_showFix'), title: t('security_fixReview') }),
      el('p', { class: 'field-desc', text: t('security_fixReview') }),
      el('pre', { class: 'sec-evidence sec-fix-code', dir: 'ltr', text: f.remediationCodeSnippet }),
      el('div', { class: 'row-inline' }, [copy, status]),
    ]));
  }
  if (f.refs?.length) {
    body.append(el('p', { class: 'sec-label', text: t('security_sources') }),
      el('ul', { class: 'sec-sources' }, f.refs.map((r) => el('li', {}, [el('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', text: r.label })]))));
  }
  const actions = [];
  if (onOpenTool && f.instanceId) {
    const open = el('button', { text: t('security_openTool'), title: t('security_openToolHelp') });
    open.addEventListener('click', () => onOpenTool(f));
    actions.push(open);
  }
  if (onReviewed) {
    const mark = el('button', {
      text: reviewed ? t('security_unmarkReviewed') : t('security_markReviewed'),
      title: reviewed ? t('security_unmarkReviewedHelp') : t('security_markReviewedHelp'),
    });
    mark.addEventListener('click', () => onReviewed(f, !reviewed));
    actions.push(mark);
  }
  if (actions.length) body.append(el('div', { class: 'row-inline' }, actions));

  return el('details', { class: `card sec-item${reviewed ? ' sec-reviewed' : ''}`, 'data-code': f.code, 'data-severity': f.severity, 'data-new': isNew ? 'true' : null }, [summary, body]);
}

export async function renderSecurity(root, { result, tabId = null, events = [], onOpenTool = null }) {
  const origin = result?.topOrigin ?? null;
  const review = reviewSecurity({ discovery: result, events });
  let probeFindings = [], originScan = null, combined = review;
  let reviewed = origin ? await listReviewed(origin) : new Set();
  const stored = origin ? await chrome.runtime.sendMessage({ type: 'security-baseline-get', origin }).catch(() => null) : null;
  let baseline = stored?.baseline ?? null;
  const baselineKeys = () => new Set((baseline?.findings ?? []).map((f) => f.key));
  const state = { severities: [], axes: [], hideReviewed: false, onlyNew: false };

  root.replaceChildren(helpIntro(), el('p', { class: 'field-desc', text: t('security_intro') }));
  const scoreHost = el('div', {});
  const coverageHost = el('div', {});
  root.append(scoreHost);
  const updateCombined = () => {
    combined = reviewSecurity({ discovery: result, events, originScan, extraFindings: probeFindings });
    renderSecurityScore(scoreHost, combined);
    coverageHost.replaceChildren();
    appendNotObservable(coverageHost, combined);
  };
  const exports = () => exportBar({
    label: t('security_exportLabel'), kinds: ['markdown','json','sarif'],
    build: () => securityReport({ ...combined,
      findings: combined.findings.map(f => ({ ...f, reviewed: reviewed.has(reviewedKey(f)) })),
    }, result, { texts: findingText }),
    note: t('security_exportNote'),
  });
  updateCombined();
  if (!result?.tools?.length) {
    root.append(el('p', { class: 'muted', text: t('security_noTools') }));
    root.append(coverageHost);
    appendFindings(root, review.findings.filter((f) => !f.toolName));
    // The Permissions-Policy check matters most on a page that uses no tools (spec §6.4.1).
    renderDiscovery(root, { result, onFindings: (_found, scan) => { originScan = scan; updateCombined(); } });
    root.append(exports());
    return review;
  }

  const c = review.coverage;
  root.append(el('p', { class: 'muted count sec-summary', title: t('security_coverageHelp'),
    text: t('security_coverage', [String(c.tools), String(c.rules), String(c.findings), String(c.observed), String(c.indicators)]) }));

  const chips = el('div', { class: 'chips' });
  const list = el('div', {});
  const syncs = [];
  const chip = (label, title, active, onToggle) => {
    const button = el('button', { class: 'chip', text: label, title });
    const sync = () => { button.classList.toggle('chip-active', active()); button.setAttribute('aria-pressed', String(active())); };
    syncs.push(sync);
    button.addEventListener('click', () => { onToggle(); for (const s of syncs) s(); paint(); });
    return button;
  };
  for (const s of SEVERITY) {
    const n = review.bySeverity[s];
    if (!n) continue;
    chips.append(chip(`${severityLabel(s)} ${n}`, t('security_filterSeverity'), () => state.severities.includes(s), () => {
      state.severities = state.severities.includes(s) ? state.severities.filter((x) => x !== s) : [...state.severities, s];
    }));
  }
  const axes = [...new Set(review.findings.map((f) => f.axis))].sort();
  if (axes.length > 1) {
    for (const a of axes) {
      chips.append(chip(t(`security_axis_${a}`), t('security_filterAxis'), () => state.axes.includes(a), () => {
        state.axes = state.axes.includes(a) ? state.axes.filter((x) => x !== a) : [...state.axes, a];
      }));
    }
  }
  // Built once and shown only when there is something to hide (D-027: synced, never rebuilt).
  const hideChip = chip(t('security_hideReviewed'), t('security_hideReviewedHelp'), () => state.hideReviewed, () => { state.hideReviewed = !state.hideReviewed; });
  const newChip = chip(t('baseline_newChip'), t('baseline_newChipHelp'), () => state.onlyNew, () => { state.onlyNew = !state.onlyNew; });
  chips.append(hideChip, newChip);
  root.append(chips, list);
  // The baseline box (S3): saving or forgetting one re-renders the box and the list in place.
  const baselineHost = el('div', {});
  root.append(baselineHost);
  const paintBaseline = () => {
    baselineHost.replaceChildren();
    renderBaseline(baselineHost, { result, review, baseline, onChanged: (next) => { baseline = next; paintBaseline(); paint(); } });
  };
  paintBaseline();
  root.append(coverageHost);
  // Active probes (S2) live under the passive findings; their findings join the export.
  renderProbes(root, { result, tabId, onFindings: (found) => { probeFindings = found; updateCombined(); } });
  renderDiscovery(root, { result, onFindings: (_found, scan) => { originScan = scan; updateCombined(); } });
  root.append(exports());
  for (const s of syncs) s();
  paint();
  return review;

  function paint() {
    hideChip.hidden = reviewed.size === 0;
    if (hideChip.hidden) state.hideReviewed = false;
    const keys = baselineKeys();
    newChip.hidden = !baseline;
    if (newChip.hidden) state.onlyNew = false;
    for (const s of syncs) s();
    const shown = review.findings.filter((f) => (!state.severities.length || state.severities.includes(f.severity))
      && (!state.axes.length || state.axes.includes(f.axis))
      && !(state.hideReviewed && reviewed.has(reviewedKey(f)))
      && !(state.onlyNew && keys.has(findingKey(f))));
    if (!review.findings.length) {
      list.replaceChildren(el('p', { class: 'muted', text: t('security_clean') }));
      return;
    }
    if (!shown.length) {
      list.replaceChildren(el('p', { class: 'muted', text: t('security_noMatch') }));
      return;
    }
    list.replaceChildren(...shown.map((f) => renderFinding(f, {
      onOpenTool,
      isNew: Boolean(baseline) && !keys.has(findingKey(f)),
      reviewed: reviewed.has(reviewedKey(f)),
      onReviewed: origin ? async (finding, on) => {
        await setReviewed(origin, reviewedKey(finding), on);
        reviewed = await listReviewed(origin);
        paint();
      } : null,
    })));
  }

  function appendFindings(host, findings) {
    for (const f of findings) host.append(renderFinding(f, { onOpenTool: null, onReviewed: null }));
  }
}

function appendNotObservable(root, review) {
  const items = review.coverage.notObservable;
  if (!items.length) return;
  root.append(el('p', { class: 'field-group', text: t('security_notObservable') }),
    el('ul', { class: 'sec-not-observable field-desc' }, items.map((n) => el('li', {
      text: t(NOT_OBSERVABLE_KEY[n.code] ?? n.code, n.detail ? [[].concat(n.detail).join(', ')] : undefined),
    }))));
}
