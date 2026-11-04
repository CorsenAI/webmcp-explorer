// Classifies the WebMCP runtime of a document from observed capabilities only — never from
// a Chrome version or a calendar date. See docs/ARCHITECTURE.md section 4, D-009 and D-017.
//
// Chrome documents three distinct requirements, and Explorer must never collapse them into
// one generic "WebMCP unavailable":
//   1. secure context;
//   2. origin isolation — "WebMCP is only available in origin-isolated documents";
//      a document served with Origin-Agent-Cluster: ?0 has the API disabled;
//   3. the `tools` Permissions Policy, which defaults to `self` — enabled for top-level and
//      same-origin contexts, disabled for cross-origin iframes unless the embedder adds
//      allow="tools".
//
// Note: `devFlag` cannot be filled in by a page probe — no API reads chrome://flags — so in
// practice `testing-flag` is indistinguishable from `native`. See KNOWN_LIMITATIONS L-09.

export const REQUIRED_SURFACE = ['registerTool', 'getTools', 'executeTool', 'addEventListener'];

export const REASONS = [
  'insecure-context',
  'origin-not-isolated',
  'tools-policy-blocked',
  'api-call-rejected',
  'api-absent',
  'api-partial',
  'polyfill-active',
];

export function classifyEnvironment({
  apiHost = null,
  methods = [],
  polyfillActive = false,
  originTrialToken = false,
  devFlag = false,
} = {}) {
  const legacyHost = apiHost === 'navigator';
  const missing = REQUIRED_SURFACE.filter((m) => !methods.includes(m));

  if (!apiHost && !polyfillActive) return { state: 'unavailable', missing, legacyHost };
  if (polyfillActive) return { state: 'compat-polyfill', missing, legacyHost };
  if (missing.length > 0) return { state: 'api-mismatch', missing, legacyHost };
  if (originTrialToken) return { state: 'origin-trial', missing, legacyHost };
  if (devFlag) return { state: 'testing-flag', missing, legacyHost };
  return { state: 'native', missing, legacyHost };
}

function frameContextOf({ isTopLevel, parentOriginAccessible }) {
  if (isTopLevel) return 'top-level';
  return parentOriginAccessible ? 'same-origin-iframe' : 'cross-origin-iframe';
}

// The `tools` policy is only meaningful when the browser knows the feature at all. Reporting
// "blocked" for a feature Chrome has never heard of would be a lie.
function toolsPermissionOf({ knownPolicyFeatures, toolsPolicyAllowed }) {
  if (!Array.isArray(knownPolicyFeatures) || !knownPolicyFeatures.includes('tools')) {
    return 'unobservable';
  }
  return toolsPolicyAllowed ? 'allowed' : 'blocked';
}

export function diagnoseEnvironment(signals = {}) {
  const {
    secureContext = false,
    crossOriginIsolated = false,
    originAgentCluster = null,
    // The accessor itself threw (never observed, kept as a guard), or getTools() rejected: on
    // Chrome 153 and 155 a document that is not origin-keyed keeps the accessor but refuses
    // every call with a SecurityError naming document.domain (WMP-0051).
    accessError = null,
    callError = null,
  } = signals;
  const refusal = accessError
    ? { during: 'access', name: String(accessError.name ?? 'Error'), message: String(accessError.message ?? '') }
    : (callError
      ? { during: 'call', name: String(callError.name ?? 'Error'), message: String(callError.message ?? '') }
      : null);

  const capability = classifyEnvironment(signals);
  const frameContext = frameContextOf(signals);
  const toolsPermission = toolsPermissionOf(signals);

  // An API object whose calls are refused is present but not available: saying "available"
  // and then "no tools" would be the lie D-023 forbids.
  const apiAvailability = capability.state === 'unavailable' ? 'missing'
    : (capability.missing.length > 0 ? 'partial'
      : (refusal?.during === 'call' ? 'refused' : 'available'));

  const checks = {
    secureContext: secureContext ? 'ok' : 'failed',
    originIsolation: { crossOriginIsolated, originAgentCluster },
    apiAvailability,
    toolsPermission,
    frameContext,
    capability: capability.state,
  };

  // A working API is never contradicted by a suspicious signal: report, do not overrule.
  let reason = null;
  if (capability.state === 'compat-polyfill') {
    reason = 'polyfill-active';
  } else if (apiAvailability === 'partial') {
    reason = 'api-partial';
  } else if (apiAvailability === 'missing' || apiAvailability === 'refused') {
    // A refusal is attributed to origin isolation only when the browser's own sentence names
    // document.domain: a later build no longer requires an origin-keyed document (WMP-0051),
    // and a refusal there for another reason must not be blamed on the signal.
    const namesDomain = refusal ? /document\.domain/i.test(refusal.message) : true;
    if (!secureContext) reason = 'insecure-context';
    else if (originAgentCluster === false && namesDomain) reason = 'origin-not-isolated';
    else if (toolsPermission === 'blocked' && !refusal) reason = 'tools-policy-blocked';
    // The browser refused for a reason it named but that none of the signals above explains:
    // report its own words rather than a generic absence.
    else if (refusal) reason = 'api-call-rejected';
    else reason = 'api-absent';
  }

  return {
    state: capability.state,
    reason,
    missing: capability.missing,
    legacyHost: capability.legacyHost,
    checks,
    // The browser's own refusal, when there was one, so the screen can quote it.
    refusal,
  };
}
