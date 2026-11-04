// Custom connectors (F10/D-112): model endpoints the user describes themselves.
//
// A connector is a catalogue entry the user wrote: a label, one of the three request dialects,
// an endpoint, and whether it needs a key. It is NOT a new code path — the transport already
// speaks those three dialects, and every rule that applies to a built-in provider applies here:
// plain http is refused away from the user's own machine (D-051), the key lives only in
// chrome.storage.session and is applied by the service worker at the last moment (D-004 rule 5),
// and the endpoint permission is Chrome's own grant, asked on a user gesture (D-014).
//
// Only the description is stored — never a key, never a token.

import { endpointBlocker } from '../core/agent/endpoint.js';
import { ANTHROPIC_HEADERS, DIALECTS, getProvider } from '../core/agent/providers.js';
import { clearKey } from './agent-config.js';

const STORE_KEY = 'customProviders';
const ID_PREFIX = 'custom:';
const MAX_CONNECTORS = 20;
const MAX_LABEL = 60;

const CONNECTOR_DIALECTS = [
  DIALECTS.openaiChat,
  DIALECTS.anthropicMessages,
  DIALECTS.geminiGenerate,
];

export function isConnectorId(id) {
  return typeof id === 'string' && id.startsWith(ID_PREFIX);
}

export function connectorId(id) {
  return `${ID_PREFIX}${id}`;
}

function randomId() {
  return crypto.randomUUID();
}

async function readAll() {
  const stored = await chrome.storage.local.get(STORE_KEY);
  const list = stored?.[STORE_KEY];
  return Array.isArray(list) ? list.filter((c) => c && typeof c === 'object' && c.id) : [];
}

// A connector shaped like a catalogue entry, so getProvider-shaped code reads it unchanged.
// modelsPath is fixed: every dialect's vendor serves its list at `/models` relative to the
// base the user typed; if theirs does not, the list button reports it and the field is free
// text anyway.
function toProvider(connector) {
  return {
    id: connectorId(connector.id),
    label: connector.label,
    dialect: connector.dialect,
    baseUrl: connector.baseUrl,
    baseUrlEditable: false, // the value IS the connector; editing belongs to the connector form
    auth: connector.keyRequired
      ? (connector.dialect === DIALECTS.anthropicMessages
        ? { kind: 'header', header: 'x-api-key', prefix: '' }
        : { kind: 'bearer', header: 'authorization', prefix: 'Bearer ' })
      : { kind: 'none' },
    extraHeaders: connector.dialect === DIALECTS.anthropicMessages ? ANTHROPIC_HEADERS : undefined,
    keyRequired: Boolean(connector.keyRequired),
    keyHelp: 'Saved on this connector. Held in memory only, never written to disk.',
    modelsPath: '/models',
    suggestedModels: [],
    custom: true,
    local: false,
  };
}

// Validation is deliberately narrow: what a connector may say. The endpoint rules themselves
// (scheme, plain http) are decided by endpointBlocker, the same gate the transport uses.
export function validateConnector({ label, dialect, baseUrl, keyRequired }) {
  const errors = [];
  const cleanLabel = String(label ?? '').trim();
  if (!cleanLabel) errors.push('A connector needs a name.');
  else if (cleanLabel.length > MAX_LABEL) errors.push(`The name is too long (${MAX_LABEL} characters at most).`);
  if (!CONNECTOR_DIALECTS.includes(dialect)) {
    errors.push('Pick one of the supported request dialects.');
  }
  let url;
  try {
    url = new URL(String(baseUrl ?? '').trim());
  } catch {
    url = null;
  }
  // The raw trimmed string, not url.toString(): a base is allowed to carry a query (Azure
  // requires ?api-version=) and joinEndpoint must find it untouched.
  const raw = String(baseUrl ?? '').trim();
  if (!url) errors.push('The endpoint is not a valid URL.');
  else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    errors.push('Only http and https endpoints are supported.');
  } else {
    const blocker = endpointBlocker(raw);
    if (blocker === 'insecure-remote-endpoint') {
      errors.push('Plain http is only allowed for a server on this machine — a key or prompt sent over http to another host travels in clear.');
    }
  }
  return { ok: errors.length === 0, errors, label: cleanLabel, baseUrl: url ? raw : '' };
}

