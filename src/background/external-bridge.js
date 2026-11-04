// Bridge registration for third-party agent access (F11/D-114).
//
// The agent bridge is a content script, and a content script is only ever present where the
// user said yes: enabling access does two things in order, and the second only runs if the
// first was accepted —
//
//   1. Chrome's own host permission for that exact origin (asked on a user gesture, so the
//      browser shows its bubble — D-014, the same gate every other page access uses);
//   2. a persistent registerContentScripts entry for that origin, pointing at
//      content/agent-bridge.js.
//
// Revoking removes the registration first and forgets the grant after, so a revoked site loses
// the bridge at the next navigation and loses the channel immediately: the worker re-checks
// the grant on EVERY message, so a page that already holds a loaded bridge still gets refused.
//
// Nothing is ever registered at install: the manifest carries no content_scripts for this
// surface, and an un-allowed origin can never have a registration because the worker refuses
// an origin outside AGENT_ORIGINS.

import { isAllowedAgentOrigin } from '../core/external/api.js';
import { listGrants } from '../storage/external-access.js';

export function bridgeIdFor(origin) {
  return `wmp-agent-bridge:${origin}`;
}

export function bridgeMatches(origin) {
  // The exact origin as a pattern, never a wildcard: the list comes from AGENT_ORIGINS, and
  // a mismatch here would widen the surface silently.
  if (!isAllowedAgentOrigin(`${origin}/`)) return null;
  return [`${origin}/*`];
}

export async function ensureBridgeRegistrations() {
  // Called at worker start. Registrations are persistent, but a reload of an unpacked
  // extension clears them while the grants live in storage: re-register what the user
  // switched on, and drop any registration that no longer has a grant behind it.
  const [grants, existing] = await Promise.all([
    listGrants(),
    chrome.scripting.getRegisteredContentScripts().catch(() => []),
  ]);
  const wanted = new Set(grants.map((g) => bridgeIdFor(g.origin)));
  const registered = new Set((existing ?? []).map((s) => s.id));

  const ops = [];
  for (const grant of grants) {
    const matches = bridgeMatches(grant.origin);
    if (!matches) continue; // an origin removed from the allow-list is never (re)registered
    if (!registered.has(bridgeIdFor(grant.origin))) {
      ops.push(chrome.scripting.registerContentScripts([{
        id: bridgeIdFor(grant.origin),
        matches,
        js: ['content/agent-bridge.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      }]));
    }
  }
  // A registration with no grant (stale, or from a build that listed more origins) goes away.
  const strays = (existing ?? [])
    .filter((s) => String(s.id).startsWith('wmp-agent-bridge:') && !wanted.has(s.id))
    .map((s) => s.id);
  if (strays.length) {
    ops.push(chrome.scripting.unregisterContentScripts({ ids: strays }).catch(() => {}));
  }
  await Promise.all(ops);
  return { registered: wanted.size };
}

export async function registerBridge(origin) {
  const matches = bridgeMatches(origin);
  if (!matches) return { error: 'That origin is not allowed to talk to Explorer.' };
  const granted = await chrome.permissions.contains({ origins: matches });
  if (!granted) {
    // The UI asks Chrome's permission before calling this; a worker that finds none never
    // injects, whatever the caller believes.
    return { error: 'The site permission for that origin is not granted.' };
  }
  await chrome.scripting.registerContentScripts([{
    id: bridgeIdFor(origin),
    matches,
    js: ['content/agent-bridge.js'],
    runAt: 'document_idle',
    persistAcrossSessions: true,
  }]).catch(async (cause) => {
    // Re-registering the same id throws; that is the already-on case, not a failure.
    if (!/already registered|Duplicate/i.test(String(cause?.message ?? cause))) throw cause;
  });
  return { registered: true, origin };
}

export async function unregisterBridge(origin) {
  await chrome.scripting.unregisterContentScripts({ ids: [bridgeIdFor(origin)] })
    .catch(() => {}); // never registered: nothing to take away
  return { unregistered: true, origin };
}
