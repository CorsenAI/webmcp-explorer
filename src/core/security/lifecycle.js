// The tool set moving under the agent. A tool removed and registered again in one session may
// be the same tool (a framework re-mounting) or a swapped contract (arXiv 2606.06387: abort
// hijack, registration race). Where the observer fingerprinted both contracts the review says
// which it was: another contract under the same name is a finding that names the parts that
// moved, and the same contract is no finding. Where it could not compare, the review says what it
// saw and points at snapshots. Needs lifecycle events (Explorer's live timeline, the scanner's
// page capture); without them this axis says so. Pure JavaScript.

import { finding } from './catalog.js';
import { CONTRACT_PARTS } from './contract-lock.js';

const PART_LABEL = { description: 'description', schema: 'input schema', annotations: 'annotations' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Events of one frame belong to that frame's tools; an observer that does not number frames
// (the scanner reads one document) leaves frameId out on both sides.
const keyOf = (name, frameId) => `${frameId ?? ''}\u0000${name}`;
// Two events of one name can carry the same millisecond: the timeline's own sequence decides.
const sequenceOf = (event) => Number(String(event?.id ?? '').replace(/^ev_/, '')) || 0;

// events: [{ kind, toolName, at?, frameId?, contract?, parts? }]
//   registered    a tool name appeared. After a removal of that name, `contract` is 'same' or
//                 'changed' when both contracts were fingerprinted, and `parts` lists what differs.
//   unregistered  a tool name disappeared.
//   changed       a listed tool's contract was replaced with no removal observed; `parts` differ.
export function reviewLifecycle(tools, events = []) {
  const out = [];
  const byKey = new Map();
  const ordered = [...events].sort((a, b) => (a?.at ?? 0) - (b?.at ?? 0) || sequenceOf(a) - sequenceOf(b));
  for (const event of ordered) {
    if (!event?.toolName) continue;
    const key = keyOf(event.toolName, event.frameId);
    if (!byKey.has(key)) byKey.set(key, { registered: 0, unregistered: 0, sawUnregister: false, uncompared: 0, changes: 0, parts: new Set() });
    const s = byKey.get(key);
    const parts = Array.isArray(event.parts) ? event.parts.filter((part) => CONTRACT_PARTS.includes(part)) : [];
    if (event.kind === 'registered') {
      s.registered += 1;
      if (event.contract === 'changed') {
        s.changes += 1;
        for (const part of parts) s.parts.add(part);
      } else if (s.sawUnregister && event.contract !== 'same') {
        s.uncompared += 1;
      }
    } else if (event.kind === 'unregistered') {
      s.unregistered += 1;
      s.sawUnregister = true;
    } else if (event.kind === 'changed') {
      s.changes += 1;
      for (const part of parts) s.parts.add(part);
    }
  }
  for (const tool of tools) {
    const s = byKey.get(keyOf(tool.name, tool.frameId)) ?? byKey.get(keyOf(tool.name, null));
    if (s?.changes) {
      const parts = CONTRACT_PARTS.filter((part) => s.parts.has(part));
      out.push(finding('contract-changed-in-session', { tool,
        evidence: { field: 'timeline', path: tool.name,
          excerpt: `${plural(s.changes, 'contract change')} under this name while it was observed${parts.length ? `: ${parts.map((part) => PART_LABEL[part]).join(', ')}` : ''}` },
        detail: { changes: s.changes, parts, registered: s.registered, unregistered: s.unregistered } }));
    } else if (s?.uncompared) {
      out.push(finding('re-registered-in-session', { tool,
        evidence: { field: 'timeline', path: tool.name, excerpt: `${plural(s.unregistered, 'removal')}, ${plural(s.registered, 'registration')} in this session` },
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
