// Validates tool arguments against a JSON Schema subset. Pure JavaScript: no chrome.* API.
//
// This is deliberately NOT a complete JSON Schema validator. Being incomplete is fine;
// pretending otherwise is not. Anything it cannot check is listed in `unchecked`, so
// Explorer can say "valid, but oneOf was not verified" instead of implying a clean bill of
// health it never established. A tool must never look broken because our validator is thin.

import { toSchemaObject } from './parse.js';

const UNCHECKABLE_KEYWORDS = ['oneOf', 'anyOf', 'allOf', 'not', '$ref'];

export function validateArguments(input, args) {
  const { schema } = toSchemaObject(input);
  const errors = [];
  const warnings = [];
  const unchecked = [];

  if (!schema || typeof schema !== 'object') {
    unchecked.push({ path: [], reason: 'no-schema' });
    return { valid: true, errors, warnings, unchecked };
  }

  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    errors.push({ path: [], code: 'type', message: 'arguments must be an object' });
    return { valid: false, errors, warnings, unchecked };
  }

  // A combinator at the root is as unverifiable as one on a property; saying nothing about it
  // would let a "valid" verdict cover a schema this validator never read.
  for (const keyword of UNCHECKABLE_KEYWORDS) {
    if (schema[keyword] !== undefined) unchecked.push({ path: [], reason: keywordReason(keyword) });
  }

  checkObject(schema, args, []);

  return { valid: errors.length === 0, errors, warnings, unchecked };

  function checkObject(objectSchema, value, path) {
    const properties = objectSchema.properties ?? {};

    for (const name of objectSchema.required ?? []) {
      if (value[name] === undefined) {
        errors.push({ path: [...path, name], code: 'required', message: `${name} is required` });
      }
    }

    for (const name of Object.keys(value)) {
      if (!(name in properties)) {
        warnings.push({
          path: [...path, name],
          code: 'unknown-property',
          message: `${name} is not described by the schema`,
        });
      }
    }

    for (const [name, propSchema] of Object.entries(properties)) {
      if (value[name] === undefined) continue;
      checkValue(propSchema, value[name], [...path, name]);
    }
  }

  function checkValue(propSchema, value, path) {
    if (!propSchema || typeof propSchema !== 'object') return;

    for (const keyword of UNCHECKABLE_KEYWORDS) {
      if (propSchema[keyword] !== undefined) {
        unchecked.push({ path, reason: keywordReason(keyword) });
        return;
      }
    }

    if (propSchema.type === 'object') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errors.push({ path, code: 'type', message: `${path.join('.')} must be an object` });
        return;
      }
      checkObject(propSchema, value, path);
      return;
    }

    if (propSchema.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push({ path, code: 'type', message: `${path.join('.')} must be an array` });
        return;
      }
      value.forEach((item, index) => checkValue(propSchema.items ?? {}, item, [...path, index]));
      return;
    }

    if (Array.isArray(propSchema.enum) && !propSchema.enum.includes(value)) {
      errors.push({
        path,
        code: 'enum',
        message: `${path.join('.')} must be one of: ${propSchema.enum.join(', ')}`,
      });
      return;
    }

    if (!matchesType(propSchema.type, value)) {
      errors.push({
        path,
        code: 'type',
        message: `${path.join('.')} must be ${propSchema.type}`,
      });
      return;
    }

    if (typeof value === 'number') {
      if (typeof propSchema.minimum === 'number' && value < propSchema.minimum) {
        errors.push({
          path,
          code: 'minimum',
          message: `${path.join('.')} must be at least ${propSchema.minimum}`,
        });
      }
      if (typeof propSchema.maximum === 'number' && value > propSchema.maximum) {
        errors.push({
          path,
          code: 'maximum',
          message: `${path.join('.')} must be at most ${propSchema.maximum}`,
        });
      }
    }
  }
}

function matchesType(type, value) {
  if (!type) return true;
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'null') return value === null;
  return true;
}

function keywordReason(keyword) {
  if (keyword === 'oneOf') return 'one-of';
  if (keyword === 'anyOf') return 'any-of';
  if (keyword === 'allOf') return 'all-of';
  if (keyword === '$ref') return 'ref';
  return keyword;
}
