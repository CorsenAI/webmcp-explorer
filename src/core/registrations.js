// "Why is my tool not there?" — what happened to each registerTool() call Instrumentation Mode
// saw, matched against what getTools() returns. Pure JavaScript: no chrome.*, no DOM.
//
// Four states, kept apart on purpose (a shared "defect" label would say more than was seen):
//
//   rejected     — the call threw synchronously, or the promise it returned rejected and nobody
//                  handled it (an unhandledrejection event named that promise). Measured on
//                  Chrome 153 (WMP-0043): every refusal is an asynchronous rejection — an empty
//                  description (InvalidStateError "Description is required", WMP-0039), a
//                  missing member or a non-callable execute (TypeError from the binding), a
//                  duplicate name (InvalidStateError), a signal already aborted (AbortError);
//   removed      — the page released the AbortSignal it registered with after the registration
//                  settled: a normal removal, and getTools() drops the tool at once;
//   not-exposed  — the call returned without a promise to watch, no removal was seen, and
//                  getTools() does not list the tool: a runtime that accepted the call
//                  synchronously and never exposed it (no Chrome 153 case does this);
//   unknown      — not enough was observed to say: no record for the call, or a promise whose
//                  fate could not be seen (a rejection the page handled itself leaves no event).
//
// A signal aborted before the registration settled rejects the promise (AbortError): that is a
// rejection, reported as one, with the abort noted beside it.

import { parseStack } from './source.js';

export const REGISTRATION = {
  rejected: 'rejected',
  removed: 'removed',
  notExposed: 'not-exposed',
  unknown: 'unknown',
};

function stateOf(entry) {
  if (!entry) return REGISTRATION.unknown;
  if (entry.outcome === 'threw' || entry.promise === 'rejected') return REGISTRATION.rejected;
  if (entry.unregisteredAt) return REGISTRATION.removed;
  if (entry.outcome === 'returned' && entry.promise === 'none') return REGISTRATION.notExposed;
  return REGISTRATION.unknown;
}

function detailOf(entry, state) {
  if (state === REGISTRATION.rejected) {
    return entry.outcome === 'threw'
      ? { kind: 'threw', message: entry.error ?? '' }
      : { kind: 'promise-rejected', message: entry.rejection ?? '' };
  }
  if (state === REGISTRATION.removed) return { kind: 'signal-aborted', message: '' };
  if (state === REGISTRATION.notExposed) return { kind: 'returned-not-listed', message: '' };
  if (entry?.outcome === 'returned' && entry.promise === 'pending') return { kind: 'promise-unobserved', message: '' };
  return { kind: 'unobserved', message: '' };
}

// `frames` are the probed frames (each may carry `registrations`, the table Instrumentation Mode
// kept in that frame); `tools` the registry's live instances (frameId + name). Returns one row
// per registration whose name is not exposed by that frame, plus how many were seen at all.
export function diagnoseRegistrations({ frames = [], tools = [] } = {}) {
  const exposed = new Set(tools
    .filter((tool) => Number.isInteger(tool.frameId))
    .map((tool) => `${tool.frameId} ${tool.name}`));
  const missing = [];
  let seen = 0;
  let instrumentedFrames = 0;

  for (const frame of frames) {
    if (!frame.instrumented || !Array.isArray(frame.registrations)) continue;
    instrumentedFrames += 1;
    for (const entry of frame.registrations) {
      if (!entry || typeof entry.name !== 'string') continue;
      seen += 1;
      if (exposed.has(`${frame.frameId} ${entry.name}`)) continue;
      const state = stateOf(entry);
      missing.push({
        name: entry.name,
        frameId: frame.frameId,
        origin: frame.origin ?? null,
        state,
        detail: detailOf(entry, state),
        // A fact about the descriptor, reported beside the state. Chrome 153 was measured to
        // reject a registration whose description is empty (WMP-0039).
        emptyDescription: entry.emptyDescription === true,
        // Whether the promise's fate could be observed at all: 'none' (no promise returned),
        // 'pending' (a promise whose outcome was not seen), 'rejected' (seen rejecting).
        promise: entry.promise ?? 'none',
        // The page aborted the signal it registered with — before the registration settled when
        // the state is "rejected" (the AbortError says so), after it when "removed".
        signalAborted: Boolean(entry.unregisteredAt),
        registrations: entry.registrations ?? 1,
        at: entry.at ?? null,
        source: parseStack(entry.stack, { drop: 1 }),
      });
    }
  }

  missing.sort((a, b) => a.name.localeCompare(b.name) || (a.frameId ?? 0) - (b.frameId ?? 0));
  return { missing, seen, instrumentedFrames };
}
