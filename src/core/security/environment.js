// Page-level governance facts the environment diagnosis already observed, read as a reviewer
// would: a page that exposes no tools but keeps the API open can close it with
// Permissions-Policy: tools=() so that an injected script cannot register any (spec §6.4.1).
// Pure JavaScript.

import { finding } from './catalog.js';

export function reviewEnvironment(discovery) {
  const out = [];
  const env = discovery?.env ?? null;
  const tools = discovery?.tools ?? [];
  if (env?.checks?.apiAvailability === 'available' && tools.length === 0 && env.checks.toolsPermission === 'allowed') {
    out.push(finding('no-tools-policy-open', {
      evidence: { field: 'environment', path: 'Permissions-Policy', excerpt: `tools policy allowed, ${tools.length} tools` },
      detail: { origin: discovery?.topOrigin ?? null } }));
  }
  if (env?.legacyHost) {
    out.push(finding('legacy-host', {
      evidence: { field: 'environment', path: 'apiHost', excerpt: 'navigator.modelContext' },
      detail: {} }));
  }
  return out;
}
