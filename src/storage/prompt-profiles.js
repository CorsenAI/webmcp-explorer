// Prompt profiles: named system prompts the user writes and switches between (F13).
//
// The Agent Lab always has a system prompt — the product default says plainly who the model
// is talking to and which rules of this product bind it. A profile replaces that default with
// the user's own words: "agent that only reads", " terse answers", whatever they want. The
// tool schemas, the tool-call format and the safety refusals are NOT in the prompt and cannot
// be edited away by a profile — they are transport and loop behaviour, not instructions.
//
// A profile is local text in chrome.storage.local, like every other stored thing. It never
// leaves the machine except when the user exports their own settings on purpose.

import { DEFAULT_SYSTEM } from '../core/agent/messages.js';

const STORE_KEY = 'promptProfiles';
const MAX_PROFILES = 20;
const MAX_NAME = 40;
const MAX_TEXT = 8000;

// The product default, and the only entry that cannot be deleted. The text is core/agent's
// DEFAULT_SYSTEM — one source of truth: what the panel offers as "the default" is exactly
// what an un-profiled run sends. The first sentence names the surface the model answers from
// — an agent inside the WebMCP Explorer extension — because a model that does not know where
// it sits answers to the wrong audience (owner's request, 2026-09-16).
export const DEFAULT_PROMPT_TEXT = DEFAULT_SYSTEM;

async function readAll() {
  const stored = await chrome.storage.local.get(STORE_KEY);
  const list = stored?.[STORE_KEY];
  return Array.isArray(list) ? list.filter((p) => p && typeof p === 'object' && p.id) : [];
}

function validate({ name, text }) {
  const errors = [];
  const cleanName = String(name ?? '').trim();
  const cleanText = String(text ?? '').trim();
  if (!cleanName) errors.push('A prompt needs a name.');
  else if (cleanName.length > MAX_NAME) errors.push(`The name is too long (${MAX_NAME} characters at most).`);
  if (!cleanText) errors.push('A prompt needs instructions.');
  else if (cleanText.length > MAX_TEXT) errors.push(`The prompt is too long (${MAX_TEXT} characters at most).`);
  return { ok: errors.length === 0, errors, name: cleanName, text: cleanText };
}

export async function listProfiles() {
  return readAll();
}

// The text a run must use for a saved profile id. Unknown or deleted ids fall back to the
// product default — never to an empty system prompt, which would silently drop the rules.
export async function profileText(id) {
  if (!id) return DEFAULT_PROMPT_TEXT;
  const found = (await readAll()).find((p) => p.id === id);
  return found ? found.text : DEFAULT_PROMPT_TEXT;
}

export async function saveProfile({ id, name, text }) {
  const check = validate({ name, text });
  if (!check.ok) return { errors: check.errors };
  const all = await readAll();
  if (id) {
    const index = all.findIndex((p) => p.id === id);
    if (index === -1) return { error: 'No such prompt.' };
    if (all.some((p, i) => i !== index && p.name.toLowerCase() === check.name.toLowerCase())) {
      return { errors: ['A prompt with that name already exists.'] };
    }
    all[index] = { ...all[index], name: check.name, text: check.text, updatedAt: Date.now() };
    await chrome.storage.local.set({ [STORE_KEY]: all });
    return { profile: all[index] };
  }
  if (all.length >= MAX_PROFILES) {
    return { error: `A maximum of ${MAX_PROFILES} prompts is kept. Delete one first.` };
  }
  if (all.some((p) => p.name.toLowerCase() === check.name.toLowerCase())) {
    return { errors: ['A prompt with that name already exists.'] };
  }
  const profile = {
    id: crypto.randomUUID(), name: check.name, text: check.text,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [STORE_KEY]: [...all, profile] });
  return { profile };
}

export async function deleteProfile(id) {
  const all = await readAll();
  const rest = all.filter((p) => p.id !== id);
  await chrome.storage.local.set({ [STORE_KEY]: rest });
  // A configuration pointing at a deleted prompt must not keep the id: the next run falls
  // back to the product default through profileText's own rule, and saving clears the stale
  // reference outright.
  return { deleted: true };
}

// Settings-bundle shape: the whole list is exported and imported as data the user owns.
// Import replaces the list wholesale — the bundle came from this same machine class, keys and
// secrets are not in it by construction.
export async function replaceProfiles(list) {
  if (!Array.isArray(list)) return { error: 'The prompts section must be a list.' };
  const clean = [];
  for (const item of list.slice(0, MAX_PROFILES)) {
    const check = validate(item ?? {});
    if (!check.ok) continue; // an invalid entry is dropped; the valid ones are the user's work
    clean.push({
      id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
      name: check.name, text: check.text,
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Date.now(),
    });
  }
  await chrome.storage.local.set({ [STORE_KEY]: clean });
  return { count: clean.length };
}

export async function clearProfiles() {
  await chrome.storage.local.remove(STORE_KEY);
  return { cleared: true };
}
