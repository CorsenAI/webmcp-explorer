// Live timeline: attaches the observers to granted origins and turns raw page events into
// timeline entries.
//
// The MAIN-world watcher reports snapshots of tool names with a fingerprint of each contract;
// registrations, unregistrations and contract changes are derived here by diffing
// (core/timeline.js). Doing the diff in the extension keeps the page-side script side-effect free.

import { createTimeline, diffToolNames, changedParts, isToolDigest, executionKind } from '../core/timeline.js';
import { watchMainWorld } from '../page/watch.js';
import { relayInPage } from '../content/relay.js';
import { originPattern } from '../shared/permissions.js';

export const CHANNEL = '__webmcp_explorer_live__';

const timelines = new Map();
const snapshots = new Map();
const channels = new Map();
const attachments = new Map();
const watchedDocuments = new Map();

// The panel's timeline redraws when told (D-054). One notice per tab per burst: a page
// churning twenty tools produces forty events and must not cost forty messages.
const NOTIFY_DEBOUNCE_MS = 100;
const pendingNotices = new Map();

export function notifyLive(tabId, kinds = []) {
  const pending = pendingNotices.get(tabId);
  if (pending) {
    for (const kind of kinds) pending.kinds.add(kind);
    return;
  }
  const notice = { kinds: new Set(kinds) };
  notice.timer = setTimeout(() => {
    pendingNotices.delete(tabId);
    // Nobody listening — no panel open — is the normal case, not an error. The kinds let the
    // Tools list redraw on a registration without redrawing on every execution.
    chrome.runtime.sendMessage({ type: 'live-changed', tabId, kinds: [...notice.kinds] }).catch(() => {});
  }, NOTIFY_DEBOUNCE_MS);
  pendingNotices.set(tabId, notice);
}

// Which tabs currently have a timeline, and how many snapshots are held. Surfaced by
// live-list so a missing event can be traced to the right cause instead of guessed at.
export function liveDebug() {
  return {
    tabs: [...timelines.keys()],
    snapshotKeys: [...snapshots.keys()],
  };
}

// The last fingerprint of the tool names that left a document, so a name that comes back can be
// compared with what it was. Bounded: a page churning names must not grow the worker's memory.
const MAX_RETIRED = 500;
function retire(retired, toolName, digest) {
  retired.delete(toolName);
  if (retired.size >= MAX_RETIRED) retired.delete(retired.keys().next().value);
  retired.set(toolName, digest);
}

// name → fingerprint, or null where the page gave none or one that is not in the expected form.
function digestsOf(payload) {
  const list = Array.isArray(payload.digests) && payload.digests.length === payload.names.length ? payload.digests : null;
  return new Map(payload.names.map((name, index) => [name, list && isToolDigest(list[index]) ? list[index] : null]));
}

export function timelineFor(tabId) {
  if (!timelines.has(tabId)) timelines.set(tabId, createTimeline({ capacity: 500 }));
  return timelines.get(tabId);
}

export function forgetTab(tabId) {
  timelines.delete(tabId);
  channels.delete(tabId);
  for (const key of watchedDocuments.keys()) if (key.startsWith(`${tabId}:`)) watchedDocuments.delete(key);
  forgetSnapshots(tabId);
}

// Drops every snapshot of a tab. Navigation no longer needs this — each document carries its
// own token, so a new document's first snapshot is recognised as such — but a closed tab must
// not keep memory of frames that no longer exist.
export function forgetSnapshots(tabId) {
  for (const key of [...snapshots.keys()]) {
    if (key.startsWith(`${tabId}:`)) snapshots.delete(key);
  }
}

export function attachLive(tabId) {
  if (attachments.has(tabId)) return attachments.get(tabId);
  const promise = attachObservers(tabId).finally(() => attachments.delete(tabId));
  attachments.set(tabId,promise);return promise;
}

async function attachObservers(tabId) {
  if (!channels.has(tabId)) channels.set(tabId,`${CHANNEL}:${crypto.randomUUID()}`);
  const channel=channels.get(tabId);
  // Order matters. The watcher posts a snapshot as soon as it starts; installing it before
  // the relay exists sends that first message into the void, and the next change then
  // becomes the baseline — so the registrations that happened in between are never seen.
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'ISOLATED',
    func: relayInPage,
    args: [channel],
  });

  const baselines = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: watchMainWorld,
    args: [channel],
  });

  for (const result of baselines) {
    if (!Array.isArray(result.result?.names)) continue;
    watchedDocuments.set(`${tabId}:${result.frameId}`,result.documentId);
    recordLiveEvent(tabId,result.frameId,{kind:'snapshot',names:result.result.names,digests:result.result.digests,
      seq:result.result.seq,doc:result.documentId,origin:result.result.origin});
  }
  return true;
}

// Re-check current grants on every incoming page claim. A previously injected content
// script can outlive a permission removal; its existence is not continuing authorization.
export async function receiveLiveEvent(payload, sender) {
  if (sender?.id !== chrome.runtime.id || !Number.isInteger(sender?.tab?.id)
    || typeof sender.documentId !== 'string') return [];
  let origin;
  try { origin = sender.origin ?? new URL(sender.url).origin; } catch { return []; }
  const patterns = [originPattern(origin), originPattern(sender.tab.url)];
  const allowed = patterns.every(Boolean) && await chrome.permissions.contains({ origins: [...new Set(patterns)] }).catch(() => false);
  if (!allowed) { snapshots.delete(`${sender.tab.id}:${sender.frameId ?? 0}`); return []; }
  return recordLiveEvent(sender.tab.id,sender.frameId ?? 0,{...payload,origin,doc:sender.documentId,at:Date.now()});
}

