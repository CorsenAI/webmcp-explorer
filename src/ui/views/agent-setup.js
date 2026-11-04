// Provider, endpoint, model and key. Everything a run needs before it can start.
//
// The key field is write-only by design: Explorer can tell you a key is stored and where,
// never what it is (D-004 rule 5). Optional encrypted persistence has explicit lock controls.

import { renderKeyVault } from '../components/key-vault.js';
import { el, badge, t } from '../dom.js';
import { providerBaseUrl } from '../../core/agent/providers.js';
import { hasOrigin, requestOrigin } from '../../shared/permissions.js';
import { renderConnectorEditor } from './custom-connectors.js';
import { renderPromptProfiles } from './prompt-profiles.js';

// Blockers, not remarks: each of these stops the run until it is fixed (D-051).
function warningText(code) {
  const map = {
    'insecure-remote-endpoint': t('agentSetup_thisEndpointIsPlainHttp'),
    'unsupported-scheme': t('agentSetup_onlyHttpAndHttpsEndpoints'),
    'invalid-endpoint': t('agentSetup_thatIsNotAValid'),
    'no-endpoint': t('agentSetup_thisProviderNeedsAnEndpoint'),
  };
  return map[code] ?? code;
}

export function renderAgentSetup(root, { config, providers, key, promptProfiles = [], warnings, onChange, onRunnable }) {
  const provider = providers.find((p) => p.id === config.providerId) ?? null;
  const endpoint = providerBaseUrl(provider, config.baseUrl);

  const select = el('select', { id: 'ag-provider', title: t('agentSetup_whichModelServiceToTalk') });
  select.append(el('option', { value: '', text: t('agentSetup_chooseProvider') }));
  for (const item of providers) {
    const option = el('option', {
      value: item.id,
      // A user connector is marked as such in the list: it is a description the user wrote,
      // and the label must say so wherever it appears (F10).
      text: item.custom ? `${item.label} (${t('connector_mark')})` : item.label,
    });
    if (item.id === provider?.id) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => onChange({ providerId: select.value, model: '' }));

  const rows = [
    el('p', { class: 'field-desc', text: t(provider ? 'agentSetup_usageHelp' : 'agentSetup_chooseHelp') }),
    field(t('agentSetup_provider'), select, provider?.keyHelp),
  ];


  if (provider?.baseUrlEditable) {
    const url = el('input', {
      type: 'url', id: 'ag-url', class: 'mono',
      placeholder: provider.baseUrl || 'https://host/v1',
    });
    url.value = config.baseUrl ?? '';
    url.addEventListener('change', () => onChange({ baseUrl: url.value.trim() }));
    rows.push(field(t('agentSetup_endpoint'), url, t('agentSetup_endpointHelp')));
  }

  if (provider && !provider.manual) {
    if (provider.keyRequired || !provider.local) {
      rows.push(keyRow(provider, key, onChange));
    }
    rows.push(reachRow(endpoint, onRunnable));
    rows.push(modelRow(config, provider, key, onChange));
  }

  if (provider) rows.push(renderPromptProfiles({
      profiles: promptProfiles,
      activeId: config.promptProfileId ?? null,
      onChange: (patch) => onChange(patch),
    }));

  const notes = warnings.map((code) => el('p', {
    class: 'field-note error', text: warningText(code),
  }));

  // Custom connectors live on this screen: the provider select above is their only consumer,
  // and adding one is a configuration act, not a separate destination (F10).
  const connectorBody = el('div');
  const connectorHost = el('details', { class: 'field cc-host' }, [
    el('summary', { text: t('connector_section'), title: t('connector_help') }),
    connectorBody,
  ]);
  renderConnectorEditor(connectorBody, {
    connectors: providers.filter((p) => p.custom),
    onChange: () => onChange({}),
  });
  rows.push(connectorHost);

  root.replaceChildren(...rows, ...notes, ...(provider ? [budgets(config, onChange)] : []));
}

