import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_SURFACE, diagnoseEnvironment } from '../src/core/env.js';

const full = REQUIRED_SURFACE.slice();

// A page where everything is in order.
function healthy(over = {}) {
  return {
    secureContext: true,
    crossOriginIsolated: false,
    originAgentCluster: true,
    knownPolicyFeatures: ['tools', 'camera'],
    toolsPolicyAllowed: true,
    isTopLevel: true,
    parentOriginAccessible: true,
    apiHost: 'document',
    methods: full,
    polyfillActive: false,
    originTrialToken: false,
    devFlag: false,
    ...over,
  };
}

test('a healthy top-level page is available with no blocking reason', () => {
  const d = diagnoseEnvironment(healthy());
  assert.equal(d.state, 'native');
  assert.equal(d.reason, null);
  assert.equal(d.checks.secureContext, 'ok');
  assert.equal(d.checks.apiAvailability, 'available');
  assert.equal(d.checks.toolsPermission, 'allowed');
  assert.equal(d.checks.frameContext, 'top-level');
});

test('an insecure context is reported as such, not as generic unavailability', () => {
  const d = diagnoseEnvironment(healthy({ secureContext: false, apiHost: null, methods: [] }));
  assert.equal(d.state, 'unavailable');
  assert.equal(d.reason, 'insecure-context');
  assert.equal(d.checks.secureContext, 'failed');
});

test('insecure context outranks every other missing signal', () => {
  const d = diagnoseEnvironment(healthy({
    secureContext: false, apiHost: null, methods: [], toolsPolicyAllowed: false,
  }));
  assert.equal(d.reason, 'insecure-context');
});

test('a cross-origin iframe without the tools policy names the policy as the cause', () => {
  const d = diagnoseEnvironment(healthy({
    isTopLevel: false, parentOriginAccessible: false,
    toolsPolicyAllowed: false, apiHost: null, methods: [],
  }));
  assert.equal(d.state, 'unavailable');
  assert.equal(d.reason, 'tools-policy-blocked');
  assert.equal(d.checks.toolsPermission, 'blocked');
  assert.equal(d.checks.frameContext, 'cross-origin-iframe');
});

test('a missing api in a healthy top-level page points at the runtime, not the policy', () => {
  const d = diagnoseEnvironment(healthy({ apiHost: null, methods: [] }));
  assert.equal(d.state, 'unavailable');
  assert.equal(d.reason, 'api-absent');
});

test('frame context distinguishes same-origin from cross-origin iframes', () => {
  const same = diagnoseEnvironment(healthy({ isTopLevel: false, parentOriginAccessible: true }));
  const cross = diagnoseEnvironment(healthy({ isTopLevel: false, parentOriginAccessible: false }));
  assert.equal(same.checks.frameContext, 'same-origin-iframe');
  assert.equal(cross.checks.frameContext, 'cross-origin-iframe');
});

test('an unobservable tools policy is never reported as blocked', () => {
  const d = diagnoseEnvironment(healthy({
    knownPolicyFeatures: ['camera'], toolsPolicyAllowed: false,
  }));
  assert.equal(d.checks.toolsPermission, 'unobservable');
  assert.equal(d.reason, null);
});

test('an unobservable policy never becomes the blocking reason', () => {
  const d = diagnoseEnvironment(healthy({
    knownPolicyFeatures: [], toolsPolicyAllowed: false,
    isTopLevel: false, parentOriginAccessible: false,
    apiHost: null, methods: [],
  }));
  assert.equal(d.reason, 'api-absent');
  assert.equal(d.checks.toolsPermission, 'unobservable');
});

test('a partial api surface reports mismatch and lists the missing methods', () => {
  const d = diagnoseEnvironment(healthy({ methods: ['registerTool', 'getTools'] }));
  assert.equal(d.state, 'api-mismatch');
  assert.equal(d.reason, 'api-partial');
  assert.equal(d.checks.apiAvailability, 'partial');
  assert.deepEqual(d.missing, ['executeTool', 'addEventListener']);
});

// Chrome: "WebMCP is only available in origin-isolated documents." A document opted out
// with Origin-Agent-Cluster: ?0 has the API disabled. This is a requirement, not a hint.
test('a document opted out of origin isolation names that as the cause', () => {
  const d = diagnoseEnvironment(healthy({
    originAgentCluster: false, apiHost: null, methods: [],
  }));
  assert.equal(d.state, 'unavailable');
  assert.equal(d.reason, 'origin-not-isolated');
  assert.equal(d.checks.originIsolation.originAgentCluster, false);
});

test('origin isolation outranks the tools policy as an explanation', () => {
  const d = diagnoseEnvironment(healthy({
    originAgentCluster: false, toolsPolicyAllowed: false,
    isTopLevel: false, parentOriginAccessible: false,
    apiHost: null, methods: [],
  }));
  assert.equal(d.reason, 'origin-not-isolated');
});

