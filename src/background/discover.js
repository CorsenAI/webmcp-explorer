// Orchestrates discovery. Runs in the service worker: it is the only context that talks to
// chrome.scripting, and the only one that will ever hold provider credentials.
//
// executeScript returns the injected function's value directly, so discovery needs no
// message bridge. Each InjectionResult carries frameId and documentId, which is how the
// origin/frame correlation is built without the webNavigation permission (D-015).

import { probeMainWorld } from '../page/probe.js';
import { buildRegistry } from '../core/registry.js';
import { diagnoseEnvironment } from '../core/env.js';
import { findUnreachableFrames, computeCompleteness } from '../core/frames.js';
import { applyOverrides } from '../core/overrides.js';
import { contractFingerprint } from '../core/identity.js';
import { diagnoseRegistrations } from '../core/registrations.js';
import { isDemoTabId, demoProbe } from './demo-bridge.js';
import { listOverrides } from '../storage/overrides.js';
import { declarativeSchema } from '../core/declarative-schema.js';
import { CALLBACK_PATTERN_DATA, formFactsOf } from '../core/discovery-facts.js';

export async function discover(tabId, topUrl) {
  const topOrigin = new URL(topUrl).origin;

  // Chrome refuses to inject into the extension's own pages, so the bundled demo runs the
  // same probe itself and answers over a port. Same function, same registry, same views —
  // only the transport differs (D-049).
  const results = isDemoTabId(tabId)
    ? await demoProbe(tabId)
    : await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      injectImmediately: true,
      func: probeMainWorld,
      args: [null, CALLBACK_PATTERN_DATA],
    });

  if (!results) return { error: 'The demo page stopped answering. Reload it.' };

  // Frames whose origin was not granted are simply absent from results — never guessed at.
  const frames = results
    .filter((r) => r && r.result)
    .map((r) => ({
      frameId: r.frameId,
      documentId: r.documentId,
      injected: true,
      isTopLevel: r.result.isTopLevel,
      frameUrl: r.result.href,
      frameIndexPath: Array.isArray(r.result.frameIndexPath) ? r.result.frameIndexPath : [],
      origin: r.result.origin,
      tools: [...(r.result.tools ?? []), ...(r.result.declarativeForms ?? [])
        .filter(form => !(r.result.tools ?? []).some(t => t.name === form.name && t.ownFrame))
        .map(form => {
          const inferred = declarativeSchema(form.fields);
          return { name: form.name, description: form.description, inputSchema: inferred.schema,
            schemaSource: inferred.source, schemaComplete: inferred.complete, schemaWarnings: inferred.warnings,
            inventoryOnly: true, ownFrame: true, runtimeId: 'declarative-html', inventoryId: form.index,
            registrationSource: 'declarative-html', annotations: {}, origin: r.result.origin };
        })],
      declarativeToolNames: r.result.declarativeToolNames,
      formFacts: formFactsOf(r.result.declarativeForms),
      plainForms: Array.isArray(r.result.plainForms) ? r.result.plainForms : [],
      declarativeAutoSubmitNames: r.result.declarativeAutoSubmitNames,
      // Whether Instrumentation Mode was in place in this frame. The list above is explicit on
      // purpose, which also means a new probe field is invisible until it is added here.
      instrumented: r.result.instrumented,
      registrations: r.result.registrations ?? null,
      childFrames: r.result.childFrames,
      error: r.result.error,
      accessError: r.result.accessError ?? null,
      callError: r.result.callError ?? null,
      env: diagnoseEnvironment(r.result),
    }));

  const top = frames.find((f) => f.isTopLevel) ?? frames[0] ?? null;
  const registry = await buildRegistry({ topOrigin, frames });

  const unreachableFrames = findUnreachableFrames({ frames });

  // Overrides are applied on Explorer's side of the boundary: the page is never modified.
  // Every affected tool carries overridden:true so the UI can never hide the fact (rule 6).
  const overrides = await listOverrides();
  registry.tools = applyOverrides(registry.tools, overrides);
  // Two fingerprints per tool: what the page declares (contractFp) and what Explorer offers a
  // model after overrides (offeredFp). An eval result records the second, so it can later say
  // that a case was judged against a contract that has since moved (L-16 lifted).
  registry.tools = await Promise.all(registry.tools.map(async (tool) => ({
    ...tool,
    offeredFp: tool.overridden
      ? await contractFingerprint({
        inputSchema: tool.inputSchema, annotations: tool.annotations, description: tool.description,
      })
      : tool.contractFp,
  })));

  // Registrations Instrumentation Mode saw that getTools() does not expose (L-21 lifted).
  const registrations = diagnoseRegistrations({ frames, tools: registry.tools });

  return {
    topOrigin,
    // The full address, not just the origin: the permission helpers and Source Finder work on
    // a URL, and re-deriving one from an origin would lose the path.
    url: topUrl,
    env: top?.env ?? diagnoseEnvironment({}),
    frames: frames.map(({ childFrames, registrations: seen, formFacts, plainForms, ...rest }) => rest),
    // Forms of the top document, for starter contracts when no tool is exposed (engine v3).
    plainForms: top?.plainForms ?? [],
    registrations,
    unreachableFrames,
    ...registry,
    // Overrides the registry's own view: it only knows about tools it saw, not about frames
    // it never entered (D-023).
    completeness: computeCompleteness({
      registryCompleteness: registry.completeness,
      unreachableFrames,
      refusedFrames: frames.filter((frame) => frame.callError),
    }),
  };
}
