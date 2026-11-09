// Starter hardened contracts (engine v3): when a page exposes no WebMCP tool, propose one per form
// it already has, as declarative attributes and as a document.modelContext registration. Copy-only
// and inert: the snippet calls nothing, the action refuses until implemented, toolautosubmit is
// never proposed, and a human confirmation step guards anything that is not read-only. Forms with
// credential, card or file fields are not proposed (spec issue #316). Page strings enter
// JavaScript only as JSON literals and HTML only as escaped values; comments are fixed text.
// Field values are never read. Pure JavaScript.

import { jsonLiteral, htmlText } from './snippet-encode.js';
import { nameWords } from './text.js';
import { READ, MUTATING, CONSEQUENTIAL } from './annotations-governance.js';

export const MAX_STARTER_FORMS = 5;
export const MAX_STARTER_FIELDS = 30;
export const DEFAULT_MAX_LENGTH = 256;
const NAME_RULE = /^[A-Za-z0-9_.-]{1,128}$/;
const SKIP_TYPES = new Set(['submit', 'button', 'reset', 'image', 'hidden']);
const CREDENTIAL_TOKENS = /(?:^|\s)(?:current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp(?:-month|-year)?)(?:\s|$)/i;
const COMMUNITY = /\b(review|comment|forum|message|post|thread|community|question|answer|feed)s?\b/i;
const FORMATS = { email: ['email', 254], url: ['uri', 2048], date: ['date', null], time: ['time', null], 'datetime-local': ['date-time', null] };

