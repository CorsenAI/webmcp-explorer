// Discovery conventions (S4): an opt-in box in the Security section. The button is the consent:
// it says exactly which requests will go to which origin before it is pressed (D-052), and the
// results are labelled conventions, not standards. Nothing is fetched on render, nothing stored.

import { el, t } from '../dom.js';
import { renderFinding } from './security.js';
import { withRule } from '../../core/security/rules.js';
import { quickFix } from '../../core/security/quick-fix.js';
import { webmcpTrialOf } from '../../core/origin-trial.js';
import { trialNote } from '../components/trial-note.js';

// The Origin-Trial header of the scanned response, in the same words as the page's meta tokens.
function headerTrialText(tokens) {
  if (!tokens.length) return t('discovery_otHeaderNone');
  const trial = webmcpTrialOf(tokens);
  if (!trial.present) return t('discovery_otHeaderOther', [String(tokens.length)]);
  return t('discovery_otHeader', [String(tokens.length), trialNote({ originTrial: trial }) ?? '']);
}

export function renderDiscovery(root, { result, onFindings = () => {} }) {
  const origin = result?.topOrigin ?? null;
  const box = el('details', { class: 'ck-bar sec-discovery' }, [
    el('summary', { text: t('discovery_title'), title: t('discovery_titleHelp') }),
    el('p', { class: 'field-desc', text: t('discovery_intro') }),
    el('p', { class: 'field-desc', text: t('discovery_otIntro') }),
  ]);
  root.append(box);
  if (!origin || !result?.url) return box;
  const disclosure = el('p', { class: 'field-desc nn-notice', text: t('discovery_disclosure', [origin]) });
  const button = el('button', { text: t('discovery_check'), title: t('discovery_checkHelp') });
  const status = el('p', { class: 'field-note', hidden: '' });
  const files = el('ul', { class: 'sec-not-observable field-desc', title: t('discovery_resultsHelp') });
  const findings = el('div', {});
  box.append(disclosure, el('div', { class: 'row-inline' }, [button]), status, files, findings);
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.hidden = true;
    const out = await chrome.runtime.sendMessage({ type: 'security-discovery-fetch', pageUrl: result.url }).catch((e) => ({ error: String(e?.message ?? e) }));
    button.disabled = false;
    if (out?.error) {
      status.hidden = false;
      status.textContent = out.code === 'origin-not-granted' ? t('discovery_notGranted') : out.error;
      return;
    }
    files.replaceChildren(...out.files.map((f) => el('li', {
      text: t('discovery_results', [new URL(f.url).pathname, f.status === null ? (f.error ?? 'error') : `${f.status}${f.headers?.['content-type'] ? ` · ${f.headers['content-type']}` : ''}${f.size ? ` · ${f.size} bytes` : ''}`]),
    })), el('li', { text: t('discovery_results', ['page headers', out.page.status === null ? (out.page.error ?? 'error') : String(out.page.status)]) }),
      ...(Array.isArray(out.page.originTrials) ? [el('li', { class: 'sec-ot-header', text: headerTrialText(out.page.originTrials) })] : []));
    out.findings = out.findings.map(f => {
      const enriched = withRule(f), fix = quickFix(enriched);
      return { ...enriched, remediation: fix, remediationCodeSnippet: fix.code };
    });
    findings.replaceChildren(...out.findings.map((f) => renderFinding(f)));
    onFindings(out.findings, out);
  });
  return box;
}
