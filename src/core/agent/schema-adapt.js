// Makes a tool's root schema acceptable to every provider without changing what it means.
//
// Anthropic refuses `oneOf`, `anyOf` or `allOf` at the root of input_schema (API 400, 2026-10-20), OpenAI strict
// mode and Gemini's OpenAPI subset cannot express them either — yet "exactly one of slug or uri" written as a root
// oneOf of required lists is valid, common JSON Schema. Following Anthropic's own SDK practice for constraints an API
// cannot take (move them into the description, docs/research/2026-10-20-agent-providers-audit.md), the root becomes
// a plain object and the rule is stated in words. The page's schema object is never modified: it stays what the page
// validates against. Pure: no I/O.

const COMBINATORS = ['oneOf', 'anyOf', 'allOf'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function requiredOf(branch) {
  return Array.isArray(branch?.required) ? branch.required.filter((k) => typeof k === 'string') : [];
}

// A branch that only says which fields must be present (optionally restating `type: object`).
function requiredOnly(branch) {
  return isObject(branch) && Object.keys(branch).every((k) => k === 'required' || (k === 'type' && branch.type === 'object'));
}

function ruleFor(kind, branches) {
  const sets = branches.map(requiredOf).filter((s) => s.length);
  if (!sets.length) return null;
  const lead = kind === 'oneOf' ? 'Provide exactly one of' : 'Provide at least one of';
  return sets.every((s) => s.length === 1)
    ? `${lead}: ${sets.map((s) => s[0]).join(', ')}.`
    : `${lead} these sets: ${sets.map((s) => `(${s.join(', ')})`).join(' or ')}.`;
}

// Own-property checks and defineProperty throughout: a property may be called `constructor`, `toString` or
// `__proto__` (a flattener that used `in` or plain assignment corrupted those, agav#359).
function mergeObject(target, branch) {
  if (!isObject(branch) || !isObject(branch.properties)) return;
  const merged = {};
  for (const [k, v] of Object.entries(target.properties ?? {})) {
    Object.defineProperty(merged, k, { value: v, enumerable: true, writable: true, configurable: true });
  }
  for (const [k, v] of Object.entries(branch.properties)) {
    if (!Object.hasOwn(merged, k)) Object.defineProperty(merged, k, { value: v, enumerable: true, writable: true, configurable: true });
  }
  target.properties = merged;
}

// Fields every alternative requires are required whatever the branch (agav#359: dropping them was a bug).
function commonRequired(branches) {
  return branches.map(requiredOf).reduce((acc, s) => acc.filter((k) => s.includes(k)));
}

// Returns { schema, adapted, rule }: `schema` is the input itself when nothing needed to change.
export function adaptRoot(schema) {
  if (!isObject(schema) || !COMBINATORS.some((k) => Object.hasOwn(schema, k))) return { schema, adapted: false, rule: null };
  const out = { ...schema };
  const rules = [];

  if (Array.isArray(out.allOf)) {
    const required = new Set(requiredOf(out));
    for (const branch of out.allOf) {
      mergeObject(out, branch);
      requiredOf(branch).forEach((k) => required.add(k));
    }
    if (required.size) out.required = [...required];
  }
  delete out.allOf;

  for (const kind of ['oneOf', 'anyOf']) {
    const branches = Array.isArray(out[kind]) ? out[kind] : null;
    delete out[kind];
    if (!branches?.length) continue;
    // Real alternatives offer every property; in all cases only what every branch requires becomes required.
    if (!branches.every(requiredOnly)) for (const branch of branches) mergeObject(out, branch);
    const required = [...new Set([...requiredOf(out), ...commonRequired(branches)])];
    if (required.length) out.required = required; else delete out.required;
    const rule = ruleFor(kind, branches);
    if (rule) rules.push(rule);
  }

  if (out.type === undefined && (isObject(out.properties) || Array.isArray(out.required))) out.type = 'object';
  return { schema: out, adapted: true, rule: rules.length ? rules.join(' ') : null };
}
