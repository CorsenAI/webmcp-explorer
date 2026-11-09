// Pure helpers for discovery (engine v3): the data the page probe receives and the declarative
// form facts WMCP-SEC-008 reads. No chrome.* API.
import { CALLBACK_PATTERNS, TRACE_PATTERN } from './security/callback-source.js';

// Plain data for the page: the engine's callback-source patterns (WMCP-SEC-009, engine v3).
export const CALLBACK_PATTERN_DATA = [...CALLBACK_PATTERNS, TRACE_PATTERN].map(({ label, source, flags }) => ({ label, source, flags }));

// The facts WMCP-SEC-008 reads for a declarative form: control names, types and markers, never values.
export function formFactsOf(forms = []) {
  return Object.fromEntries((Array.isArray(forms) ? forms : []).filter((form) => form?.name).map((form) => [form.name, {
    method: form.method ?? null,
    controls: (form.fields ?? []).slice(0, 100).map((x) => ({ name: x.name || null, type: x.tag === 'input' ? String(x.type ?? 'text').toLowerCase() : x.tag,
      autocomplete: x.autocomplete ?? null, disabled: x.disabled === true, hasParamDescription: x.hasParamDescription === true,
      paramDescription: x.hasParamDescription ? String(x.description ?? '').slice(0, 160) : null })),
  }]));
}