function modelRow(config, provider, key, onChange) {
  const input = el('input', {
    type: 'text', id: 'ag-model', class: 'mono', list: 'ag-models',
    placeholder: provider.suggestedModels[0] ?? t('agentSetup_modelName'),
  });
  input.value = config.model ?? '';
  input.addEventListener('change', () => onChange({ model: input.value.trim() }));

  const datalist = el('datalist', { id: 'ag-models' });
  for (const name of provider.suggestedModels) datalist.append(el('option', { value: name }));

  const status = el('p', { class: 'field-note', role: 'status', 'aria-live': 'polite' });
  const fetchButton = el('button', {
    text: t('agentSetup_listModels'),
    title: t('agentSetup_askTheEndpointWhichModels'),
  });
  fetchButton.disabled = !provider.canListModels;
  fetchButton.addEventListener('click', async () => {
    fetchButton.disabled = true;
    status.textContent = t('agentSetup_askingTheEndpoint');
    if (provider.keyRequired && !key.hasKey) {
      status.textContent = t('agentSetup_addKeyFirst');
      fetchButton.disabled = false;
      return;
    }
    if (!await hasOrigin(providerBaseUrl(provider, config.baseUrl))) {
      status.textContent = t('agentSetup_allowFirst');
      fetchButton.disabled = false;
      return;
    }
    const out = await chrome.runtime.sendMessage({ type: 'agent-models' })
      .catch(error => ({ ok: false, error: error.message }));
    fetchButton.disabled = false;
    if (out?.ok) {
      datalist.replaceChildren(...out.models.map((name) => el('option', { value: name })));
      status.textContent = out.models.length
        ? t('agentSetup_modelsFound', [String(out.models.length)])
        : t('agentSetup_noModelsFound');
    } else {
      status.textContent = out?.error ?? t('agentSetup_couldNotListModels');
    }
  });

  return el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: 'ag-model', text: t('agentSetup_model') }),
    input,
    el('div', { class: 'row-inline' }, [fetchButton]),
    datalist,
    el('p', { class: 'field-desc', text: t('agentSetup_modelHelp') }),
    status,
  ]);
}

function keyRow(provider, key, onChange) { return renderKeyVault(provider,key,onChange); }

function reachRow(endpoint, onRunnable) {
  const wrap = el('div', { class: 'field' });
  const status = el('p', { class: 'field-desc', text: t('agentSetup_checkingAccessToTheEndpoint') });
  wrap.append(status);

  (async () => {
    if (!endpoint) {
      status.textContent = t('agentSetup_setAnEndpointFirst');
      onRunnable(false);
      return;
    }
    if (await hasOrigin(endpoint)) {
      status.replaceChildren(
        badge(t('agentSetup_endpointAllowed'), 'ok', t('agentSetup_explorerMaySendRequestsTo')));
      onRunnable(true);
      return;
    }
    onRunnable(false);
    const host = safeHost(endpoint);
    status.textContent = `Explorer needs your permission to send requests to ${host}.`;
    const grant = el('button', {
      class: 'primary',
      text: t('agentSetup_allowRequestsTo1', [String(host)]),
      title: t('agentSetup_onlyThisAddressExplorerAsks'),
    });
    grant.addEventListener('click', async () => {
      if (await requestOrigin(endpoint)) {
        status.replaceChildren(badge(t('agentSetup_endpointAllowed'), 'ok'));
        grant.remove();
        onRunnable(true);
      }
    });
    wrap.append(grant);
  })();

  return wrap;
}

function budgets(config, onChange) {
  const steps = el('input', {
    type: 'number', id: 'ag-steps', min: '1', max: '50',
    title: t('agentSetup_howManyTimesTheModel'),
  });
  steps.value = String(config.maxSteps ?? 8);
  steps.addEventListener('change',
    () => onChange({ maxSteps: Math.max(1, Number(steps.value) || 8) }));

  const calls = el('input', {
    type: 'number', id: 'ag-calls', min: '1', max: '200',
    title: t('agentSetup_howManyToolExecutionsA'),
  });
  calls.value = String(config.maxToolCalls ?? 24);
  calls.addEventListener('change',
    () => onChange({ maxToolCalls: Math.max(1, Number(calls.value) || 24) }));

  const box = el('details', { class: 'tree-raw' });
  box.append(
    el('summary', { text: t('agentSetup_budgets'), title: t('help_budgets') }),
    el('div', { class: 'row-inline' }, [
      el('label', { class: 'field-label', for: 'ag-steps', text: t('agentSetup_modelTurns') }), steps,
      el('label', { class: 'field-label', for: 'ag-calls', text: t('agentSetup_toolCalls') }), calls,
    ]),
    el('p', {
      class: 'field-desc',
      text: t('agentSetup_aRunThatHitsA'),
    }),
  );
  return box;
}

function field(label, control, help) {
  return el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: control.id, text: label }),
    control,
    help ? el('p', { class: 'field-desc', text: help }) : null,
  ]);
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
