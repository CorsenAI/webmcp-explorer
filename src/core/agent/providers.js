// The provider catalogue. Data only — no fetch, no chrome.* API, no secrets.
//
// Provider-agnostic from the first commit (D-004 rule 5). The competing inspector is welded
// to one vendor, and the requests to open it up have sat unmerged for months; being able to
// point Explorer at whatever model a developer already pays for is a large part of why this
// product exists.
//
// A provider is a description, not code. Four request dialects cover all of them, so adding
// a vendor is a catalogue entry rather than a new code path.

import { endpointBlocker } from './endpoint.js';

export const DIALECTS = {
  openaiChat: 'openai-chat',
  openaiResponses: 'openai-responses',
  anthropicMessages: 'anthropic-messages',
  geminiGenerate: 'gemini-generate',
  none: 'none',
};

// Auth is described so that the key can be applied at the last possible moment, in the
// service worker, and never travels with anything the UI holds (D-004 rule 5).
const BEARER = { kind: 'bearer', header: 'authorization', prefix: 'Bearer ' };
export const ANTHROPIC_HEADERS = Object.freeze({
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
});
const NO_AUTH = { kind: 'none' };

export const PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    dialect: DIALECTS.openaiResponses,
    baseUrl: 'https://api.openai.com/v1',
    baseUrlEditable: false,
    auth: BEARER,
    keyRequired: true,
    keyHelp: 'Starts with sk-. Created at platform.openai.com.',
    modelsPath: '/models',
    // Read on developers.openai.com/api/docs/models, 2026-09-11.
    suggestedModels: ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-astra'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    dialect: DIALECTS.anthropicMessages,
    baseUrl: 'https://api.anthropic.com/v1',
    baseUrlEditable: false,
    auth: { kind: 'header', header: 'x-api-key', prefix: '' },
    // Anthropic refuses requests that carry a browser Origin — an extension service worker sends
    // one — unless they opt in: "CORS requests must set 'anthropic-dangerous-direct-browser-access'
    // header" (live refusal of 2.1.0, 2026-10-20). Explorer is bring-your-own-key: the key is the
    // user's and stays in this worker (D-004 rule 5), which is the use the header exists for.
    extraHeaders: ANTHROPIC_HEADERS,
    keyRequired: true,
    keyHelp: 'Starts with sk-ant-. Created at console.anthropic.com.',
    modelsPath: '/models',
    // Read on platform.claude.com/docs/en/models/overview, 2026-09-11.
    suggestedModels: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-fable-5-1'],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    dialect: DIALECTS.geminiGenerate,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    baseUrlEditable: false,
    auth: { kind: 'header', header: 'x-goog-api-key', prefix: '' },
    keyRequired: true,
    keyHelp: 'Created at aistudio.google.com.',
    modelsPath: '/models',
    // Read on ai.google.dev/gemini-api/docs/models, 2026-09-11: the 3-series previews are gone.
    suggestedModels: ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-2.5-pro'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    dialect: DIALECTS.openaiChat,
    baseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEditable: false,
    auth: BEARER,
    keyRequired: true,
    keyHelp: 'Starts with sk-or-. One key, many vendors.',
    modelsPath: '/models',
    suggestedModels: [],
  },
  {
    id: 'ollama',
    label: 'Ollama',
    dialect: DIALECTS.openaiChat,
    baseUrl: 'http://localhost:11434/v1',
    baseUrlEditable: true,
    auth: NO_AUTH,
    keyRequired: false,
    local: true,
    keyHelp: 'Runs on your machine. No key needed.',
    modelsPath: '/models',
    suggestedModels: [],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    dialect: DIALECTS.openaiChat,
    baseUrl: 'http://localhost:1234/v1',
    baseUrlEditable: true,
    auth: NO_AUTH,
    keyRequired: false,
    local: true,
    keyHelp: 'Runs on your machine. Start the local server in LM Studio first, with CORS on.',
    modelsPath: '/models',
    suggestedModels: [],
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible endpoint',
    dialect: DIALECTS.openaiChat,
    baseUrl: '',
    baseUrlEditable: true,
    auth: BEARER,
    keyRequired: false,
    keyHelp: 'Any server that speaks the OpenAI chat API — vLLM, llama.cpp, a gateway.',
    modelsPath: '/models',
    suggestedModels: [],
  },
  {
    id: 'manual',
    label: 'Copy and paste with another AI',
    dialect: DIALECTS.none,
    baseUrl: '',
    baseUrlEditable: false,
    auth: NO_AUTH,
    keyRequired: false,
    manual: true,
    keyHelp: 'Explorer builds the prompt and the tool list for you to paste into any chat, '
      + 'then you paste the reply back. Nothing leaves this machine.',
    modelsPath: null,
    suggestedModels: [],
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export function getProvider(id) {
  return BY_ID.get(id) ?? null;
}

// A fixed provider must not inherit a custom endpoint saved for another provider.
// UI disclosures, permission requests, model listing and transport all use this resolver.
export function providerBaseUrl(provider, configured = '') {
  return provider?.baseUrlEditable ? (configured || provider.baseUrl) : (provider?.baseUrl ?? '');
}

// Why an endpoint cannot be used, as stable codes. Plain http is fine on the user's own machine
// — Ollama and LM Studio live there — and refused anywhere else: the key and every prompt would
// travel in clear (D-051). These are blockers, not warnings; the transport refuses them too.
// `provider` may be a resolved catalogue entry — a custom connector lives in storage, not in
// PROVIDERS, and its caller has already loaded it.
export function endpointWarnings({ providerId, baseUrl, provider = null }) {
  provider = provider ?? getProvider(providerId);
  if (!provider) return providerId ? ['unknown-provider'] : [];
  if (provider.dialect === DIALECTS.none) return [];
  const url = providerBaseUrl(provider, baseUrl);
  if (!url) return ['no-endpoint'];
  const blocker = endpointBlocker(url);
  return blocker ? [blocker] : [];
}

// What the UI must collect before a run can start. Returned as reason codes so the panel can
// phrase them, and so a missing key is never confused with a missing model.
export function configProblems({ providerId, baseUrl, model, hasKey, provider = null }) {
  provider = provider ?? getProvider(providerId);
  if (!provider) return [providerId ? 'unknown-provider' : 'missing-provider'];
  if (provider.manual) return [];

  const problems = [];
  const endpoint = providerBaseUrl(provider, baseUrl);
  if (!endpoint) problems.push('missing-endpoint');
  // An endpoint that would carry the key in clear is a problem that stops the run, not a
  // remark beside it.
  else problems.push(...endpointWarnings({ providerId, baseUrl, provider }));
  if (!model) problems.push('missing-model');
  if (provider.keyRequired && !hasKey) problems.push('missing-key');
  return problems;
}
