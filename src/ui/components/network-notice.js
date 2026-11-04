// What a run will send, and to whom, said in full immediately before the button that sends it.
//
// A tooltip is not a disclosure: it is visible only to someone who already wondered. This is
// rendered inline, every time, between the controls and the Run button, so the click that
// follows it is the explicit act the Store's data-use rules ask for (D-052).
//
// It is built from the live configuration, never from a template that could drift: the host
// named here is the host the request will actually go to.

import { el, t } from '../dom.js';
import { providerBaseUrl } from '../../core/agent/providers.js';

function hostOf(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl || t('networkNotice_theConfiguredEndpoint');
  }
}

// `providers` is the catalogue the panel already holds; `config` the saved configuration.
export function networkNotice({ config, providers, subject = t('networkNotice_running'), compact = false }) {
  const provider = providers.find((p) => p.id === config?.providerId) ?? null;

  if (!provider) {
    return el('p', { class: 'field-desc nn-notice', text: t('networkNotice_chooseProvider') });
  }

  if (provider.manual) {
    return el('p', {
      class: 'field-desc nn-notice',
      text: t('networkNotice_manualModeSendsNothingAnywhere'),
    });
  }

  const host = hostOf(providerBaseUrl(provider, config.baseUrl));
  const where = provider.local
    ? t('networkNotice_localWhere', [String(provider.label), String(host)])
    : t('networkNotice_remoteWhere', [String(provider.label), String(host)]);

  return el('p', {
    class: 'field-desc nn-notice',
    text: compact ? t('networkNotice_chatDisclosure', [String(host)])
      : t('networkNotice_disclosure', [String(subject), String(where)]),
  });
}
