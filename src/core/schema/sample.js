// Generates a plausible example argument object from a JSON Schema.
// Pure JavaScript: no chrome.* API.
//
// The clock is injected rather than read from Date.now(), so generated dates are
// deterministic and the function stays testable.
//
// Priority, highest first: default → first example → first enum → format → minimum →
// type fallback. That order matters: whatever the tool author took the trouble to declare
// should win over anything Explorer invents.

import { toSchemaObject } from './parse.js';

const MAX_DEPTH = 8;

export function sampleArguments(input, { now = new Date(), requiredOnly = false, includeOptionalDefaults = false } = {}) {
  const { schema } = toSchemaObject(input);
  if (!schema || typeof schema !== 'object') return {};
  if (schema.type && schema.type !== 'object') return {};
  return sampleObject(schema, 0);

  function sampleObject(objectSchema, depth) {
    const out = {};
    const properties = objectSchema.properties ?? {};
    const required = new Set(objectSchema.required ?? []);

    for (const [name, propSchema] of Object.entries(properties)) {
      if (requiredOnly && !required.has(name)
        && !(includeOptionalDefaults && propSchema?.default !== undefined)) continue;
      out[name] = sampleValue(propSchema ?? {}, name, depth + 1);
    }
    return out;
  }

  function sampleValue(propSchema, name, depth) {
    if (depth > MAX_DEPTH) return null;

    if (propSchema.default !== undefined) return propSchema.default;
    if (Array.isArray(propSchema.examples) && propSchema.examples.length > 0) {
      return propSchema.examples[0];
    }
    if (Array.isArray(propSchema.enum) && propSchema.enum.length > 0) return propSchema.enum[0];

    if (propSchema.type === 'object') return sampleObject(propSchema, depth);

    if (propSchema.type === 'array') {
      const items = propSchema.items;
      if (!items || Array.isArray(items)) return [];
      return [sampleValue(items, name, depth + 1)];
    }

    if (propSchema.type === 'boolean') return false;

    if (propSchema.type === 'integer' || propSchema.type === 'number') {
      const min = typeof propSchema.minimum === 'number' ? propSchema.minimum : 1;
      return propSchema.type === 'integer' ? Math.ceil(min) : min;
    }

    if (propSchema.type === 'string') return sampleString(propSchema, name);

    // No usable type: an empty object is safer than guessing a string the tool will reject.
    return null;
  }

  function sampleString(propSchema, name) {
    switch (propSchema.format) {
      case 'date': return now.toISOString().slice(0, 10);
      case 'date-time': return now.toISOString();
      case 'time': return now.toISOString().slice(11, 19);
      case 'email': return 'user@example.com';
      case 'uri':
      case 'url': return 'https://example.com';
      case 'uuid': return '00000000-0000-4000-8000-000000000000';
      default: break;
    }
    if (typeof propSchema.minLength === 'number' && propSchema.minLength > name.length) {
      return name.padEnd(propSchema.minLength, 'x');
    }
    return name;
  }
}
