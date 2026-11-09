// WMCP-SEC-009: what a tool callback's own source text says about requests and form submission.
// The text is read in the page with the intrinsic Function.prototype.toString, bounded to
// CALLBACK_SOURCE_LIMIT characters, by the scanner capture and by Explorer instrumentation; only
// the labels below leave the page, never the source. A label is a pattern in text, not behaviour:
// comments, indirection, bundling and native or bound functions can hide or fake it (L-34).
// The in-page copies of these patterns are checked against this list by tests. Pure JavaScript.

import { finding } from './catalog.js';

export const CALLBACK_SOURCE_LIMIT = 16384;

// `write`: a method that is not safe and is not the POST that read-only query APIs also use
// (RFC 9110 §9.2.1); a submit call is reported as a write by owner decision (2026-11-08).
export const CALLBACK_PATTERNS = Object.freeze([
  { label: 'request-method-write', write: true, source: String.raw`\bmethod\s*:\s*['"\x60](?:PUT|PATCH|DELETE)['"\x60]`, flags: 'i' },
  { label: 'request-method-post', write: false, source: String.raw`\bmethod\s*:\s*['"\x60]POST['"\x60]`, flags: 'i' },
  { label: 'axios-write', write: true, source: String.raw`\baxios\s*\.\s*(?:put|patch|delete)\s*\(`, flags: 'i' },
  { label: 'axios-post', write: false, source: String.raw`\baxios\s*\.\s*post\s*\(`, flags: 'i' },
  { label: 'xhr-open-write', write: true, source: String.raw`\.\s*open\s*\(\s*['"\x60](?:PUT|PATCH|DELETE)['"\x60]`, flags: 'i' },
  { label: 'xhr-open-post', write: false, source: String.raw`\.\s*open\s*\(\s*['"\x60]POST['"\x60]`, flags: 'i' },
  { label: 'submit-call', write: true, source: String.raw`\.\s*(?:submit|requestSubmit)\s*\(`, flags: '' },
  { label: 'send-beacon', write: false, source: String.raw`\bnavigator\s*\.\s*sendBeacon\s*\(`, flags: '' },
]);
// A request header the page itself names as agent-initiated (a vendor convention, not WebMCP).
export const TRACE_PATTERN = Object.freeze({ label: 'agent-header', source: String.raw`['"\x60]x-(?:agent|ai|webmcp|mcp)[\w-]*['"\x60]\s*[:,)]`, flags: 'i' });

const MUTATION = new Map(CALLBACK_PATTERNS.map((p) => [p.label, p.write]));
export const CALLBACK_LABELS = Object.freeze([...CALLBACK_PATTERNS.map((p) => p.label), TRACE_PATTERN.label]);

// Labels of one source text. Used by Explorer in the page world and by tests; the scanner's
// serialised capture script carries the same expressions.
export function callbackLabels(text) {
  const value = String(text ?? '').slice(0, CALLBACK_SOURCE_LIMIT);
  const labels = CALLBACK_PATTERNS.filter((p) => new RegExp(p.source, p.flags).test(value)).map((p) => p.label);
  if (new RegExp(TRACE_PATTERN.source, TRACE_PATTERN.flags).test(value)) labels.push(TRACE_PATTERN.label);
  return labels;
}

const mutationLabels = (tool) => (Array.isArray(tool?.callbackObservation?.labels) ? tool.callbackObservation.labels : [])
  .filter((label) => MUTATION.has(label));

export function reviewCallbackSource(tool) {
  if (tool?.annotations?.readOnlyHint !== true) return [];
  const labels = mutationLabels(tool);
  if (!labels.length) return [];
  const write = labels.some((label) => MUTATION.get(label));
  return [finding('readonly-callback-mutation', { tool, severity: write ? 'high' : 'medium',
    evidence: { field: 'callback', path: 'execute', excerpt: `readOnlyHint: true; callback source text: ${labels.join(', ')}` },
    detail: { labels, status: tool.callbackObservation.status ?? null, executed: false, method: 'bounded source-text patterns' } })];
}

// Declared read-only tools whose callback text could not be read in full: unknown, never clean.
export function callbackCoverage(tools = []) {
  const unread = tools.filter((t) => t?.annotations?.readOnlyHint === true && t.callbackObservation?.status !== 'source-text-inspected')
    .map((t) => `${t.name}: ${t.callbackObservation?.status ?? 'not-observed'}`);
  return unread.length ? [{ code: 'callback-source', reason: 'not-fully-observable', detail: unread.slice(0, 20) }] : [];
}
