// Aggregates the tools reported by every probed frame into one registry, and reports
// honestly whether discovery was complete. Pure JavaScript: no chrome.* API.
// See docs/ARCHITECTURE.md sections 1 and 3bis, D-015 and D-021.
//
// The subtle part is deduplication. getTools() aggregates same-origin frames, so a page with
// N same-origin frames reports the same tool N times. The probe marks `ownFrame` by comparing
// the tool's own `window` against the frame's, which tells us which frame really registered
// it. A tool nobody claims — typically from an origin Explorer could not enter — is still
// listed once, with no frameId and flagged as not injected. It is never dropped and never
// given a made-up frame.
//
// Two identities live side by side (D-012, D-056). The logicalId is the cross-session identity
// — top origin, frame path, tool name — that lets history, overrides and snapshots follow a
// tool across reloads. The instance is the live, executable thing: one per frame that owns
// the tool. Two iframes loading the same URL each own a tool of the same name and share a
// logicalId; both instances are kept, because dropping one would make it unreachable.

import { frameKey, logicalId, contractParts } from './identity.js';
import { toSchemaObject } from './schema/parse.js';
import { parseStack } from './source.js';
import { selectRuntimeContract } from './runtime-contract.js';

// The fingerprint must describe the CONTRACT, not the wire format it arrived in. Hashing
// the raw value would change every fingerprint the day Chrome stops stringifying schemas,
// silently invalidating history, snapshots and saved calls (D-025).
// contractFp is the whole contract; contractParts says which part a later change touched.
async function fingerprintOf(raw) {
  const { contract, ...parts } = await contractParts({
    inputSchema: toSchemaObject(raw.inputSchema).schema,
    annotations: raw.annotations,
    description: raw.description,
  });
  return { contractFp: contract, contractParts: parts };
}

// Where the tool was registered, when Instrumentation Mode captured it. Three distinct
// states, and collapsing them would be the exact dishonesty this feature must avoid:
// instrumentation was off, it was on but the stack points nowhere in the page, or a real
// location is known.
function sourceOf(raw, frame) {
  if (!frame.instrumented) return { known: false, unknownReason: 'not-instrumented' };
  if (!raw.registrationStack) return { known: false, unknownReason: 'not-instrumented' };
  // Two frames of Explorer's own wrapper sit on top of every captured stack.
  const parsed = parseStack(raw.registrationStack.stack, { drop: 1 });
  return {
    ...parsed,
    capturedAt: raw.registrationStack.at ?? null,
    registrations: raw.registrationStack.registrations ?? 1,
  };
}

function shape(raw, frame, key, { owned }) {
  const toolOrigin = raw.origin ?? frame.origin;
  // Chrome 152 hands inputSchema over as a JSON string (D-025). Parse once, here, so the
  // rest of the app — form, tree, validation, fingerprint — always sees an object.
  const { schema, error: schemaError } = toSchemaObject(raw.inputSchema);
  const declarative = new Set(frame.declarativeToolNames ?? []);
  const hasAutoSubmitList = Array.isArray(frame.declarativeAutoSubmitNames);
  const autoSubmit = new Set(frame.declarativeAutoSubmitNames ?? []);
  // Finding the form proves declarative; not finding it proves nothing (D-016).
  const isDeclarative = owned && declarative.has(raw.name);

  return {
    name: raw.name,
    ...(frame.documentId ? { documentId: frame.documentId } : {}),
    runtimeId: raw.runtimeId ?? 'document',
    executionContract: selectRuntimeContract(raw),
    inventoryOnly: raw.inventoryOnly === true,
    schemaSource: raw.schemaSource ?? 'runtime', schemaComplete: raw.schemaComplete ?? true,
    schemaWarnings: raw.schemaWarnings ?? [],
    registrationSource: raw.registrationSource ?? (isDeclarative ? 'declarative-html' : null),
    // The human-readable title a page may give a tool; getTools() returns it on Chrome 152 and
    // 153 (tools/probe-platform.mjs). Empty when the page gave none.
    title: typeof raw.title === 'string' ? raw.title : '',
    description: raw.description ?? '',
    inputSchema: schema,
    schemaError,
    annotations: raw.annotations ?? {},
    annotationsObserved: raw.annotationsObserved === true,
    origin: toolOrigin,
    frameId: owned ? frame.frameId : null,
    frameKey: owned ? key : null,
    // The frame as a person or a script finds it: its full URL, and its position in the tree
    // (index path, top first) for when several frames share that URL (export/repro.js).
    frameUrl: owned ? (frame.frameUrl ?? null) : null,
    frameIndexPath: owned ? (Array.isArray(frame.frameIndexPath) ? frame.frameIndexPath : null) : null,
    notInjected: !owned,
    registrationType: isDeclarative || raw.inventoryOnly ? 'declarative' : raw.registrationSource?.startsWith('imperative') || raw.registrationSource === 'provideContext-legacy' ? 'imperative' : 'unknown',
    registrationConfidence: isDeclarative ? 'high' : 'none',
    autoSubmit: isDeclarative && hasAutoSubmitList ? autoSubmit.has(raw.name) : null,
    // Engine v3 facts, present only when observed: form controls for a declarative tool (names and
    // markers, never values), exposedTo and callback-source labels from Instrumentation Mode.
    form: (isDeclarative || raw.inventoryOnly) && owned ? frame.formFacts?.[raw.name] ?? null : null,
    exposedTo: Array.isArray(raw.exposedTo) ? raw.exposedTo.slice(0, 20).map(String) : null,
    callbackObservation: raw.callbackObservation && typeof raw.callbackObservation === 'object' ? raw.callbackObservation : null,
    // Only a tool this frame actually registered can have a source: a tool aggregated from
    // another same-origin frame was not registered here (D-021).
    source: owned ? sourceOf(raw, frame) : { known: false, unknownReason: 'not-instrumented' },
  };
}

