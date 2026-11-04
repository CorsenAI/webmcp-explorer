// The catalogue of security and governance findings: what each code means, how severe it is,
// whether it is an observed fact or an indicator, which axis it belongs to and which published
// source it rests on. Pure data; the wording lives in _locales (sec_<code>_title/why/fix).
//
// Severity describes potential impact; nature distinguishes observation from inference.
// D-136 adds a separate, provisional heuristic score without changing that distinction.

export const SEVERITY = ['critical', 'high', 'medium', 'low', 'info'];
export const SEVERITY_RANK = Object.fromEntries(SEVERITY.map((level, index) => [level, index]));

export const NATURE = { observed: 'observed', indicator: 'indicator' };

export const AXIS = {
  injection: 'injection',
  governance: 'governance',
  privacy: 'privacy',
  surface: 'surface',
  lifecycle: 'lifecycle',
  environment: 'environment',
};

// Published sources a finding can cite. Labels are English, as the rest of the product.
export const REFS = {
  'json-schema-object': { label: 'JSON Schema — object boundaries and composition', url: 'https://json-schema.org/understanding-json-schema/reference/object' },
  'mdn-cors-credentials': { label: 'MDN — credentialed CORS and wildcard origins', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSNotSupportingCredentials' },
  'mdn-csp-report-only': { label: 'MDN — test Content Security Policy in Report-Only mode', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy-Report-Only' },
  'spec-6.3.1.1': { label: 'WebMCP spec §6.3.1.1 — metadata and description attacks (tool poisoning)', url: 'https://webmachinelearning.github.io/webmcp/#security-privacy' },
  'spec-6.3.1.2': { label: 'WebMCP spec §6.3.1.2 — output injection', url: 'https://webmachinelearning.github.io/webmcp/#security-privacy' },
  'spec-6.3.1.3': { label: 'WebMCP spec §6.3.1.3 — tool implementations as attack targets', url: 'https://webmachinelearning.github.io/webmcp/#tool-implementation-targets' },
  'spec-6.3.2': { label: 'WebMCP spec §6.3.2 — misrepresentation of intent', url: 'https://webmachinelearning.github.io/webmcp/#security-privacy' },
  'spec-6.3.3': { label: 'WebMCP spec §6.3.3 — privacy leakage through over-parameterization', url: 'https://webmachinelearning.github.io/webmcp/#privacy-leakage-over-parameterization' },
  'spec-6.4.1': { label: 'WebMCP spec §6.4.1 — disabling WebMCP with Permissions Policy', url: 'https://webmachinelearning.github.io/webmcp/#security-privacy' },
  'spec-6.4.2': { label: 'WebMCP spec §6.4.2 — restricting input lengths', url: 'https://webmachinelearning.github.io/webmcp/#security-privacy' },
  'spec-6.4.4': { label: 'WebMCP spec §6.4.4 — untrusted annotation for tool responses', url: 'https://webmachinelearning.github.io/webmcp/#security-privacy' },
  'spec-6.4.5': { label: 'WebMCP spec §6.4.5 — consequential annotation for tool executions', url: 'https://webmachinelearning.github.io/webmcp/#security-privacy' },
  'spec-debugging': { label: 'WebMCP spec — ToolAnnotations.debugging (#253)', url: 'https://github.com/webmachinelearning/webmcp/pull/253' },
  'spec-issue-331': { label: 'WebMCP issue #331 — consequentialHint for high-risk read tools (open)', url: 'https://github.com/webmachinelearning/webmcp/issues/331' },
  'spec-issue-316': { label: 'WebMCP issue #316 — sensitive form fields (credentials, card data, national IDs)', url: 'https://github.com/webmachinelearning/webmcp/issues/316' },
  'spec-issue-92': { label: 'WebMCP issue #92 — re-registration race on the validation layer', url: 'https://github.com/webmachinelearning/webmcp/issues/92' },
  'spec-issue-328': { label: 'WebMCP issue #328 — signaling tool stability to agents', url: 'https://github.com/webmachinelearning/webmcp/issues/328' },
  'chrome-secure-tools': { label: 'Chrome — WebMCP tool security (character budgets, exposeTo, hints), 2026-09-01', url: 'https://developer.chrome.com/docs/ai/webmcp/secure-tools' },
  'chrome-agent-security': { label: 'Chrome — agent security considerations for WebMCP, 2026-06-09', url: 'https://developer.chrome.com/docs/agents/security' },
  'chrome-best-practices': { label: 'Chrome — WebMCP best practices, 2026-05-18', url: 'https://developer.chrome.com/docs/ai/webmcp/best-practices' },
  'owasp-mcp03': { label: 'OWASP MCP Top 10 — MCP03 Tool Poisoning', url: 'https://owasp.org/projects/mcp-top-10' },
  'owasp-mcp06': { label: 'OWASP MCP Top 10 — MCP06 Prompt Injection via Contextual Payloads', url: 'https://owasp.org/projects/mcp-top-10' },
  'owasp-mcp01': { label: 'OWASP MCP Top 10 — MCP01 Token Mismanagement & Secret Exposure', url: 'https://owasp.org/projects/mcp-top-10' },
  'owasp-mcp10': { label: 'OWASP MCP Top 10 — MCP10 Context Injection & Over-Sharing', url: 'https://owasp.org/projects/mcp-top-10' },
  'owasp-mcp04': { label: 'OWASP MCP Top 10 — MCP04 Software Supply Chain Attacks', url: 'https://owasp.org/projects/mcp-top-10' },
  'owasp-mcp08': { label: 'OWASP MCP Top 10 — MCP08 Lack of Audit and Telemetry', url: 'https://owasp.org/projects/mcp-top-10' },
  'arxiv-msti': { label: 'arXiv 2606.06387 — WebMCP tool surface poisoning (mid-session tool injection), 2026-06', url: 'https://arxiv.org/abs/2606.06387' },
  'lighthouse-agentic': { label: 'Lighthouse — Agentic browsing audits (llms.txt, registered WebMCP tools), 2026-05-05', url: 'https://developer.chrome.com/docs/lighthouse/agentic-browsing/scoring' },
  'unicode-tr36': { label: 'Unicode TR36 — security considerations (invisible and bidi characters, mixed scripts)', url: 'https://www.unicode.org/reports/tr36/' },
};

const entry = (axis, severity, nature, refs) => ({ axis, severity, nature, refs });

export const CATALOG = {
  // Injection surface: what an agent reads before it decides.
  'text-agent-directive': entry(AXIS.injection, 'high', NATURE.indicator, ['spec-6.3.1.1', 'owasp-mcp03', 'arxiv-msti']),
  'text-hidden-characters': entry(AXIS.injection, 'high', NATURE.observed, ['spec-6.3.1.1', 'unicode-tr36', 'owasp-mcp03']),
  'text-mixed-scripts': entry(AXIS.injection, 'medium', NATURE.indicator, ['unicode-tr36', 'spec-6.3.1.1']),
  'text-encoded-blob': entry(AXIS.injection, 'medium', NATURE.indicator, ['spec-6.3.1.1', 'owasp-mcp03']),
  'text-markup': entry(AXIS.injection, 'low', NATURE.indicator, ['spec-6.3.1.1', 'owasp-mcp06']),
  'text-embedded-address': entry(AXIS.injection, 'low', NATURE.indicator, ['spec-6.3.1.1', 'chrome-agent-security']),
  'text-over-budget': entry(AXIS.injection, 'low', NATURE.observed, ['chrome-secure-tools', 'spec-6.4.2']),
  // Governance: what the page tells agents about side effects, and whether it holds up.
  'consequential-without-hint': entry(AXIS.governance, 'high', NATURE.indicator, ['spec-6.4.5', 'spec-6.3.2', 'chrome-secure-tools']),
  'state-change-without-hint': entry(AXIS.governance, 'medium', NATURE.indicator, ['spec-6.4.5', 'chrome-agent-security']),
  'readonly-claim-on-mutating-verb': entry(AXIS.governance, 'medium', NATURE.indicator, ['spec-6.3.2', 'arxiv-msti', 'chrome-agent-security']),
  'ugc-without-untrusted-hint': entry(AXIS.governance, 'medium', NATURE.indicator, ['spec-6.4.4', 'spec-6.3.1.2', 'chrome-secure-tools']),
  'debugging-tool-exposed': entry(AXIS.governance, 'medium', NATURE.observed, ['spec-debugging']),
  'high-risk-read-without-hint': entry(AXIS.governance, 'low', NATURE.indicator, ['spec-issue-331', 'chrome-secure-tools']),
  // Privacy: what the schema invites an agent to supply.
  'sensitive-parameter': entry(AXIS.privacy, 'medium', NATURE.indicator, ['spec-6.3.3', 'spec-issue-316', 'owasp-mcp01']),
  'unbounded-string': entry(AXIS.privacy, 'info', NATURE.observed, ['spec-6.4.2', 'chrome-best-practices']),
  // Surface: who registered what, and from where.
  'third-party-registration': entry(AXIS.surface, 'medium', NATURE.observed, ['arxiv-msti', 'owasp-mcp04']),
  'cross-origin-frame-tools': entry(AXIS.surface, 'info', NATURE.observed, ['chrome-secure-tools']),
  'delegated-tools-policy': entry(AXIS.surface, 'info', NATURE.observed, ['spec-6.4.1', 'chrome-secure-tools']),
  'opaque-origin-tool': entry(AXIS.surface, 'info', NATURE.observed, ['spec-6.3.2']),
  // Lifecycle: the tool set moving under the agent.
  're-registered-in-session': entry(AXIS.lifecycle, 'medium', NATURE.indicator, ['arxiv-msti', 'spec-issue-92']),
  'registered-more-than-once': entry(AXIS.lifecycle, 'medium', NATURE.observed, ['arxiv-msti', 'spec-issue-92', 'spec-issue-328']),
  // Active probes (S2): what the tool's own code does with inputs the schema forbids, and what
  // comes back. Observed on the person's own site, with their explicit confirmation.
  'accepts-out-of-schema-input': entry(AXIS.injection, 'medium', NATURE.observed, ['spec-6.3.1.3', 'chrome-best-practices', 'spec-6.4.2']),
  'accepts-missing-required': entry(AXIS.injection, 'medium', NATURE.observed, ['spec-6.3.1.3', 'chrome-best-practices']),
  'accepts-unknown-property': entry(AXIS.injection, 'info', NATURE.observed, ['chrome-best-practices']),
  'accepts-unbounded-input': entry(AXIS.injection, 'low', NATURE.observed, ['spec-6.4.2', 'chrome-secure-tools']),
  'output-over-budget': entry(AXIS.injection, 'low', NATURE.observed, ['chrome-secure-tools', 'chrome-agent-security']),
  'output-directive': entry(AXIS.injection, 'high', NATURE.indicator, ['spec-6.3.1.2', 'owasp-mcp06', 'chrome-agent-security']),
  'output-markup': entry(AXIS.injection, 'low', NATURE.indicator, ['spec-6.3.1.2', 'chrome-agent-security']),
  'output-personal-data': entry(AXIS.privacy, 'medium', NATURE.indicator, ['spec-6.3.3', 'owasp-mcp10', 'chrome-agent-security']),
  'probe-call-failed': entry(AXIS.environment, 'info', NATURE.observed, ['chrome-best-practices']),
  // Discovery conventions (S4): files and headers some tools look for. None is in the W3C CG
  // draft; each is labelled with who uses it. Observed by an opt-in fetch, never by default.
  'convention-manifest-present': entry(AXIS.environment, 'info', NATURE.observed, ['lighthouse-agentic', 'chrome-best-practices']),
  'convention-manifest-invalid': entry(AXIS.environment, 'low', NATURE.observed, ['lighthouse-agentic']),
  'convention-llms-txt-present': entry(AXIS.environment, 'info', NATURE.observed, ['lighthouse-agentic']),
  'convention-permissions-policy': entry(AXIS.environment, 'info', NATURE.observed, ['spec-6.4.1']),
  'convention-permissions-policy-absent': entry(AXIS.environment, 'info', NATURE.observed, ['spec-6.4.1']),
  // Phase B: stable rule groups WMCP-SEC-001..007 are assigned by rules.js.
  'text-active-payload': entry(AXIS.injection, 'critical', NATURE.indicator, ['spec-6.3.1.1', 'chrome-secure-tools']),
  'mutation-hints-incomplete': entry(AXIS.governance, 'high', NATURE.indicator, ['chrome-secure-tools', 'chrome-agent-security']),
  'permissive-object': entry(AXIS.privacy, 'high', NATURE.observed, ['json-schema-object', 'spec-6.3.1.3', 'chrome-best-practices']),
  'mutating-auto-submit': entry(AXIS.governance, 'high', NATURE.indicator, ['chrome-agent-security', 'chrome-best-practices']),
  'legacy-registration': entry(AXIS.environment, 'medium', NATURE.observed, ['chrome-secure-tools']),
  'token-estimate-over-budget': entry(AXIS.injection, 'low', NATURE.indicator, ['chrome-secure-tools']),
  'ambiguous-description': entry(AXIS.governance, 'low', NATURE.indicator, ['chrome-best-practices']),
  'convention-csp': entry(AXIS.environment, 'info', NATURE.observed, ['mdn-csp-report-only', 'chrome-secure-tools']),
  'convention-cors': entry(AXIS.environment, 'info', NATURE.observed, ['mdn-cors-credentials', 'chrome-best-practices']),
  'convention-unavailable': entry(AXIS.environment, 'info', NATURE.observed, ['chrome-best-practices']),
  // Environment: the page's own policy.
  'no-tools-policy-open': entry(AXIS.environment, 'info', NATURE.observed, ['spec-6.4.1']),
  'legacy-host': entry(AXIS.environment, 'info', NATURE.observed, ['chrome-secure-tools']),
};

export const CODES = Object.keys(CATALOG);

// The locale key family of a code: text-agent-directive → sec_text_agent_directive_title.
export function localeKey(code, part) {
  return `sec_${code.replace(/-/g, '_')}_${part}`;
}

// Builds a finding from its code and the facts that justify it. The catalogue supplies
// everything a reader needs to judge the claim; `evidence` is the exact excerpt; `detail` is
// structured data for the export and the wording.
export function finding(code, { tool = null, evidence = null, detail = null, severity = null } = {}) {
  const def = CATALOG[code];
  if (!def) throw new Error(`unknown finding code: ${code}`);
  return {
    code,
    axis: def.axis,
    severity: severity ?? def.severity,
    nature: def.nature,
    refs: def.refs.map((id) => ({ id, ...REFS[id] })),
    instanceId: tool?.instanceId ?? null,
    logicalId: tool?.logicalId ?? null,
    toolName: tool?.name ?? null,
    frameId: tool?.frameId ?? null,
    origin: tool?.origin ?? null,
    contractFp: tool?.contractFp ?? null,
    evidence,
    detail,
  };
}