// crossOriginIsolated is COOP+COEP — a different thing, and not a WebMCP requirement.
test('crossOriginIsolated is reported but never becomes a verdict', () => {
  const d = diagnoseEnvironment(healthy({ crossOriginIsolated: false }));
  assert.equal(d.checks.originIsolation.crossOriginIsolated, false);
  assert.equal(d.reason, null);
  assert.equal(d.state, 'native');
});

test('a working api is never contradicted by a suspicious signal', () => {
  const d = diagnoseEnvironment(healthy({ originAgentCluster: false }));
  assert.equal(d.state, 'native');
  assert.equal(d.reason, null);
});

test('the capability state is carried through to the diagnosis', () => {
  const trial = diagnoseEnvironment(healthy({ originTrialToken: true }));
  const flag = diagnoseEnvironment(healthy({ devFlag: true }));
  assert.equal(trial.state, 'origin-trial');
  assert.equal(flag.state, 'testing-flag');
});

test('a polyfill is surfaced as compatibility mode, never silently', () => {
  const d = diagnoseEnvironment(healthy({ polyfillActive: true }));
  assert.equal(d.state, 'compat-polyfill');
  assert.equal(d.reason, 'polyfill-active');
});

test('every reason has a stable machine-readable code', () => {
  const reasons = [
    diagnoseEnvironment(healthy({ secureContext: false, apiHost: null, methods: [] })).reason,
    diagnoseEnvironment(healthy({ originAgentCluster: false, apiHost: null, methods: [] })).reason,
    diagnoseEnvironment(healthy({
      isTopLevel: false, parentOriginAccessible: false,
      toolsPolicyAllowed: false, apiHost: null, methods: [],
    })).reason,
    diagnoseEnvironment(healthy({ apiHost: null, methods: [] })).reason,
    diagnoseEnvironment(healthy({ methods: ['registerTool'] })).reason,
    diagnoseEnvironment(healthy({ polyfillActive: true })).reason,
  ];
  assert.deepEqual(reasons, [
    'insecure-context', 'origin-not-isolated', 'tools-policy-blocked',
    'api-absent', 'api-partial', 'polyfill-active',
  ]);
});

test('diagnoseEnvironment tolerates being called with nothing', () => {
  const d = diagnoseEnvironment();
  assert.equal(d.state, 'unavailable');
  assert.equal(d.reason, 'insecure-context');
});

// Chrome 153 and 155 keep the accessor but reject getTools() in a document that is not
// origin-keyed (WMP-0051). The refusal travels with the diagnosis; availability becomes
// "refused", never "available" followed by an empty tool list; the reason stays the precise
// one when the origin-isolation signal explains it.
test('a refused getTools() on a non-origin-keyed document is origin-not-isolated, refused, and keeps the browser error', () => {
  const d = diagnoseEnvironment(healthy({
    originAgentCluster: false,
    callError: { name: 'SecurityError', message: 'document.modelContext cannot be used when document.domain is enabled.' },
  }));
  assert.equal(d.state, 'native');
  assert.equal(d.checks.apiAvailability, 'refused');
  assert.equal(d.reason, 'origin-not-isolated');
  assert.equal(d.refusal.during, 'call');
  assert.equal(d.refusal.name, 'SecurityError');
  assert.match(d.refusal.message, /document\.domain/);
});

test('a refusal nothing else explains is reported in the browser\'s words, not as a plain absence', () => {
  const d = diagnoseEnvironment(healthy({
    originAgentCluster: true,
    callError: { name: 'SecurityError', message: 'refused' },
  }));
  assert.equal(d.checks.apiAvailability, 'refused');
  assert.equal(d.reason, 'api-call-rejected');
  assert.deepEqual(d.refusal, { during: 'call', name: 'SecurityError', message: 'refused' });
});

test('an accessor that threw is carried the same way, with the API missing', () => {
  const d = diagnoseEnvironment(healthy({
    originAgentCluster: false, apiHost: null, methods: [],
    accessError: { name: 'SecurityError', message: 'document.modelContext cannot be used when document.domain is enabled.' },
  }));
  assert.equal(d.checks.apiAvailability, 'missing');
  assert.equal(d.reason, 'origin-not-isolated');
  assert.equal(d.refusal.during, 'access');
});

test('a working API carries no refusal and no reason', () => {
  const d = diagnoseEnvironment(healthy({}));
  assert.equal(d.reason, null);
  assert.equal(d.refusal, null);
  assert.equal(d.checks.apiAvailability, 'available');
});

test('a refusal that does not name document.domain is not blamed on origin isolation even when the signal is false', () => {
  const d = diagnoseEnvironment(healthy({
    originAgentCluster: false,
    callError: { name: 'NotAllowedError', message: 'tools are disabled in this document' },
  }));
  assert.equal(d.checks.apiAvailability, 'refused');
  assert.equal(d.reason, 'api-call-rejected');
});

