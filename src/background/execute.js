// Orchestrates one tool execution from the service worker.
//
// Two timings are kept apart on purpose: `durationMs` is measured inside the page around
// executeTool alone, `roundTripMs` includes the extension hop. Reporting only the second
// would blame the tool for Explorer's own overhead, which is exactly the kind of lie a
// profiler must not tell.
//
// Every call has an id. It is how a call still in flight can be cancelled (cancelTool): the
// page-side controller is aborted through a second injection, so the runtime settles the call
// with an AbortError — measured on Chrome 152 and 153 (WMP-0035) — and, should the page not
// answer any more, the call is settled here with the same outcome. A cancelled call is
// recorded as such: it is neither a success nor a tool failure.

import { executeToolInPage, cancelToolInPage } from '../page/execute.js';
import { createEntry } from '../core/history.js';
import { appendCall } from '../storage/db.js';
import { resolveCall, consumeOnce } from '../core/overrides.js';
import { getOverride, saveOverride } from '../storage/overrides.js';
import { isDemoTabId, demoExecute, demoCancel } from './demo-bridge.js';
import { untilTabGone, goneOutcome } from './tab-watch.js';
import { createInvocationGuard } from '../storage/invocations.js';

const invokeOnce = createInvocationGuard();
const preparing = new Map();

// Calls in flight, by call id. Each entry knows where its page-side controller lives and how
// to settle the call from here.
const inflight = new Map();

// How long to give the page to settle a call after its controller was aborted, before the
// call is settled here anyway. Measured: the runtime answers within a few milliseconds.
const CANCEL_GRACE_MS = 1500;

export const CANCELLED = Object.freeze({
  ok: false,
  code: 'cancelled',
  cancelled: true,
  error: 'Cancelled from Explorer. The page\'s tool may still have finished its work; its answer was discarded.',
});

export function newCallId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function inflightCallIds() {
  return [...inflight.keys()];
}

function track(callId, entry) {
  let settle = () => {};
  const promise = new Promise((resolve) => { settle = resolve; });
  inflight.set(callId, { ...entry, settle });
  return { promise, done: () => inflight.delete(callId) };
}

// Waits for `ms` unless the call is cancelled first.
function latency(ms, cancelled) {
  return Promise.race([
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
    cancelled.then(() => CANCELLED),
  ]);
}

export async function runTool(tabId, call) {
  const callId = call.callId ?? newCallId();
  const ownPreparation = !preparing.has(callId);
  const preparation = preparing.get(callId) ?? {tabId,cancelled:false};
  if (ownPreparation) preparing.set(callId,preparation);
  try {
  let documentId = call.documentId ?? call.tool?.documentId;
  if (!documentId && !isDemoTabId(tabId)) {
    try {
      const target = { tabId, frameIds: [Number.isInteger(call.frameId) ? call.frameId : 0] };
      const [identity] = await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: identifyExecutionDocument });
      documentId = identity?.documentId;
      if (!documentId) throw Error('document identity unavailable');
    } catch {
      return { ok: false, callId, code: 'document-unavailable', attempts: 0, dispatchState: 'not-dispatched',
        effectState: 'none', error: 'The target document could not be pinned. Discover the page again.' };
    }
  }
  const request = { callId, tabId, documentId: documentId ?? `demo-${tabId}`, frameId: call.frameId ?? 0,
    toolName: call.toolName, origin: call.origin ?? null, args: call.args ?? {},
    runtimeId: call.tool?.runtimeId ?? null };
  return await invokeOnce(request, () => preparation.cancelled
    ? { ...CANCELLED, callId, attempts:0, dispatchState:'not-dispatched',effectState:'none' }
    : dispatchTool(tabId, { ...call, callId, documentId }));
  } finally { if (ownPreparation) preparing.delete(callId); }
}

// Read-only document pinning. The documentId comes from Chrome's InjectionResult, not the page.
function identifyExecutionDocument() { return null; }

