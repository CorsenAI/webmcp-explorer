import { emulationControl } from '../components/emulation.js';
import { el, row, t } from '../dom.js';
import { diagnosticEvidence } from '../components/diagnostic-evidence.js';
import { trialNote } from '../components/trial-note.js';

const REASON_KEY = {
  'insecure-context': 'reasonInsecureContext',
  'origin-not-isolated': 'reasonOriginNotIsolated',
  'api-call-rejected': 'reasonApiCallRejected',
  'tools-policy-blocked': 'reasonToolsPolicyBlocked',
  'api-absent': 'reasonApiAbsent',
  'api-partial': 'reasonApiPartial',
  'polyfill-active': 'reasonPolyfillActive',
};

// Never collapse the failure causes into one generic "WebMCP unavailable": the whole point
// is to say which of the requirements is not met (D-017).
export function renderEnvironment(root, result, { onDemo = null, tabId = null, emulationInStatus = false } = {}) {
  const { checks, reason, missing, refusal = null } = result.env;
  const table = el('table', { class: 'checks' });

  row(table, t('checkSecureContext'), checks.secureContext, t('env_secureContextHelp'));
  row(table, t('checkOriginIsolation'),
    `originAgentCluster: ${checks.originIsolation.originAgentCluster}`,
    t('env_originIsolationHelp'));
  row(table, t('checkApiAvailability'), checks.apiAvailability === 'refused' ? t('checkApiAvailabilityRefused') : checks.apiAvailability, t('env_apiAvailabilityHelp'));
  row(table, t('checkToolsPermission'), checks.toolsPermission, t('env_toolsPermissionHelp'));
  row(table, t('checkFrameContext'), checks.frameContext, t('env_frameContextHelp'));
  row(table, t('checkCapability'), checks.capability, t('env_capabilityHelp'));
  if (missing?.length) {
    row(table, t('env_missingMethods'), missing.join(', '), t('env_missingMethodsHelp'));
  }

  // The browser's own refusal, when it gave one, is quoted rather than paraphrased: on Chrome
  // 153 and 155 a document that is not origin-keyed raises a SecurityError naming
  // document.domain (WMP-0051), and that sentence is what a developer will search for.
  const quoted = refusal ? `${refusal.name}: ${refusal.message}` : '';
  const explanation = reason === 'api-call-rejected'
    ? t('reasonApiCallRejected', [quoted])
    : (reason ? t(REASON_KEY[reason]) : '');
  const nodes = [
    el('h2', { text: t('envUnavailableTitle') }),
    el('p', { class: 'muted', text: explanation }),
  ];
  if (refusal && reason !== 'api-call-rejected') {
    nodes.push(el('p', { class: 'field-desc', text: t('env_browserSaid', [quoted]) }));
  }
  // An expired or misplaced WebMCP origin-trial token is a common reason for an absent API.
  const trial = trialNote(result.env);
  if (trial) nodes.push(el('p', { class: 'field-note env-trial', text: trial }));

  // A screen that only explains why nothing works is a dead end, and this one is the first
  // thing a Store visitor without the flag would see (D-031, D-049).
  if (reason === 'api-absent' && onDemo) {
    const open = el('button', { class: 'primary', text: t('openDemo'), title: t('openDemoHelp') });
    open.addEventListener('click', () => { onDemo(); });
    nodes.push(
      el('p', { class: 'field-desc', text: t('openDemoHelp') }),
      el('div', { class: 'form-actions' }, [open]),
      el('p', { class: 'field-group', text: t('enableFlagTitle') }),
      el('p', { class: 'field-desc', text: t('enableFlagBody') }),
      el('pre', { class: 'result-body mono', text: 'chrome://flags/#enable-webmcp-testing' }),
      el('p', { class: 'field-desc', text: t('enableFlagWhy') }),
    );
  }

  if (reason === 'api-absent'&&!emulationInStatus) nodes.push(emulationControl(result.url,tabId));
  if (result.env.legacyTestingApi) nodes.push(el('p', { class: 'field-note', text: t('env_legacyTestingApi') }));
  nodes.push(table,diagnosticEvidence({state:reason,pageUrl:result.url??null,origin:result.topOrigin??null,frameId:0,checks,missingMethods:missing??[]}));
  root.replaceChildren(...nodes);
}
