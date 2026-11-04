// The tool set moving under the agent. A tool removed and registered again in one session may
// be the same tool (a framework re-mounting) or a swapped contract (arXiv 2606.06387: abort
// hijack, registration race); Explorer says what it saw and points at snapshots for the
// contract comparison. Needs the live timeline; without it this axis says so. Pure JavaScript.

import { finding } from './catalog.js';

export function reviewLifecycle(tools, events = []) {
  const out = [];
  const byName = new Map();
  for (const event of [...events].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))) {
    if (!event?.toolName) continue;
    if (!byName.has(event.toolName)) byName.set(event.toolName, { registered: 0, unregistered: 0, unregisteredThenRegistered: false, sawUnregister: false });
    const s = byName.get(event.toolName);
    if (event.kind === 'registered') {
      s.registered += 1;
      if (s.sawUnregister) s.unregisteredThenRegistered = true;
    } else if (event.kind === 'unregistered') {
      s.unregistered += 1;
      s.sawUnregister = true;
    }
  }
  for (const tool of tools) {
    const s = byName.get(tool.name);
    if (s?.unregisteredThenRegistered) {
      out.push(finding('re-registered-in-session', { tool,
        evidence: { field: 'timeline', path: tool.name, excerpt: `${s.unregistered} removal${s.unregistered === 1 ? '' : 's'}, ${s.registered} registration${s.registered === 1 ? '' : 's'} in this session` },
        detail: { registered: s.registered, unregistered: s.unregistered } }));
    }
    const registrations = tool.source?.registrations ?? 1;
    if (tool.source?.known && registrations > 1) {
      out.push(finding('registered-more-than-once', { tool,
        evidence: { field: 'source', path: 'registration', excerpt: `${registrations} registerTool() calls for this name, first from ${tool.source.file}:${tool.source.line}` },
        detail: { registrations, file: tool.source.file, line: tool.source.line ?? null } }));
    }
  }
  return out;
}

export function lifecycleCoverage(events) {
  return Array.isArray(events) && events.length ? [] : [{ code: 'lifecycle', reason: 'timeline-empty' }];
}
