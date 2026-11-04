// Versioned selected-field expectations. Pure data, not an expression/script language.
import { canonicalJson, compareJsonNumbers } from './json-compare.js';
import { exactJsonText, jsonType, parseFieldJson, pointerParts, valueAtPointer } from './json-pointer.js';

export const FIELD_CHECK_VERSION = 1;
export const MAX_FIELD_RULES = 20;
export const FIELD_OPERATORS = ['exists', 'missing', 'equals', 'number-min', 'number-max',
  'text-contains', 'length-equals', 'length-min', 'length-max'];
const presentOnly = op => op === 'exists' || op === 'missing';
const clip = value => String(value).length > 160 ? `${String(value).slice(0, 157)}…` : String(value);

export function validateFieldExpectation(expect) {
  if (expect?.kind !== 'fields' || expect.version !== FIELD_CHECK_VERSION) return 'Unsupported field-check version; review this definition.';
  if (!Array.isArray(expect.rules) || expect.rules.length < 1 || expect.rules.length > MAX_FIELD_RULES) {
    return `Choose between 1 and ${MAX_FIELD_RULES} field rules.`;
  }
  for (const [index, rule] of expect.rules.entries()) {
    const prefix = `Rule ${index + 1}: `;
    if (!rule || typeof rule !== 'object' || !FIELD_OPERATORS.includes(rule.op)) return `${prefix}unknown comparison.`;
    try { pointerParts(rule.path); } catch (error) { return prefix + error.message; }
    if (presentOnly(rule.op)) continue;
    if (typeof rule.value !== 'string' || rule.value.length > 20_000) return `${prefix}expected value must contain at most 20000 characters.`;
    if (rule.op === 'text-contains') continue;
    try {
      const value = parseFieldJson(rule.value);
      if (rule.op.startsWith('number-') && jsonType(value) !== 'number') return `${prefix}enter a JSON number.`;
      if (rule.op.startsWith('length-') && (!/^(0|[1-9]\d*)$/.test(rule.value)
        || compareJsonNumbers(rule.value, '4294967295') > 0)) return `${prefix}list length must be an integer from 0 to 4294967295.`;
    } catch { return `${prefix}enter one valid JSON value; duplicate fields are ambiguous.`; }
  }
  return null;
}

export function fieldRuleDescription(rule) {
  const target = rule.path === '' ? '(whole result)' : rule.path;
  const labels = { exists: 'exists', missing: 'is missing', equals: 'equals JSON',
    'number-min': 'is a number at least', 'number-max': 'is a number at most',
    'text-contains': 'is text containing', 'length-equals': 'has list length',
    'length-min': 'has list length at least', 'length-max': 'has list length at most' };
  return `${target} ${labels[rule.op] ?? rule.op}${presentOnly(rule.op) ? '' : ` ${clip(rule.op === 'text-contains' ? JSON.stringify(rule.value) : rule.value)}`}`;
}

export function judgeFieldExpectation(expect, outcome) {
  const problem = validateFieldExpectation(expect);
  if (problem) return { verdict: 'not-a-check', reason: problem, rules: [] };
  if (outcome?.code === 'cancelled' || outcome?.cancelled) return { verdict: 'not-a-check', reason: 'The call was cancelled; fields were not judged.', rules: [] };
  if (outcome?.ok !== true) return { verdict: 'fail', reason: `Expected a JSON result; the call failed: ${clip(outcome?.error ?? outcome?.code ?? 'no outcome')}`, rules: [] };
  if (outcome.resultTruncated) return { verdict: 'not-a-check', reason: 'This historical result was truncated. Run the tool again to check its complete fields.', rules: [] };
  let value;
  try { value = parseFieldJson(outcome.result); }
  catch (error) { return { verdict: 'fail', reason: `Cannot check result fields: ${error.message}`, rules: [] }; }
  const rules = expect.rules.map(rule => judgeRule(rule, value));
  const failed = rules.filter(rule => !rule.pass);
  return { verdict: failed.length ? 'fail' : 'pass',
    reason: failed.length ? `${failed.length} of ${rules.length} field rules failed: ${failed[0].reason}`
      : `All ${rules.length} field rules passed.`, rules };
}

function judgeRule(rule, document) {
  const got = valueAtPointer(document, rule.path);
  const type = got.found ? jsonType(got.value) : 'missing';
  let actual = got.found ? clip(exactJsonText(got.value)) : '(missing)';
  let pass = false;
  if (rule.op === 'exists') pass = got.found;
  else if (rule.op === 'missing') pass = !got.found;
  else if (got.found) {
    if (rule.op === 'equals') pass = canonicalJson(`[${exactJsonText(got.value)}]`) === canonicalJson(`[${rule.value}]`);
    else if (rule.op === 'text-contains') pass = type === 'string' && got.value.includes(rule.value);
    else if (rule.op.startsWith('number-') && type === 'number') {
      const order = compareJsonNumbers(got.value.text, rule.value.trim());
      pass = rule.op === 'number-min' ? order >= 0 : order <= 0;
    } else if (rule.op.startsWith('length-') && type === 'array') {
      actual = `${got.value.length} items`;
      const order = compareJsonNumbers(String(got.value.length), rule.value);
      pass = rule.op === 'length-equals' ? order === 0 : rule.op === 'length-min' ? order >= 0 : order <= 0;
    }
  }
  return { path: rule.path, op: rule.op, expected: rule.value ?? null, actual, actualType: type, pass,
    reason: `${fieldRuleDescription(rule)}; received ${actual} (${type}).` };
}
