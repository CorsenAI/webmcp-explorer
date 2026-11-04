// The only place an API key is read and put on the wire.
//
// It lives in the service worker so the key never exists in a context the inspected page can
// reach (D-004 rule 5). Nothing here is exported to the panel: the panel asks for a run, not
// for a request.

import { getProvider, providerBaseUrl, DIALECTS } from '../core/agent/providers.js';
import { buildRequest, parseResponse, readError } from '../core/agent/messages.js';
import { getKey } from '../storage/agent-config.js';
import { isConnectorId, getConnectorByConfigId } from '../storage/custom-connectors.js';
import { joinEndpoint } from '../core/agent/endpoint.js';

async function readPayload(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; }
  catch { return text; }
}

function requestError(provider, payload, status) {
  const message = readError(payload, status);
  // LM Studio's server ships with CORS off ("When not set, CORS is disabled", lmstudio.ai/docs/
  // cli/server-start). A refusal there gets the documented switch, stated as a check, not a cause.
  if (provider.id === 'lmstudio' && status === 403) {
    return `${message} If LM Studio refuses requests from Explorer, turn on CORS in its server `
      + 'settings (or start it with "lms server start --cors"), then try again.';
  }
  // Ollama rejects browser-extension origins by default. A 403 can also come from a
  // proxy, so offer the documented check without asserting a cause we cannot observe.
  if (provider.id !== 'ollama' || status !== 403) return message;
  const origin = chrome.runtime.getURL('').replace(/\/$/, '');
  return `${message} Check that OLLAMA_ORIGINS on the Ollama server allows ${origin}, `
    + 'then restart Ollama after changing it. See https://docs.ollama.com/faq for setup.';
}

async function authHeaders(provider) {
  const headers = { 'content-type': 'application/json', ...(provider.extraHeaders ?? {}) };
  if (provider.auth.kind === 'none') return headers;

  const key = await getKey(provider.id);
  if (!key && provider.keyRequired) throw Error('The API key is unavailable. Unlock the vault or add a session key.');
  if (!key) return headers;
  headers[provider.auth.header] = `${provider.auth.prefix}${key}`;
  return headers;
}

// Returns { ok, parsed } or { ok: false, error, status }. A transport failure is never
// thrown across the loop: the run records it and stops with a message the developer can act
// on, rather than an unhandled rejection in the service worker.
export async function callModel({ config, run, signal }) {
  const provider = getProvider(config.providerId)
    ?? (isConnectorId(config.providerId) ? await getConnectorByConfigId(config.providerId) : null);
  if (!provider) return { ok: false, error: config.providerId ? `Unknown provider: ${config.providerId}. Choose a provider in Model setup.` : 'Choose your AI in Model setup before sending a message.' };
  if (provider.dialect === DIALECTS.none) {
    return { ok: false, error: 'Manual mode does not call a model.' };
  }

  const { path, body } = buildRequest({
    dialect: provider.dialect,
    model: config.model,
    system: config.system ?? undefined,
    transcript: run.transcript,
    declarations: run.declarations,
  });

  const endpoint = joinEndpoint(providerBaseUrl(provider, config.baseUrl), path);
  if (!endpoint.ok) return { ok: false, error: endpoint.error };
  const url = endpoint.url;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: await authHeaders(provider),
      body: JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (cause?.name === 'AbortError') return { ok: false, aborted: true };
    // A local endpoint that is not running is the most common case by far, and the browser
    // reports it as an opaque "Failed to fetch".
    return {
      ok: false,
      error: provider.local
        ? `Could not reach ${url}. Is ${provider.label} running?`
        : `Could not reach ${url}: ${cause?.message ?? cause}`,
    };
  }

  const payload = await readPayload(response);

  if (!response.ok) {
    return { ok: false, status: response.status, error: requestError(provider, payload, response.status) };
  }
  if (payload === null || typeof payload !== 'object') {
    return { ok: false, error: 'The endpoint answered with something that is not JSON.' };
  }

  const parsed = parseResponse(provider.dialect, payload, config.model);
  if (!parsed.text && !parsed.calls.length) {
    return { ok: false, error: payload.error ? readError(payload, response.status)
      : `The provider returned no answer or tool call (${parsed.stop ?? 'empty response'}). Choose a chat model with tool support, or check its output limit.` };
  }
  return { ok: true, parsed, raw: payload };
}

// Lists the models an endpoint advertises, so the user picks from what exists instead of
// typing a name and finding out later. Failure is not fatal: the field stays free text.
export async function listModels(config) {
  const provider = getProvider(config.providerId)
    ?? (isConnectorId(config.providerId) ? await getConnectorByConfigId(config.providerId) : null);
  if (!provider?.modelsPath) return { ok: false, error: 'This provider has no model list.' };

  const endpoint = joinEndpoint(providerBaseUrl(provider, config.baseUrl), provider.modelsPath);
  if (!endpoint.ok) return { ok: false, error: endpoint.error };
  const url = endpoint.url;

  try {
    const response = await fetch(url, { headers: await authHeaders(provider), signal: AbortSignal.timeout(15000) });
    const payload = await readPayload(response);
    if (!response.ok) {
      return { ok: false, status: response.status, error: requestError(provider, payload, response.status) };
    }
    if (payload === null || typeof payload !== 'object') {
      return { ok: false, error: 'The endpoint answered with something that is not JSON.' };
    }
    return { ok: true, models: readModelList(payload) };
  } catch (cause) {
    return {
      ok: false,
      error: provider.local
        ? `Could not reach ${url}. Is ${provider.label} running?`
        : `Could not reach ${url}: ${cause?.message ?? cause}`,
    };
  }
}

// Three shapes in the wild: OpenAI's { data: [{id}] }, Anthropic's { data: [{id}] } and
// Gemini's { models: [{name: 'models/x'}] }.
function readModelList(payload) {
  const rows = payload?.data ?? payload?.models ?? [];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const id = row?.id ?? row?.name ?? null;
      return typeof id === 'string' ? id.replace(/^models\//, '') : null;
    })
    .filter(Boolean)
    .sort();
}
