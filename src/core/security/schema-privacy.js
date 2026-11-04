// What the input schema invites an agent to supply. The spec's over-parameterization threat
// (§6.3.3): a helpful agent fills optional-looking parameters from personalization data the
// person never gave this site. Issue #316 adds credentials, card data and national identifiers,
// which agents are expected to hand back to the person rather than pass through a model.
// Pure JavaScript.

import { finding } from './catalog.js';
import { walkProperties } from './text.js';

// Category → pattern on the property name (words) and its description. Severity by category.
export const CATEGORIES = [
  { category: 'credentials', severity: 'high', re: /\b(password|passwd|passphrase|otp|one[_ ]?time|2fa|mfa|totp|token|secret|api[_ ]?key|apikey|cvv|cvc|cvv2|pin|security[_ ]code|private[_ ]key|session[_ ]id|auth)\b/i },
  { category: 'payment', severity: 'high', re: /\b(card[_ ]?number|cardnumber|pan|iban|bic|swift|account[_ ]?number|routing|sort[_ ]code|credit[_ ]?card|debit[_ ]?card|expir(y|ation)|card[_ ]holder)\b/i },
  { category: 'identity', severity: 'medium', re: /\b(ssn|social[_ ]security|national[_ ]id|passport|tax[_ ]id|tin|driver'?s?[_ ]licen[cs]e|date[_ ]of[_ ]birth|dob|birth[_ ]?date|birthday|id[_ ]number|nric|aadhaar)\b/i },
  { category: 'health', severity: 'medium', re: /\b(medical|diagnos(is|es)|prescription|medication|health|pregnan(t|cy)|disabilit(y|ies)|allerg(y|ies)|blood[_ ]type|medical[_ ]condition)\b/i },
  { category: 'location', severity: 'medium', re: /\b(home[_ ]?address|street[_ ]?address|address|latitude|longitude|lat|lng|lon|geolocation|gps|coordinates|postcode|postal[_ ]code|zip(code)?)\b/i },
  { category: 'contact', severity: 'low', re: /\b(e-?mail|phone|mobile|telephone|whatsapp)\b/i },
  { category: 'profiling', severity: 'low', re: /\b(age|gender|sex|ethnicity|race|religion|income|salary|marital|orientation|political|nationality|skin[_ ]?tone|weight|height)\b/i },
];

function classify(path, property) {
  const words = path.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_.\[\]-]+/g, ' ');
  const description = property && typeof property === 'object' && typeof property.description === 'string' ? property.description : '';
  for (const c of CATEGORIES) {
    if (c.re.test(words)) return { ...c, matchedIn: 'name' };
    if (description && c.re.test(description)) return { ...c, matchedIn: 'description' };
  }
  return null;
}

export function reviewSchema(tool) {
  const out = [];
  const schema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : null;
  if (!schema) return out;

  const unbounded = [];
  for (const { path, property, required } of walkProperties(schema)) {
    const hit = classify(path, property);
    if (hit) {
      out.push(finding('sensitive-parameter', { tool, severity: hit.severity,
        evidence: { field: 'inputSchema', path, excerpt: `${path}${required ? ' (required)' : ' (optional)'}: ${property?.description ?? ''}`.trim(), category: hit.category },
        detail: { path, category: hit.category, required, matchedIn: hit.matchedIn } }));
    }
    const isString = property && typeof property === 'object' && (property.type === 'string' || (Array.isArray(property.type) && property.type.includes('string')));
    if (isString && property.maxLength === undefined && !property.enum && !property.pattern && !property.format && !Object.hasOwn(property, 'const')) {
      unbounded.push(path);
    }
  }
  if (unbounded.length) {
    out.push(finding('unbounded-string', { tool,
      evidence: { field: 'inputSchema', path: unbounded.join(', '), excerpt: unbounded.join(', ') },
      detail: { paths: unbounded } }));
  }
  return out;
}
