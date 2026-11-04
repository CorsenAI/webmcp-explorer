// Who put each tool on the page, and from where. A tool registered by a script served from
// another origin (a CDN, an edge bridge, a plugin) is the surface mid-session tool injection
// uses (arXiv 2606.06387); a frame given allow="tools" is a delegation the embedder made.
// Provenance needs Instrumentation Mode: without it this axis says it could not look, never
// that nothing is there. Pure JavaScript.

import { finding } from './catalog.js';

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function reviewSurface(tool, discovery) {
  const out = [];
  const source = tool.source ?? null;
  if (source?.known && source.file) {
    const scriptOrigin = originOf(source.file);
    if (scriptOrigin && scriptOrigin !== tool.origin) {
      out.push(finding('third-party-registration', { tool,
        evidence: { field: 'source', path: 'registration', excerpt: `${source.file}:${source.line}`, scriptOrigin },
        detail: { file: source.file, line: source.line ?? null, scriptOrigin, toolOrigin: tool.origin, registrations: source.registrations ?? 1 } }));
    }
  }
  if (tool.origin === 'null') {
    out.push(finding('opaque-origin-tool', { tool,
      evidence: { field: 'origin', path: 'origin', excerpt: 'null' },
      detail: { frameId: tool.frameId ?? null } }));
  }
  if (discovery?.topOrigin && tool.origin && tool.origin !== discovery.topOrigin && tool.origin !== 'null') {
    out.push(finding('cross-origin-frame-tools', { tool,
      evidence: { field: 'origin', path: 'origin', excerpt: tool.origin },
      detail: { toolOrigin: tool.origin, topOrigin: discovery.topOrigin, reachable: !tool.notInjected } }));
  }
  return out;
}

// Page-level facts: delegations the embedder wrote, and what could not be observed.
export function reviewSurfacePage(discovery) {
  const out = [];
  for (const frame of discovery?.unreachableFrames ?? []) {
    if (frame.allowsTools) {
      out.push(finding('delegated-tools-policy', {
        evidence: { field: 'iframe', path: 'allow', excerpt: `${frame.origin} (${frame.count} embed${frame.count === 1 ? '' : 's'}) allow="tools"` },
        detail: { origin: frame.origin, count: frame.count } }));
    }
  }
  return out;
}

export function surfaceCoverage(discovery) {
  const notObservable = [];
  const frames = discovery?.frames ?? [];
  if (!frames.some((f) => f.instrumented)) {
    notObservable.push({ code: 'registration-provenance', reason: 'instrumentation-off' });
  }
  const ungranted = discovery?.completeness?.ungrantedOrigins ?? [];
  if (ungranted.length) notObservable.push({ code: 'ungranted-origins', reason: 'origins-not-granted', detail: ungranted });
  const refused = discovery?.completeness?.refusedFrames ?? [];
  if (refused.length) notObservable.push({ code: 'refused-frames', reason: 'browser-refused', detail: refused.map((f) => f.origin) });
  return notObservable;
}
