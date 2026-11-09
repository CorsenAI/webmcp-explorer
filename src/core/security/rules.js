// Explorer's mappings, not OWASP endorsement or certification. Preserve historical codes for
// baselines/marks; stable WMCP IDs group related evidence without double-counting its paths.
// Families 001–007 keep their codes unchanged (engine v3, 2026-11-08); 008–013 add new codes and
// codes that had no family. `description`, `help` and `precision` feed the SARIF rule metadata.
export const AGENTIC_SOURCE = 'https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/';
const rule = (severity, title, owasp, codes, precision, description, help) => ({ severity, title, owasp, codes, precision, description, help });
export const RULES = {
  'WMCP-SEC-001': rule('critical', 'Tool description injection', ['ASI01', 'ASI02'],
    ['text-agent-directive', 'text-hidden-characters', 'text-mixed-scripts', 'text-encoded-blob', 'text-markup', 'text-embedded-address', 'text-active-payload'], 'medium',
    'Model-facing tool text contains instructions addressed to the agent, invisible or direction-changing characters, look-alike scripts, encoded blobs, markup or addresses.',
    'Describe only the action, its inputs and its result. Remove agent-directed instructions and invisible characters; keep links and markup out of model-facing text.'),
  'WMCP-SEC-002': rule('high', 'Mutating tool annotations', ['ASI02', 'ASI09'],
    ['consequential-without-hint', 'state-change-without-hint', 'readonly-claim-on-mutating-verb', 'mutation-hints-incomplete'], 'medium',
    'A tool whose name or description indicates a state change does not declare readOnlyHint and consequentialHint consistently.',
    'Declare readOnlyHint: false and consequentialHint: true for consequential actions. Never declare readOnlyHint on a tool that changes state.'),
  'WMCP-SEC-003': rule('high', 'Input schema constraints', ['ASI02', 'ASI05'], ['unbounded-string', 'permissive-object'], 'high',
    'String parameters have no maxLength, enum, pattern or format, or object schemas accept properties that were not declared.',
    'Bound strings, close objects with additionalProperties: false, and validate inputs again in the tool implementation.'),
  'WMCP-SEC-004': rule('high', 'Authentication and confirmation boundary', ['ASI03', 'ASI09'], ['mutating-auto-submit'], 'medium',
    'A declarative form whose action changes state is submitted automatically (toolautosubmit) when an agent invokes it.',
    'Remove toolautosubmit from forms that change state. Keep human confirmation and server-side authorization bound to the exact request.'),
  'WMCP-SEC-005': rule('medium', 'Legacy WebMCP registration', ['ASI04'], ['legacy-host', 'legacy-registration'], 'high',
    'The tool is registered on the legacy navigator.modelContext or provideContext surface.',
    'Register tools with document.modelContext.registerTool() and remove them by aborting their AbortSignal.'),
  'WMCP-SEC-006': rule('medium', 'Origin discovery and headers', ['ASI04'],
    ['convention-manifest-present', 'convention-manifest-invalid', 'convention-llms-txt-present', 'convention-permissions-policy', 'convention-permissions-policy-absent', 'convention-csp', 'convention-cors', 'convention-unavailable'], 'high',
    'Response headers and optional discovery conventions observed for the origin.',
    'Review Permissions-Policy tools, Content-Security-Policy and CORS for this origin. Discovery files are optional conventions, not requirements.'),
  'WMCP-SEC-007': rule('low', 'Description budget and ambiguity', ['ASI02'], ['text-over-budget', 'token-estimate-over-budget', 'ambiguous-description'], 'high',
    'Model-facing text exceeds Chrome character budgets or the estimated token budget, or overlaps another tool description.',
    'Keep names within 30, descriptions within 500 and parameter descriptions within 150 characters; make each tool purpose distinct.'),
  'WMCP-SEC-008': rule('high', 'Declarative form contract integrity', ['ASI02', 'ASI03', 'ASI09'],
    ['declarative-hidden-parameter', 'declarative-credential-field', 'declarative-param-orphan', 'declarative-post-auto-submit'], 'medium',
    'A declarative tool form submits hidden business values the agent cannot see, asks the agent for credential or card fields, describes parameters that never reach the schema, or auto-submits a POST form.',
    'Keep business values on the server, leave credential and payment fields out of agent forms, name every described control, and remove toolautosubmit from forms that change state.'),
  'WMCP-SEC-009': rule('high', 'Read-only contract contradicted by callback source', ['ASI02', 'ASI09'], ['readonly-callback-mutation'], 'medium',
    'A tool declared readOnlyHint: true contains request or form-submission code using a method that is not safe in its callback source text.',
    'Declare the tool as state-changing (readOnlyHint: false, and consequentialHint: true for consequential actions) or move the write out of the tool. The indicator does not prove behavior: review the callback.'),
  'WMCP-SEC-010': rule('medium', 'Untrusted content labelling', ['ASI01', 'ASI06'], ['ugc-without-untrusted-hint', 'output-reflects-input'], 'medium',
    'A tool that returns content written by other people or fetched elsewhere does not declare untrustedContentHint, or echoes caller input into its output.',
    'Set untrustedContentHint: true on tools that return user-generated or third-party content, and do not echo caller input into model-facing output.'),
  'WMCP-SEC-011': rule('medium', 'Cross-origin exposure and frame surface', ['ASI03', 'ASI04'],
    ['exposed-to-cross-origin', 'third-party-registration', 'cross-origin-frame-tools', 'delegated-tools-policy', 'opaque-origin-tool'], 'high',
    'The tool is exposed to other origins through exposedTo, was registered by a script or frame from another origin, or the page delegates the tools feature to embedded frames.',
    'Expose tools only to origins trusted to act for the user and keep state-changing tools same-origin. Review third-party scripts and allow="tools" delegations.'),
  'WMCP-SEC-012': rule('medium', 'Oversized model-facing text', ['ASI01'], ['text-far-over-budget'], 'high',
    'A model-facing field is more than twice the Chrome character budget; invisible characters or encoded blobs inside it suggest concealment.',
    'Bring the field below its budget and remove invisible or encoded content: long text can hide instructions from human review.'),
  'WMCP-SEC-013': rule('critical', 'Client-side secret exposure', ['ASI03'], ['client-secret-exposed'], 'high',
    'A credential in a provider secret-key format appears in script text that the page sends to every visitor.',
    'Revoke and rotate the key with the provider, then move the call to your server. Only publishable keys belong in client code.'),
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