export async function buildRegistry({ topOrigin, frames = [] }) {
  const owned = new Map();
  const unclaimed = new Map();
  const ungranted = new Set();

  for (const frame of frames) {
    const key = frameKey({
      isTopLevel: frame.isTopLevel,
      frameUrl: frame.frameUrl,
      frameIndexPath: frame.frameIndexPath ?? [],
    });

    for (const raw of frame.tools ?? []) {
      const toolOrigin = raw.origin ?? frame.origin;

      // Older probes, and any frame that cannot compare windows, fall back to matching the
      // frame origin. It is less precise but never invents ownership.
      const isOwned = raw.ownFrame === undefined
        ? toolOrigin === frame.origin
        : raw.ownFrame === true;

      if (isOwned) {
        const id = await logicalId({ topOrigin, frameKey: key, toolName: raw.name });
        // One instance per owning frame. A frame cannot register the same name twice, so the
        // guard only protects against a probe reporting a tool twice.
        const suffix = raw.inventoryOnly ? `:html-${raw.inventoryId ?? 0}` : raw.runtimeId === 'navigator' ? ':navigator' : '';
        const instanceId = `${id}@${frame.frameId}${suffix}`;
        if (!owned.has(instanceId)) {
          owned.set(instanceId, {
            ...shape(raw, frame, key, { owned: true }),
            logicalId: id,
            instanceId,
            ...(await fingerprintOf(raw)),
          });
        }
        continue;
      }

      const id = await logicalId({ topOrigin, frameKey: toolOrigin, toolName: raw.name });
      if (!unclaimed.has(id)) {
        unclaimed.set(id, {
          entry: {
            ...shape(raw, frame, key, { owned: false }),
            logicalId: id,
            instanceId: `${id}@unreachable`,
            ...(await fingerprintOf(raw)),
          },
          origin: toolOrigin,
        });
      }
    }
  }

  // A tool is only "seen but unreachable" if no frame claimed it by name and origin.
  const claimedNames = new Set(Array.from(owned.values()).map((t) => `${t.origin}\u0000${t.name}`));
  const tools = Array.from(owned.values());

  for (const { entry, origin } of unclaimed.values()) {
    if (claimedNames.has(`${entry.origin}\u0000${entry.name}`)) continue;
    ungranted.add(origin);
    tools.push(entry);
  }

  // Stable order: origin, name, then the frame — so two instances of one tool always come out
  // in the same order and never swap places between two discoveries.
  const frameRank = (tool) => (tool.frameId === null ? Number.MAX_SAFE_INTEGER : tool.frameId);
  tools.sort((a, b) => a.origin.localeCompare(b.origin)
    || a.name.localeCompare(b.name)
    || frameRank(a) - frameRank(b));

  return {
    topOrigin,
    tools,
    completeness: {
      complete: ungranted.size === 0,
      ungrantedOrigins: Array.from(ungranted).sort(),
    },
  };
}
