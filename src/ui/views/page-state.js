import { el, t } from '../dom.js';
import { requestAllSites } from '../../shared/permissions.js';
import { openDemo } from '../../shared/demo.js';
import { toolbarHintFigure } from './toolbar-hint.js';
import { diagnosticEvidence } from '../components/diagnostic-evidence.js';

// Empty, inaccessible and failed-page states share the same existing panel navigation.
export function pageStateViews(viewEl, factsEl, onRefresh) {
function showMessage(title, body, kind = 'muted', extra = null) {
  factsEl.replaceChildren();
  viewEl.replaceChildren(
    el('h2', { text: title }),
    el('p', { class: kind, text: body }),
    ...(extra ? [extra] : []),
  );
}

function showDiscoveryFailure(message, pageUrl = null) {
  const retry=el('button',{text:t('discoveryRetry'),title:t('discoveryRetryHelp')});
  retry.addEventListener('click',onRefresh);
  factsEl.replaceChildren();
  viewEl.replaceChildren(el('h2',{text:t('discoveryFailed')}),
    el('p',{class:'field-desc',text:t('discoveryNextAction')}),
    el('pre',{class:'result-body mono discovery-error',text:message}),
    el('div',{class:'row-inline'},[retry]),
    diagnosticEvidence({state:'discovery-failed',pageUrl,frameId:null,error:message}));
}

// Offered wherever there is nothing to inspect. Someone who installed Explorer on a browser
// without WebMCP has otherwise no way to find out what it does.
function demoOffer() {
  const button = el('button', {
    text: t('openDemo'),
    title: t('openDemoHelp'),
  });
  button.addEventListener('click', () => { openDemo(); });
  return el('div', {}, [
    el('p', { class: 'field-desc', text: t('openDemoHelp') }),
    el('div', { class: 'form-actions' }, [button]),
  ]);
}

// Without activeTab, Chrome hides the tab URL, so Explorer cannot even name the origin it
// would ask for. Telling the user to click elsewhere is not enough: this screen must carry
// a way out of its own, or it is a dead end (found in manual testing).
function showNeedsAction() {
  factsEl.replaceChildren();

  const grant = el('button', {
    class: 'primary',
    text: t('needActionAlt'),
    title: t('needActionAltHelp'),
  });
  grant.addEventListener('click', async () => {
    grant.disabled = true;
    try {
      if (await requestAllSites()) onRefresh();
    } finally {
      grant.disabled = false;
    }
  });

  viewEl.replaceChildren(
    el('h2', { text: t('needActionTitle') }),
    el('p', { class: 'muted', text: t('needActionBody') }),
    toolbarHintFigure(),
    el('p', { class: 'field-desc', text: t('needActionPin') }),
    el('div', { class: 'form-actions' }, [grant]),
    el('p', { class: 'field-desc', text: t('needActionAltHelp') }),
    diagnosticEvidence({state:'page-address-unavailable',pageUrl:null,frameId:null,observation:t('needActionBody')}),
  );
}

  return { showMessage, demoOffer, showNeedsAction, showDiscoveryFailure };
}
