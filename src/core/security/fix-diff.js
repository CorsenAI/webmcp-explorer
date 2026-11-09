// Before / after for a finding (engine v3): the contract as observed and the contract the proposed
// fix would register, as canonical JSON with sorted keys, and a bounded full-context line diff a
// developer can copy. Display data only: nothing is applied to the page. Pure JavaScript.

import { proposedContract } from './quick-fix.js';
import { hiddenBusinessNames, credentialControls } from './declarative-integrity.js';
import { escapeFormat } from './snippet-encode.js';

export const MAX_DIFF_LINES = 400;
const HINTS = ['readOnlyHint', 'consequentialHint', 'untrustedContentHint', 'debugging'];

function sorted(value, depth = 0) {
  if (depth > 64 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sorted(v, depth + 1));
  const out = {};
  for (const key of Object.keys(value).sort()) {
    Object.defineProperty(out, key, { value: sorted(value[key], depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return out;
}

// Pretty JSON with sorted keys; invisible and direction-changing characters shown as escapes.
export function canonicalJson(value) {
  return escapeFormat(JSON.stringify(sorted(value), null, 2));
}

const hintsOf = (tool) => Object.fromEntries(HINTS.filter((k) => typeof tool?.annotations?.[k] === 'boolean').map((k) => [k, tool.annotations[k]]));

export function observedContract(tool, kind) {
  if (kind === 'declarative') {
    const declaredSchema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object', properties: {} };
    return { name: String(tool.name ?? ''), description: String(tool.description ?? ''), toolautosubmit: tool.autoSubmit === true,
      method: tool.form?.method ?? null, hiddenBusinessFields: hiddenBusinessNames(tool),
      credentialFields: credentialControls(tool).map((c) => c.name), inputSchema: declaredSchema };
  }
  const out = { name: String(tool.name ?? ''), description: String(tool.description ?? ''),
    inputSchema: tool.inputSchema ?? { type: 'object', properties: {} }, annotations: hintsOf(tool) };
  if (Array.isArray(tool.exposedTo)) out.registrationOptions = { exposedTo: tool.exposedTo.slice(0, 20).map(String) };
  return out;
}

// Full-context diff of two texts: ' ' kept, '-' observed only, '+' proposed only.
export function unifiedDiff(before, after, { from = 'observed', to = 'proposed' } = {}) {
  const a = String(before).split('\n'), b = String(after).split('\n');
  const head = [`--- ${from}`, `+++ ${to}`];
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return [...head, ...a.slice(0, MAX_DIFF_LINES).map((l) => `-${l}`), ...b.slice(0, MAX_DIFF_LINES).map((l) => `+${l}`), '# diff truncated'].join('\n');
  }
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) {
    lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const lines = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { lines.push(` ${a[i]}`); i += 1; j += 1; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { lines.push(`-${a[i]}`); i += 1; }
    else { lines.push(`+${b[j]}`); j += 1; }
  }
  while (i < a.length) lines.push(`-${a[i++]}`);
  while (j < b.length) lines.push(`+${b[j++]}`);
  return [...head, ...lines].join('\n');
}

// { language, before, after, unified } for a finding on a tool, or null when the fix is advice
// only (headers, authorization boundary, secrets) or would change nothing.
export function fixDiff(f, tool) {
  const proposal = tool ? proposedContract(f, tool) : null;
  if (!proposal || proposal.failure) return null;
  const before = canonicalJson(observedContract(tool, proposal.kind));
  const proposed = proposal.kind === 'declarative' ? proposal.declarative : { ...proposal.descriptor };
  if (proposal.kind === 'imperative' && Array.isArray(tool.exposedTo)) {
    proposed.registrationOptions = { exposedTo: (f?.ruleId ?? f?.id) === 'WMCP-SEC-011' ? [] : tool.exposedTo.slice(0, 20).map(String) };
  }
  const after = canonicalJson(proposed);
  if (before === after) return null;
  return { language: 'json', before, after, unified: unifiedDiff(before, after) };
}
