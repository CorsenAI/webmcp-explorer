// Agent Lab settings and API keys.
//
// The hard rule (D-004 rule 5): a key must never be reachable from the inspected page — not
// through the DOM, not in the MAIN world, not in a content script. It is therefore read only
// here, in the service worker, and applied to a request at the last moment. `getKey` is not
// exported to the panel through any message: the panel can ask whether a key exists, never
// what it is.
//
// Session memory remains the default. Optional persistence is authenticated ciphertext;
// all vault operations and decrypted cache access remain worker-only.

import { getProvider } from '../core/agent/providers.js';
import { keyVault } from './key-vault.js';

const CONFIG_KEY = 'agentConfig';
const KEYS_KEY = 'agentKeys';

export const KEY_SCOPES = ['session', 'encrypted'];

export const DEFAULT_CONFIG = {
  // AI is optional. Only the user chooses where their conversation will be sent.
  providerId: '',
  baseUrl: '',
  model: '',
  maxSteps: 8,
  maxToolCalls: 24,
  system: null,
  // The saved prompt profile the Agent Lab answers as (F13). null is the product default —
  // the text lives in core/agent/messages.js, never in a user-editable string here.
  promptProfileId: null,
};

export async function loadAgentConfig() {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  const value = stored?.[CONFIG_KEY];
  const known = Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).filter(([key]) => Object.hasOwn(DEFAULT_CONFIG,key)));
  const config = { ...DEFAULT_CONFIG, ...known };
  // A setting from the version that had a device scope. Dropped rather than honoured.
  delete config.keyScope;
  return migrateRetiredProvider(config);
}

export async function saveAgentConfig(patch) {
  const current = await loadAgentConfig();
  const safe = Object.fromEntries(Object.entries(patch ?? {}).filter(([key]) => Object.hasOwn(DEFAULT_CONFIG,key)));
  const next = migrateRetiredProvider({ ...current, ...safe });
  if (next.providerId !== current.providerId) {
    if (!Object.hasOwn(patch, 'baseUrl')) next.baseUrl = '';
    if (!Object.hasOwn(patch, 'model')) next.model = '';
  }
  if (!getProvider(next.providerId)?.baseUrlEditable) next.baseUrl = '';
  // A key must never ride along in the config object, whatever the caller sent.
  delete next.apiKey;
  delete next.key;
  delete next.keyScope;
  await chrome.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}

// Keep histories and other preferences when upgrading or importing an old backup.
function migrateRetiredProvider(config) {
  if (config.providerId === 'chrome-on-device') {
    return { ...config, providerId: '', baseUrl: '', model: '' };
  }
  return config;
}

export async function resetAgentConfig() {
  await keyVault().reset();
  await chrome.storage.local.set({ [CONFIG_KEY]: { ...DEFAULT_CONFIG } });
  return { reset: true };
}
export const setKey = (providerId,key,passphrase) => keyVault().setKey(providerId,key,passphrase);
export const clearKey = (providerId,passphrase) => keyVault().clearKey(providerId,passphrase);
// Never exposed through a message handler.
export const getKey = providerId => keyVault().getKey(providerId);
export const keyStatus = providerId => keyVault().keyStatus(providerId);

// Anyone who used the earlier build may have a key written to disk under the old option. It
// is removed the first time this worker starts, and the removal is reported so the panel can
// say it happened rather than let the user believe a key they saved is still there.
export async function purgeLegacyDeviceKeys() {
  try {
    const stored = await chrome.storage.local.get(KEYS_KEY);
    const legacy = stored?.[KEYS_KEY];
    if (!legacy || typeof legacy !== 'object') return { purged: 0 };
    const providers = Object.keys(legacy);
    await chrome.storage.local.remove(KEYS_KEY);
    return { purged: providers.length, providers };
  } catch {
    return { purged: 0 };
  }
}