const clip = (text, n) => { const s = String(text ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const slug = (text) => String(text ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const intAttr = (v) => (v !== null && v !== undefined && v !== '' && Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : undefined);
const numAttr = (v) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const typeOf = (field) => String(field?.type ?? field?.tag ?? 'text').toLowerCase();

// Why a form is not proposed, or null when it is.
export function formExclusion(form) {
  const fields = Array.isArray(form?.fields) ? form.fields : [];
  if (String(form?.method ?? '').toLowerCase() === 'dialog') return 'dialog-form';
  if (fields.some((f) => typeOf(f) === 'password' || CREDENTIAL_TOKENS.test(String(f?.autocomplete ?? '')))) return 'credential-or-payment-field';
  if (fields.some((f) => typeOf(f) === 'file')) return 'file-upload';
  if (!starterFields(form).length) return 'no-named-controls';
  return null;
}

// Named, enabled, visible controls, one entry per name, at most MAX_STARTER_FIELDS.
export function starterFields(form) {
  const seen = new Set(), out = [];
  for (const f of Array.isArray(form?.fields) ? form.fields : []) {
    const type = typeOf(f);
    if (!f || typeof f.name !== 'string' || !f.name || f.disabled || SKIP_TYPES.has(type) || seen.has(f.name)) continue;
    seen.add(f.name);
    out.push(f);
    if (out.length >= MAX_STARTER_FIELDS) break;
  }
  return out;
}

function propertyFor(f) {
  const type = typeOf(f);
  const description = clip(f.toolparamdescription || f.label || '', 150) || 'TODO: describe this parameter.';
  const options = Array.isArray(f.options) ? [...new Set(f.options.map((o) => clip(o, 200)).filter(Boolean))].slice(0, 50) : [];
  if (type === 'number' || type === 'range') {
    const p = { type: 'number', description }, min = numAttr(f.min), max = numAttr(f.max);
    if (min !== undefined) p.minimum = min;
    if (max !== undefined) p.maximum = max;
    return p;
  }
  if (type === 'checkbox') return { type: 'boolean', description };
  if (type === 'select-multiple' && options.length) return { type: 'array', description, items: { type: 'string', enum: options }, maxItems: options.length };
  if ((type === 'select' || type === 'select-one') && options.length) return { type: 'string', description, enum: options };
  const p = { type: 'string', description };
  const [format, cap] = FORMATS[type] ?? [null, null];
  if (format) p.format = format;
  const maxLength = intAttr(f.maxlength) ?? cap ?? (format ? undefined : DEFAULT_MAX_LENGTH);
  if (maxLength !== undefined) p.maxLength = maxLength;
  const minLength = intAttr(f.minlength);
  if (minLength !== undefined) p.minLength = minLength;
  return p;
}

function nameFor(form, index, taken) {
  const action = String(form?.action ?? '').split(/[?#]/)[0].split('/').filter(Boolean).pop()?.replace(/\.[a-z0-9]+$/i, '');
  const base = slug(form?.id) || slug(form?.name) || slug(action) || `form_${index + 1}`;
  const read = String(form?.method ?? 'get').toLowerCase() !== 'post';
  const [first] = nameWords(base);
  let name = READ.has(first) || MUTATING.has(first) || CONSEQUENTIAL.has(first) ? base : `${read ? 'search' : 'submit'}_${base}`;
  name = name.slice(0, 30).replace(/_+$/, '') || `form_${index + 1}`;
  for (let n = 2; taken.has(name); n += 1) name = `${name.slice(0, 27)}_${n}`;
  taken.add(name);
  return NAME_RULE.test(name) ? name : `form_${index + 1}`;
}

export function starterDescriptor(form, index = 0, taken = new Set()) {
  const fields = starterFields(form);
  const read = String(form?.method ?? 'get').toLowerCase() !== 'post';
  const properties = {}, required = [];
  for (const f of fields) {
    Object.defineProperty(properties, f.name, { value: propertyFor(f), enumerable: true, writable: true, configurable: true });
    if (f.required) required.push(f.name);
  }
  const haystack = [form?.id, form?.name, form?.action, ...fields.map((f) => `${f.name} ${f.label ?? ''}`)].join(' ');
  return {
    name: nameFor(form, index, taken),
    description: 'TODO: say what this form does, its inputs and its result in one or two sentences.',
    inputSchema: { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) },
    annotations: { readOnlyHint: read, consequentialHint: !read, untrustedContentHint: read && COMMUNITY.test(haystack) },
  };
}

// Declarative attributes for a reviewed form. Never toolautosubmit.
export function declarativeMarkup({ name, description, inputSchema }) {
  const properties = inputSchema?.properties ?? {};
  const required = new Set(Array.isArray(inputSchema?.required) ? inputSchema.required : []);
  const lines = [
    '<!-- REVIEW REQUIRED: merge these attributes into your own form; nothing here submits by itself. -->',
    '<!-- No toolautosubmit: the person reviews the filled form and submits it. -->',
    '<!-- Keep your action and method. Keep prices, recipients and roles on the server, not in hidden fields. -->',
    `<form toolname="${htmlText(name)}" tooldescription="${htmlText(description)}">`,
  ];
  for (const key of Object.keys(properties)) {
    const p = properties[key] ?? {};
    const attrs = [`name="${htmlText(key)}"`];
    if (required.has(key)) attrs.push('required');
    attrs.push(`toolparamdescription="${htmlText(p.description ?? 'TODO: describe this parameter.')}"`);
    const label = htmlText(clip(p.description && !/^TODO:/.test(p.description) ? p.description : key, 60));
    const enumValues = p.type === 'array' ? p.items?.enum : p.enum;
    if (Array.isArray(enumValues)) {
      const options = enumValues.map((v) => `<option value="${htmlText(v)}">${htmlText(v)}</option>`).join('');
      lines.push(`  <label>${label} <select ${attrs.join(' ')}${p.type === 'array' ? ' multiple' : ''}>${options}</select></label>`);
      continue;
    }
    if (p.type === 'boolean') attrs.push('type="checkbox"');
    else if (p.type === 'number') {
      attrs.push('type="number"');
      if (p.minimum !== undefined) attrs.push(`min="${htmlText(p.minimum)}"`);
      if (p.maximum !== undefined) attrs.push(`max="${htmlText(p.maximum)}"`);
    } else {
      attrs.push(`type="${({ email: 'email', uri: 'url', date: 'date', time: 'time', 'date-time': 'datetime-local' })[p.format] ?? 'text'}"`);
      if (p.maxLength !== undefined) attrs.push(`maxlength="${htmlText(p.maxLength)}"`);
      if (p.minLength !== undefined) attrs.push(`minlength="${htmlText(p.minLength)}"`);
    }
    lines.push(`  <label>${label} <input ${attrs.join(' ')}></label>`);
  }
  lines.push('  <button type="submit">Review and submit</button>', '</form>');
  return `${lines.join('\n')}\n`;
}

// An inert document.modelContext registration with input validation and a confirmation step.
export function imperativeStarter(descriptor) {
  return [
    '// REVIEW REQUIRED: inert starter generated from a form observed on this page.',
    '// Nothing runs until you call registerStarterTool(); the action refuses until implemented.',
    '// Annotations are advisory: validate, authorize and confirm in your own code and on your server.',
    '// Set untrustedContentHint to true if results include content written by other people.',
    'async function registerStarterTool(signal) {',
    '  if (!document.modelContext || typeof document.modelContext.registerTool !== "function") return undefined;',
    `  const descriptor = JSON.parse(${jsonLiteral(JSON.stringify(descriptor, null, 2))});`,
    '  return document.modelContext.registerTool({',
    '    ...descriptor,',
    '    async execute(args) {',
    '      const input = validateStarterInput(descriptor.inputSchema, args);',
    '      if (descriptor.annotations.readOnlyHint !== true) await confirmWithUser(input);',
    '      // Call your server with the session authorization, then return a short, factual result.',
    '      throw new Error("Starter: implement the reviewed action first");',
    '    }',
    '  }, { signal });',
    '}',
    'function validateStarterInput(schema, args) {',
    '  if (!args || typeof args !== "object" || Array.isArray(args)) throw new TypeError("Arguments must be an object");',
    '  const properties = schema.properties || {};',
    '  for (const key of Object.keys(args)) if (!Object.hasOwn(properties, key)) throw new TypeError("Unknown argument");',
    '  for (const key of schema.required || []) if (!Object.hasOwn(args, key)) throw new TypeError("Missing required argument");',
    '  for (const key of Object.keys(properties)) {',
    '    if (!Object.hasOwn(args, key)) continue;',
    '    const rule = properties[key], value = args[key];',
    '    if (rule.type === "boolean" && typeof value !== "boolean") throw new TypeError("Invalid boolean argument");',
    '    if (rule.type === "number" && (typeof value !== "number" || !Number.isFinite(value)',
    '      || (rule.minimum !== undefined && value < rule.minimum) || (rule.maximum !== undefined && value > rule.maximum))) throw new TypeError("Invalid number argument");',
    '    if (rule.type === "string" && (typeof value !== "string" || (rule.maxLength !== undefined && value.length > rule.maxLength)',
    '      || (rule.minLength !== undefined && value.length < rule.minLength) || (rule.enum && !rule.enum.includes(value)))) throw new TypeError("Invalid string argument");',
    '    if (rule.type === "array" && (!Array.isArray(value) || value.length > (rule.maxItems ?? 0)',
    '      || value.some((item) => !(rule.items && rule.items.enum && rule.items.enum.includes(item))))) throw new TypeError("Invalid array argument");',
    '  }',
    '  return args;',
    '}',
    'async function confirmWithUser(input) {',
    '  // Show the exact request in your own page UI and continue only after an explicit human approval.',
    '  // Never accept an approval supplied by the model or by the tool arguments.',
    '  throw new Error("Starter: implement a human confirmation step");',
    '}',
    '// Pass an AbortController signal; abort it to unregister. No function is called here.',
    '',
  ].join('\n');
}

// Proposals for the forms of a page without tools: { contracts, skipped }, bounded.
export function starterContracts(forms = []) {
  const contracts = [], skipped = [], taken = new Set();
  (Array.isArray(forms) ? forms : []).forEach((form, index) => {
    if (form?.toolname !== null && form?.toolname !== undefined) return;
    const reason = formExclusion(form);
    if (reason) { if (skipped.length < 20) skipped.push({ formIndex: index, reason }); return; }
    if (contracts.length >= MAX_STARTER_FORMS) { if (skipped.length < 20) skipped.push({ formIndex: index, reason: 'limit' }); return; }
    const descriptor = starterDescriptor(form, index, taken);
    contracts.push({ formIndex: index, toolName: descriptor.name, readOnly: descriptor.annotations.readOnlyHint, descriptor,
      declarative: declarativeMarkup(descriptor), imperative: imperativeStarter(descriptor) });
  });
  return { contracts, skipped };
}
