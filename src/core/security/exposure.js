// WMCP-SEC-011: tools a page exposes to other origins with registerTool's exposedTo option
// (spec 2026-11-02). Chrome rejects the whole registration when an entry is not a potentially
// trustworthy origin (WMP-0059), so an accepted tool only lists secure origins; what remains to
// review is who may discover and call it. getTools() never reports exposedTo: the value comes from
// the registration call (scanner capture, Explorer instrumentation). Pure JavaScript.

import { finding } from './catalog.js';

export const MAX_EXPOSED_ORIGINS = 20;

export function exposedOrigins(tool) {
  const list = Array.isArray(tool?.exposedTo) ? tool.exposedTo.slice(0, 100) : [];
  const own = tool?.origin ?? null;
  const out = [];
  for (const entry of list) {
    let origin;
    try { origin = new URL(String(entry)).origin; } catch { continue; }
    if (origin === 'null' || origin === own || out.includes(origin)) continue;
    out.push(origin);
  }
  return out;
}

export function reviewExposure(tool) {
  const origins = exposedOrigins(tool);
  if (!origins.length) return [];
  const a = tool.annotations && typeof tool.annotations === 'object' ? tool.annotations : {};
  // Chrome: read-only tools only to origins you would share the data with; read-write tools only to
  // origins trusted to act for the user. Anything not declared read-only is treated as read-write.
  const readOnly = a.readOnlyHint === true && a.consequentialHint !== true;
  const shown = origins.slice(0, MAX_EXPOSED_ORIGINS);
  return [finding('exposed-to-cross-origin', { tool, severity: readOnly ? 'info' : 'medium',
    evidence: { field: 'registration', path: 'options.exposedTo', excerpt: `${shown.join(', ')}${origins.length > shown.length ? ` (+${origins.length - shown.length})` : ''}` },
    detail: { origins: shown, count: origins.length, readOnly, consequential: a.consequentialHint === true } })];
}
