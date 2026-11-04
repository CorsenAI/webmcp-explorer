// Explorer's mappings, not OWASP endorsement or certification. Preserve historical codes for
// baselines/marks; stable WMCP IDs group related evidence without double-counting its paths.
export const AGENTIC_SOURCE = 'https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/';
export const RULES = {
  'WMCP-SEC-001': { severity: 'critical', title: 'Tool description injection', owasp: ['ASI01', 'ASI02'], codes: ['text-agent-directive', 'text-hidden-characters', 'text-mixed-scripts', 'text-encoded-blob', 'text-markup', 'text-embedded-address', 'text-active-payload'] },
  'WMCP-SEC-002': { severity: 'high', title: 'Mutating tool annotations', owasp: ['ASI02', 'ASI09'], codes: ['consequential-without-hint', 'state-change-without-hint', 'readonly-claim-on-mutating-verb', 'mutation-hints-incomplete'] },
  'WMCP-SEC-003': { severity: 'high', title: 'Input schema constraints', owasp: ['ASI02', 'ASI05'], codes: ['unbounded-string', 'permissive-object'] },
  'WMCP-SEC-004': { severity: 'high', title: 'Authentication and confirmation boundary', owasp: ['ASI03', 'ASI09'], codes: ['mutating-auto-submit'] },
  'WMCP-SEC-005': { severity: 'medium', title: 'Legacy WebMCP registration', owasp: ['ASI04'], codes: ['legacy-host', 'legacy-registration'] },
  'WMCP-SEC-006': { severity: 'medium', title: 'Origin discovery and headers', owasp: ['ASI04'], codes: ['convention-manifest-present', 'convention-manifest-invalid', 'convention-llms-txt-present', 'convention-permissions-policy', 'convention-permissions-policy-absent', 'convention-csp', 'convention-cors', 'convention-unavailable'] },
  'WMCP-SEC-007': { severity: 'low', title: 'Description budget and ambiguity', owasp: ['ASI02'], codes: ['text-over-budget', 'token-estimate-over-budget', 'ambiguous-description'] },
};
const CODE_RULE = new Map(Object.entries(RULES).flatMap(([id, r]) => r.codes.map(c => [c, id])));
// Low-specificity markers (a URL, markup or a legitimate RTL character) retain their original
// severity. Critical is reserved for instructions or active payload indicators.
const UPGRADE = { 'text-agent-directive': 'critical', 'text-active-payload': 'critical',
  'state-change-without-hint': 'high', 'readonly-claim-on-mutating-verb': 'high',
  'unbounded-string': 'high', 'legacy-host': 'medium', 'convention-manifest-invalid': 'medium' };

export function withRule(f) {
  if (f.ruleId) return f;
  const ruleId = CODE_RULE.get(f.code);
  if (!ruleId) return f;
  return { ...f, id: ruleId, ruleId, ruleTitle: RULES[ruleId].title,
    severity: UPGRADE[f.code] ?? f.severity, owasp: RULES[ruleId].owasp,
    refs: [...f.refs, { id: 'owasp-agentic-2026', label: `OWASP Agentic 2026 · ${RULES[ruleId].owasp.join(', ')} (Explorer mapping)`, url: AGENTIC_SOURCE }] };
}
