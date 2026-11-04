// Works out which child frames Explorer could see referenced but could not enter.
// Pure JavaScript: no chrome.* API.
//
// This is what makes the "Discovery partial — N origins not granted" claim honest. Explorer
// must never look complete when permissions prevented complete discovery (D-015).
//
// Reading child <iframe> elements from the top document also yields their `allow` attribute,
// which webNavigation could not have told us: it is how Explorer can say "this iframe has no
// allow=\"tools\"" rather than merely "nothing found here".

export function findUnreachableFrames({ frames = [] }) {
  const injectedOrigins = new Set(frames.filter((f) => f.injected).map((f) => f.origin));
  const seen = new Map();

  for (const frame of frames) {
    for (const child of frame.childFrames ?? []) {
      if (!child.src) continue;

      let origin;
      try {
        origin = new URL(child.src, frame.frameUrl).origin;
      } catch {
        continue;
      }

      if (origin === 'null' || injectedOrigins.has(origin)) continue;

      const previous = seen.get(origin);
      if (previous) {
        // One embed with allow="tools" is enough to say the embedder delegated the policy.
        previous.allowsTools = previous.allowsTools || child.allowsTools;
        previous.count += 1;
        continue;
      }
      seen.set(origin, { origin, allowsTools: Boolean(child.allowsTools), count: 1 });
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.origin.localeCompare(b.origin));
}

// The single source of truth for "did we see everything?".
//
// Two independent reasons discovery can be incomplete, and both must count:
//   - a tool was reported from an origin Explorer could not enter (registry.completeness);
//   - a child frame was referenced but never injected, so its tools were never even seen.
// The second one is the dangerous case: nothing is missing from the tool list, so a naive
// check reports success while whole frames went uninspected (observed live, D-023).
//   - a frame was entered but the browser refused its getTools() call, so its tools were never
//     listed either (Chrome 153 and 155 on a document that is not origin-keyed, WMP-0051).
export function computeCompleteness({ registryCompleteness, unreachableFrames = [], refusedFrames = [] }) {
  const origins = new Set(registryCompleteness?.ungrantedOrigins ?? []);
  for (const frame of unreachableFrames) origins.add(frame.origin);
  const refused = refusedFrames
    .filter((frame) => frame && frame.callError)
    .map((frame) => ({
      frameId: frame.frameId ?? null,
      origin: frame.origin ?? null,
      isTopLevel: Boolean(frame.isTopLevel),
      name: String(frame.callError.name ?? 'Error'),
      message: String(frame.callError.message ?? ''),
    }));

  return {
    complete: origins.size === 0 && refused.length === 0,
    ungrantedOrigins: Array.from(origins).sort(),
    refusedFrames: refused,
  };
}