export async function listConnectors() {
  return (await readAll()).map(toProvider);
}

// The single resolver the service worker uses where code used to call getProvider: a custom
// connector id resolves from storage, anything else from the static catalogue.
export async function resolveProvider(id) {
  if (isConnectorId(id)) return await getConnectorByConfigId(id);
  return getProvider(id);
}

// Every id — used by the config save to reject a connector that was deleted underneath it.
export async function listConnectorIds() {
  return new Set((await readAll()).map((c) => connectorId(c.id)));
}

export async function getConnectorByConfigId(id) {
  if (!isConnectorId(id)) return null;
  const raw = (await readAll()).find((c) => connectorId(c.id) === id);
  return raw ? toProvider(raw) : null;
}

export async function addConnector({ label, dialect, baseUrl, keyRequired }) {
  const all = await readAll();
  if (all.length >= MAX_CONNECTORS) {
    return { error: `A maximum of ${MAX_CONNECTORS} custom connectors is kept. Delete one first.` };
  }
  const check = validateConnector({ label, dialect, baseUrl, keyRequired });
  if (!check.ok) return { errors: check.errors };
  if (all.some((c) => c.label.toLowerCase() === check.label.toLowerCase())) {
    return { errors: ['A connector with that name already exists.'] };
  }
  const connector = {
    id: randomId(),
    label: check.label,
    dialect,
    baseUrl: check.baseUrl,
    keyRequired: Boolean(keyRequired),
    createdAt: Date.now(),
  };
  await chrome.storage.local.set({ [STORE_KEY]: [...all, connector] });
  return { connector: toProvider(connector) };
}

// The user edits a connector they can see: replace its editable fields, keep its id (and
// therefore its key slot, which is memory-only and keyed by id).
export async function updateConnector(id, patch) {
  const all = await readAll();
  const index = all.findIndex((c) => c.id === id);
  if (index === -1) return { error: 'No such connector.' };
  const merged = { ...all[index], ...patch };
  const check = validateConnector(merged);
  if (!check.ok) return { errors: check.errors };
  all[index] = {
    ...merged,
    label: check.label,
    baseUrl: check.baseUrl,
    keyRequired: Boolean(merged.keyRequired),
  };
  await chrome.storage.local.set({ [STORE_KEY]: all });
  return { connector: toProvider(all[index]) };
}

export async function deleteConnector(id, passphrase) {
  const all = await readAll();
  const rest = all.filter((c) => c.id !== id);
  // The key itself lives in session storage keyed by the connector id; a closed Chrome drops
  // it, but a deleted connector must not leave it reachable until then. clearKey is the one
  // place that touches that map (D-004 rule 5).
  await clearKey(connectorId(id),passphrase);
  await chrome.storage.local.set({ [STORE_KEY]: rest });
  return { deleted: true };
}

export async function clearAllConnectors() {
  await chrome.storage.local.remove(STORE_KEY);
  return { cleared: true };
}

// Settings-import path: the bundle came from this product on some machine, so every entry is
// re-validated rather than trusted — an endpoint that would carry a key in clear (D-051) is
// dropped here exactly as it would be at creation time. Ids survive so the imported
// configuration keeps pointing at the connectors it names.
export async function replaceConnectors(list) {
  if (!Array.isArray(list)) return { error: 'The connectors section must be a list.' };
  const clean = [];
  for (const item of list.slice(0, MAX_CONNECTORS)) {
    if (!item || typeof item !== 'object') continue;
    const check = validateConnector(item);
    if (!check.ok) continue;
    clean.push({
      id: typeof item.id === 'string' && item.id ? item.id : randomId(),
      label: check.label,
      dialect: item.dialect,
      baseUrl: check.baseUrl,
      keyRequired: Boolean(item.keyRequired),
      createdAt: Number(item.createdAt) || Date.now(),
    });
  }
  await chrome.storage.local.set({ [STORE_KEY]: clean });
  return { count: clean.length };
}