export async function revalidateLiveOrigins() {
  const topPatterns = new Map();
  for (const [key, snapshot] of snapshots) {
    const tabId=Number(key.split(':')[0]);
    if (!topPatterns.has(tabId)) {
      const tab=await chrome.tabs.get(tabId).catch(()=>null);
      topPatterns.set(tabId,originPattern(tab?.url));
    }
    const patterns=[topPatterns.get(tabId),originPattern(snapshot.origin)];
    const allowed=patterns.every(Boolean)&&await chrome.permissions.contains({origins:[...new Set(patterns)]}).catch(()=>false);
    if (!allowed) snapshots.delete(key);
  }
}

export function recordLiveEvent(tabId, frameId, payload) {
  const expected = watchedDocuments.get(`${tabId}:${frameId}`);
  if (expected && payload?.doc !== expected) return [];
  if (!payload || !['snapshot','activated','cancelled','dom-changed'].includes(payload.kind)) return [];
  if (payload.kind === 'snapshot' && (!Array.isArray(payload.names) || payload.names.length > 2000
    || payload.names.some(n => typeof n !== 'string' || n.length > 200))) return [];
  if (payload.kind === 'dom-changed') {
    // Invalidation hints only: no fictitious registration enters the timeline.
    notifyLive(tabId,['registered','unregistered']); return [];
  }
  if (['activated','cancelled'].includes(payload.kind) && (typeof payload.toolName !== 'string' || payload.toolName.length > 200)) return [];
  const timeline = timelineFor(tabId);
  const at = payload.at ?? Date.now();
  const origin = payload.origin ?? payload.frameOrigin ?? null;

  if (payload.kind === 'snapshot') {
    const key = `${tabId}:${frameId}`;
    const previous = snapshots.get(key) ?? null;
    const doc = payload.doc ?? null;
    const sameDocument = previous !== null && previous.doc === doc;
    // The watcher numbers its snapshots. The baseline returned by the injection can be overtaken
    // by a snapshot the watcher posted after it; diffing the older one against the newer would
    // report the page's history backwards, so a snapshot that is not newer is dropped.
    const seq = Number.isSafeInteger(payload.seq) && payload.seq > 0 ? payload.seq : null;
    if (sameDocument && seq !== null && previous.seq !== null && seq <= previous.seq) return [];
    const digests = digestsOf(payload);
    const retired = sameDocument ? previous.retired : new Map();
    snapshots.set(key, { doc, names: payload.names, origin, digests, seq, retired });

    // The very first snapshot of a document is its existing state, not a burst of new
    // registrations: recording it as such would make every page look like it just
    // registered everything the moment Explorer opened. A snapshot carrying another document
    // token in the same frame is a first snapshot too — the frame navigated — and diffing it
    // against the page that was left would invent unregistrations (D-029). The token, not
    // the tab's loading state, decides: Chrome reports a pushState as a load as well, and
    // purging on that swallowed the next real change (measured, D-055).
    if (!sameDocument) return [];

    const { added, removed } = diffToolNames(previous.names, payload.names);
    const events = [];
    for (const toolName of added) {
      // A name this document listed before and lists again: with both fingerprints, the event
      // says whether it is the contract that left or another one, and which parts differ.
      const parts = retired.has(toolName) ? changedParts(retired.get(toolName), digests.get(toolName)) : null;
      retired.delete(toolName);
      events.push(timeline.push({ kind: 'registered', at, toolName, origin, frameId,
        ...(parts ? { contract: parts.length > 0 ? 'changed' : 'same', parts } : {}) }));
    }
    for (const toolName of removed) {
      retire(retired, toolName, previous.digests.get(toolName) ?? null);
      events.push(timeline.push({ kind: 'unregistered', at, toolName, origin, frameId }));
    }
    // A tool replaced under its own name never leaves the list (measured, D-148): the names are
    // the same in both snapshots and only the fingerprint moved.
    for (const toolName of [...payload.names].sort()) {
      if (!previous.digests.has(toolName)) continue;
      const parts = changedParts(previous.digests.get(toolName), digests.get(toolName));
      if (parts?.length > 0) events.push(timeline.push({ kind: 'changed', at, toolName, origin, frameId, parts }));
    }
    const recorded = events.filter(Boolean);
    if (recorded.length > 0) notifyLive(tabId, recorded.map((e) => e.kind));
    return recorded;
  }

  if (payload.kind === 'activated' || payload.kind === 'cancelled') {
    const event = timeline.push({
      kind: payload.kind, at, toolName: payload.toolName, origin, frameId,
    });
    if (event) notifyLive(tabId, [event.kind]);
    return event ? [event] : [];
  }

  return [];
}

export function recordExecution(tabId, call) {
  const timeline = timelineFor(tabId);
  const event = timeline.push({
    kind: executionKind(call),
    at: call.startedAt ?? Date.now(),
    toolName: call.toolName,
    origin: call.origin,
    frameId: call.frameId,
    durationMs: call.durationMs ?? null,
    code: call.code ?? null,
    error: call.error ?? null,
  });
  if (event) notifyLive(tabId, [event.kind]);
  return event;
}
