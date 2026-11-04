import { requestOrigin } from '../../shared/permissions.js';
import { el, t } from '../dom.js';
import { diagnosticEvidence } from '../components/diagnostic-evidence.js';

export function renderGrant(root, { url, onGranted }) {
  const error = el('p', { class: 'badge badge-danger grant-error', hidden: '' });

  const button = el('button', {
    text: t('grantAction'),
    title: t('grantBody'),
  });

  button.addEventListener('click', async () => {
    error.hidden = true;
    button.disabled = true;
    try {
      if (await requestOrigin(url)) return onGranted();
      error.textContent = t('grantDenied');
      error.hidden = false;
    } catch (cause) {
      error.textContent = String(cause?.message ?? cause);
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  root.replaceChildren(
    el('h2', { text: t('grantTitle') }),
    el('p', { class: 'muted', text: t('grantBody') }),
    button,
    error,
    diagnosticEvidence({state:'site-access-required',pageUrl:url,granted:false,frameId:null}),
  );
}
