// WMCP-SEC-008: does a declarative tool form ask the agent for what it shows, and submit only that?
// Measured on Chrome 155/157 (WMP-0057): hidden, file and disabled controls are left out of the
// native schema but hidden ones are still submitted with the form; password fields are included.
// Reads control names, types, autocomplete tokens and whether a parameter description is present,
// never a value. Indicators and observations, not proof of server behaviour. Pure JavaScript.

import { finding } from './catalog.js';
import { nameWords } from './text.js';
import { mutationVerbs } from './phase-b.js';

export const MAX_FORM_CONTROLS = 100;

// Words that carry business meaning when the page fixes them out of the agent's sight: money,
// recipients, identity and privilege, plans, and where the browser goes next.
const BUSINESS = new Set(['amount', 'price', 'total', 'subtotal', 'cost', 'fee', 'fees', 'quantity', 'qty',
  'currency', 'discount', 'coupon', 'recipient', 'recipients', 'payee', 'beneficiary', 'destination', 'account',
  'iban', 'bic', 'routing', 'role', 'roles', 'permission', 'permissions', 'scope', 'user', 'userid', 'uid', 'owner',
  'admin', 'plan', 'tier', 'redirect', 'return', 'callback', 'next', 'url', 'email']);
// Anti-forgery, anti-bot and framework state: expected in a form and not a business value.
const FRAMEWORK = /^(?:__|_?(?:csrf|xsrf|token|nonce|wpnonce|authenticity|captcha|recaptcha|honeypot|form_?key|form_?build_?id|form_?id|utf8|method)(?:$|[_\-.\[]))/i;
// HTML autofill tokens for secrets and card data (https://html.spec.whatwg.org/#autofill).
const CREDENTIAL_TOKENS = new Set(['current-password', 'new-password', 'one-time-code',
  'cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year']);

const controlsOf = (tool) => (Array.isArray(tool.form?.controls) ? tool.form.controls.slice(0, MAX_FORM_CONTROLS) : [])
  .filter((c) => c && typeof c === 'object');
const short = (text, n = 80) => (String(text ?? '').length > n ? `${String(text).slice(0, n)}…` : String(text ?? ''));

export function hiddenBusinessNames(tool) {
  const out = [];
  for (const c of controlsOf(tool)) {
    if (String(c.type ?? '').toLowerCase() !== 'hidden' || typeof c.name !== 'string' || !c.name) continue;
    if (FRAMEWORK.test(c.name)) continue;
    if (nameWords(c.name).some((w) => BUSINESS.has(w)) && !out.includes(c.name)) out.push(c.name);
  }
  return out;
}

export function credentialControls(tool) {
  const out = [];
  for (const c of controlsOf(tool)) {
    const type = String(c.type ?? '').toLowerCase();
    if (!c.name || c.disabled || type === 'hidden') continue;
    const tokens = String(c.autocomplete ?? '').toLowerCase().split(/\s+/).filter((x) => CREDENTIAL_TOKENS.has(x));
    if (type === 'password') out.push({ name: c.name, reason: 'type=password' });
    else if (tokens.length) out.push({ name: c.name, reason: `autocomplete=${tokens[0]}` });
  }
  return out;
}

export function reviewDeclarative(tool, { prior = [] } = {}) {
  if (tool?.registrationType !== 'declarative' || !tool.form) return [];
  const out = [];
  const hidden = hiddenBusinessNames(tool);
  if (hidden.length) {
    out.push(finding('declarative-hidden-parameter', { tool,
      evidence: { field: 'form', path: 'form.hidden', excerpt: `submitted with the form, absent from the agent's schema: ${hidden.slice(0, 10).join(', ')}` },
      detail: { names: hidden.slice(0, 20), count: hidden.length, valuesRead: false } }));
  }
  // Already reported as a credential or payment parameter by its name: one finding per field.
  const covered = new Set(prior.filter((f) => f.code === 'sensitive-parameter' && f.toolName === tool.name
    && (f.instanceId ?? null) === (tool.instanceId ?? null) && ['credentials', 'payment'].includes(f.detail?.category))
    .map((f) => f.detail?.path));
  const credentials = credentialControls(tool).filter((c) => !covered.has(c.name));
  if (credentials.length) {
    out.push(finding('declarative-credential-field', { tool,
      evidence: { field: 'form', path: credentials.map((c) => c.name).slice(0, 10).join(', '), excerpt: credentials.slice(0, 10).map((c) => `${c.name} (${c.reason})`).join('; ') },
      detail: { fields: credentials.slice(0, 20) } }));
  }
  const orphans = controlsOf(tool).filter((c) => c.hasParamDescription && (!c.name || c.disabled))
    .map((c) => ({ reason: c.name ? 'disabled' : 'no-name', name: c.name || null, description: short(c.paramDescription) }));
  if (orphans.length) {
    out.push(finding('declarative-param-orphan', { tool,
      evidence: { field: 'form', path: 'toolparamdescription', excerpt: orphans.slice(0, 3).map((o) => `${o.reason}: ${o.description}`).join('; ') },
      detail: { controls: orphans.slice(0, 20), count: orphans.length } }));
  }
  // A POST form submitted without review. When the name or description already names a mutating
  // action, WMCP-SEC-004 (mutating-auto-submit) reports it: never both for one form.
  if (tool.autoSubmit === true && String(tool.form.method ?? '').toLowerCase() === 'post' && !mutationVerbs(tool).length) {
    out.push(finding('declarative-post-auto-submit', { tool,
      evidence: { field: 'form', path: 'toolautosubmit', excerpt: 'toolautosubmit on a form submitted with method="post"' },
      detail: { method: 'post', agentInvokedIsConsent: false } }));
  }
  return out;
}