async function dispatchTool(tabId, { frameId, documentId, toolName, origin, args, tool, topOrigin, callId, expectedOverride, probe = null }) {
  const startedAt = Date.now();
  let dispatchStarted = false;
  const argsJson = JSON.stringify(args ?? {});
  const id = callId ?? newCallId();
  const finish = (outcome) => ({
    attempts: dispatchStarted ? 1 : 0,
    dispatchState: dispatchStarted ? 'dispatched' : 'not-dispatched',
    effectState: dispatchStarted ? 'unknown' : 'none',
    ...outcome,
    callId: id,
    roundTripMs: Date.now() - startedAt,
    startedAt,
    toolName,
    origin,
    frameId: frameId ?? null,
    ...(documentId ? { documentId } : {}),
    ...(probe ? { probe } : {}),
    args: args ?? {},
  });

  const tracked = track(id, { tabId, frameId: frameId ?? null, documentId, demo: isDemoTabId(tabId) });
  try {
    // A mocked or blocked call never reaches the page at all — that is what makes it possible
    // to test an agent against failures the backend cannot produce on demand.
    const override = tool?.logicalId ? await getOverride(tool.logicalId) : null;
    if (expectedOverride !== undefined && JSON.stringify(override) !== JSON.stringify(expectedOverride)) {
      return finish({ ok: false, code: 'override-changed', error: 'The local override changed after review. This call was not executed; review it again.' });
    }
    if (override) {
      const decision = resolveCall(override);
      if (decision.kind !== 'passthrough') {
        if (decision.latencyMs > 0) {
          const interrupted = await latency(decision.latencyMs, tracked.promise);
          if (interrupted) {
            const cancelledCall = finish({ ...interrupted, durationMs: Date.now() - startedAt });
            await recordHistory(tool, args, cancelledCall, topOrigin);
            return cancelledCall;
          }
        }
        const spent = consumeOnce(override);
        if (spent !== override) await saveOverride(spent);

        const mockedCall = finish({ ...decision.outcome, durationMs: decision.latencyMs });
        await recordHistory(tool, args, mockedCall, topOrigin);
        return mockedCall;
      }
    }

    // The bundled demo cannot be injected into, so it runs the same executor itself (D-049).
    if (isDemoTabId(tabId)) {
      dispatchStarted = true;
      const payload = await Promise.race([
        demoExecute(tabId, toolName, origin ?? null, argsJson, id),
        tracked.promise,
      ]);
      const call = payload ?? {
        ok: false, code: 'demo-bridge-lost', error: 'The demo page stopped answering. Reload it.',
      };
      const outcome = finish(call);
      await recordHistory(tool, args, outcome, topOrigin);
      return outcome;
    }

    const target = { tabId };
    // A tool lives in exactly one frame; injecting everywhere would run it more than once.
    if (documentId) target.documentIds = [documentId];
    else if (Number.isInteger(frameId)) target.frameIds = [frameId];

    // A page that navigates away under a running tool never answers, and Chrome never settles
    // the injection (measured, C5). The call is raced against the tab going away so it ends
    // with a reason instead of staying "Running…" forever — and against a cancellation from
    // here, for a page that no longer answers its controller.
    const gone = untilTabGone(tabId);
    let injection;
    try {
      dispatchStarted = true;
      injection = await Promise.race([
        chrome.scripting.executeScript({
          target,
          world: 'MAIN',
          func: executeToolInPage,
          args: [toolName, origin ?? null, argsJson, id, tool?.executionContract ?? (tool?.inventoryOnly ? { inventoryOnly: true } : null)],
        }).then(([first]) => first),
        gone.promise.then((reason) => ({ result: goneOutcome(reason) })),
        tracked.promise.then((outcome) => ({ result: outcome })),
      ]);
    } catch (error) {
      return finish({
        ok: false,
        code: 'injection-failed',
        error: String(error?.message ?? error),
      });
    } finally {
      gone.stop();
    }

    const outcome = injection?.result ?? {
      ok: false,
      code: 'no-result',
      error: 'The page returned nothing. The frame may have navigated away.',
    };

    const call = finish(outcome);
    await recordHistory(tool, args, call, topOrigin);
    return call;
  } finally {
    tracked.done();
  }
}

// Cancels one call in flight. The page-side controller is aborted first, so a runtime that
// hands the signal to the tool (Chrome 153) lets the tool stop too; if the page confirms, the
// call settles through its own injection with the in-page duration. If the page cannot be
// reached, or does not settle in time, the call is settled here.
export async function cancelTool(tabId, callId) {
  const entry = inflight.get(callId);
  if (!entry) {
    const pending = preparing.get(callId);
    if (pending && pending.tabId === tabId) { pending.cancelled=true;return {cancelled:true,inPage:false}; }
    return { cancelled: false, reason: 'not-in-flight' };
  }
  if (entry.tabId !== tabId) return {cancelled:false,reason:'wrong-tab'};

  let inPage = false;
  try {
    if (entry.demo) {
      inPage = Boolean((await demoCancel(tabId, callId))?.found);
    } else {
      const target = { tabId: entry.tabId };
      if (entry.documentId) target.documentIds = [entry.documentId];
      else if (Number.isInteger(entry.frameId)) target.frameIds = [entry.frameId];
      const [first] = await chrome.scripting.executeScript({
        target, world: 'MAIN', func: cancelToolInPage, args: [callId],
      });
      inPage = Boolean(first?.result?.found);
    }
  } catch {
    inPage = false;
  }

  if (inPage) {
    // Give the page its chance to settle the call itself, then settle here regardless.
    await new Promise((resolve) => setTimeout(resolve, CANCEL_GRACE_MS));
  }
  if (inflight.has(callId)) inflight.get(callId).settle({ ...CANCELLED, durationMs: null });
  return { cancelled: true, inPage };
}

// History is a side effect: a storage failure must never lose the user's result.
async function recordHistory(tool, args, call, topOrigin) {
  if (!tool) return;
  try {
    const entry = createEntry({
      tool, args: args ?? {}, outcome: call, at: call.startedAt ?? Date.now(),
    });
    await appendCall(entry, topOrigin ?? null);
    call.historyId = entry.id;
  } catch (error) {
    call.historyError = String(error?.message ?? error);
  }
}
