// Turning Instrumentation Mode on and off, per origin.
//
// It is off by default and it must stay that way (the rule the whole feature was approved
// under). This is the only part of Explorer that changes the inspected page: it registers a
// content script that runs before the page's own code and replaces registerTool with a
// wrapper. Native WebMCP is the source of truth, and a permanent wrapper would let Explorer
// hide a browser bug from the developer it exists to help.
//
// It is also the only feature that needs a reload to take effect, because a registration that
// already happened cannot be observed after the fact. The interface has to say so; pretending
// otherwise would produce a screen full of "unknown" with no explanation.

import { originPattern } from '../shared/permissions.js';

const ID_PREFIX = 'webmcp-explorer-instrument:';
const FILE = 'content/instrument.js';

function idFor(pattern) {
  return `${ID_PREFIX}${pattern}`;
}

async function registered() {
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    return scripts.filter((script) => script.id.startsWith(ID_PREFIX));
  } catch {
    return [];
  }
}

export async function instrumentedOrigins() {
  return (await registered()).flatMap((script) => script.matches ?? []);
}

export async function isInstrumented(url) {
  const pattern = originPattern(url);
  if (!pattern) return false;
  return (await instrumentedOrigins()).includes(pattern);
}

// One change to the registered content scripts at a time. Turning instrumentation or emulation on
// or off reads the registrations and then changes them; two such requests interleaved could leave
// the instrumentation script registered after it was turned off, or reject (measured on
// 2026-11-09: 4 and 55 times in 60 rounds sent together, never when sent one after the other).
let queue = Promise.resolve();
function serial(work) {
  const run = queue.then(work, work);
  queue = run.then(() => {}, () => {});
  return run;
}

export function setInstrumented(url, on) {
  return serial(() => applyInstrumented(url, on));
}

async function applyInstrumented(url, on) {
  const pattern = originPattern(url);
  if (!pattern) return { error: 'That page cannot be instrumented.' };

  // Chrome refuses to register a script for an origin it has not been granted, and the error
  // it gives is not one a user could act on.
  if (on && !(await chrome.permissions.contains({ origins: [pattern] }))) {
    return { error: 'Allow Explorer on this site first.' };
  }

  const id = idFor(pattern);
  const already = (await registered()).some((script) => script.id === id);

  try {
    if (on && !already) {
      await chrome.scripting.registerContentScripts([{
        id,
        matches: [pattern],
        js: (await emulatedOrigins()).includes(pattern) ? ['content/webmcp-polyfill.js', FILE] : [FILE],
        // Both are essential: the page's own world, before the page's first script.
        world: 'MAIN',
        runAt: 'document_start',
        allFrames: true,
        persistAcrossSessions: false,
      }]);
    } else if (!on && already) {
      await chrome.scripting.unregisterContentScripts({ ids: [id] });
    }
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }

  return {
    on,
    pattern,
    // Nothing already registered can be captured retroactively, so a truthful answer says a
    // reload is needed rather than leaving the user to wonder why nothing changed.
    reloadRequired: true,
  };
}

// A revoked origin must not keep an instrumented content script behind.
export function forgetInstrumentation(origins = []) {
  return serial(() => removeInstrumentation(origins));
}

async function removeInstrumentation(origins) {
  const patterns = new Set(origins);
  const ids = (await registered())
    .filter((script) => (script.matches ?? []).some((match) => patterns.has(match)))
    .map((script) => script.id);
  if (!ids.length) return { removed: 0 };
  try {
    await chrome.scripting.unregisterContentScripts({ ids });
  } catch {
    return { removed: 0 };
  }
  return { removed: ids.length };
}

// Separate session opt-in: enabling observation never enables emulation.
const EMULATION_PREFIX = 'webmcp-explorer-emulate:';
export async function emulatedOrigins() {
  return (await chrome.scripting.getRegisteredContentScripts())
    .filter(s => s.id.startsWith(EMULATION_PREFIX)).flatMap(s => s.matches ?? []);
}
export function setEmulated(url, on) {
  return serial(() => applyEmulated(url, on));
}

async function applyEmulated(url, on) {
  const pattern = originPattern(url);
  if (!pattern) return { error: 'This page cannot be emulated.' };
  if (on && !(await chrome.permissions.contains({ origins: [pattern] }))) return { error: 'Allow Explorer on this site first.' };
  const id = `${EMULATION_PREFIX}${pattern}`;
  const exists = (await emulatedOrigins()).includes(pattern);
  if (on && !exists) await chrome.scripting.registerContentScripts([{
    id, matches: [pattern], js: ['content/webmcp-polyfill.js'], world: 'MAIN',
    runAt: 'document_start', allFrames: true, persistAcrossSessions: false,
  }]);
  if (!on && exists) await chrome.scripting.unregisterContentScripts({ ids: [id] });
  if (await isInstrumented(url)) await chrome.scripting.updateContentScripts([{
    id: idFor(pattern), js: on ? ['content/webmcp-polyfill.js', FILE] : [FILE],
  }]);
  return { on, pattern, reloadRequired: true };
}
