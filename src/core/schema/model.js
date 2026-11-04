// Turns a JSON Schema into a flat list of form controls. Pure JavaScript: no chrome.* API.
//
// The guiding rule is honesty over coverage. Where the schema says something this model
// cannot faithfully represent — oneOf, $ref, arrays of objects — it does NOT invent a
// control. It marks the field as `json` and sets `renderable: false`, so the UI can offer
// the raw JSON editor for that tool instead of a form that would quietly lose data.

import { toSchemaObject } from './parse.js';

const MAX_DEPTH = 6;
const RADIO_LIMIT = 3;
const TEXTAREA_MIN_LENGTH = 200;

const FORMAT_CONTROL = {
  date: 'date',
  'date-time': 'datetime-local',
  time: 'time',
  email: 'email',
  uri: 'url',
  url: 'url',
};

function controlForPrimitive(schema) {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.length <= RADIO_LIMIT ? 'radio' : 'select';
  }
  if (schema.type === 'boolean') return 'checkbox';
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (schema.type === 'string') {
    if (schema.format && FORMAT_CONTROL[schema.format]) return FORMAT_CONTROL[schema.format];
    if (typeof schema.maxLength === 'number' && schema.maxLength >= TEXTAREA_MIN_LENGTH) {
      return 'textarea';
    }
    return 'text';
  }
  return null;
}

function baseField(name, path, schema, { required, group }) {
  return {
    name,
    path,
    label: name,
    group,
    required,
    description: schema.description ?? '',
    default: schema.default,
    examples: Array.isArray(schema.examples) ? schema.examples : undefined,
  };
}

export function buildFormModel(input) {
  const fields = [];
  const unsupported = [];

  const { schema, error } = toSchemaObject(input);
  if (error) {
    unsupported.push({ path: [], reason: 'unparseable-schema', message: error });
    return { fields, unsupported, renderable: false };
  }

  if (!schema || typeof schema !== 'object') {
    return { fields, unsupported, renderable: true };
  }

  if (schema.type && schema.type !== 'object') {
    unsupported.push({ path: [], reason: 'root-not-object' });
    return { fields, unsupported, renderable: false };
  }

  walk(schema, [], null, 0);

  return { fields, unsupported, renderable: unsupported.length === 0 };

  function walk(objectSchema, prefix, group, depth) {
    const properties = objectSchema.properties ?? {};
    const requiredNames = new Set(objectSchema.required ?? []);

    for (const [name, raw] of Object.entries(properties)) {
      const path = [...prefix, name];
      const required = requiredNames.has(name);
      const child = raw && typeof raw === 'object' ? raw : {};

      if (depth >= MAX_DEPTH) {
        unsupported.push({ path, reason: 'too-deep' });
        fields.push({ ...baseField(name, path, child, { required, group }), control: 'json' });
        continue;
      }

      const reason = unsupportedReason(child);
      if (reason) {
        unsupported.push({ path, reason });
        fields.push({ ...baseField(name, path, child, { required, group }), control: 'json' });
        continue;
      }

      if (child.type === 'object') {
        walk(child, path, path.join('.'), depth + 1);
        continue;
      }

      if (child.type === 'array') {
        const itemControl = controlForPrimitive(child.items ?? {});
        fields.push({
          ...baseField(name, path, child, { required, group }),
          control: 'list',
          itemControl,
          itemEnum: Array.isArray(child.items?.enum) ? child.items.enum : undefined,
        });
        continue;
      }

      const control = controlForPrimitive(child);
      if (!control) {
        fields.push({ ...baseField(name, path, child, { required, group }), control: 'json' });
        continue;
      }

      fields.push({
        ...baseField(name, path, child, { required, group }),
        control,
        options: Array.isArray(child.enum) ? child.enum : undefined,
        integer: child.type === 'integer',
        minimum: child.minimum,
        maximum: child.maximum,
        pattern: child.pattern,
      });
    }
  }
}

// Named reasons, so the UI can explain *why* a field fell back to JSON instead of just
// showing a textarea with no rationale.
function unsupportedReason(schema) {
  if (schema.$ref) return 'ref';
  if (schema.oneOf) return 'one-of';
  if (schema.anyOf) return 'any-of';
  if (schema.allOf) return 'all-of';
  if (schema.type === 'array') {
    const items = schema.items;
    if (Array.isArray(items)) return 'tuple-array';
    if (items && (items.type === 'object' || items.properties)) return 'array-of-objects';
    if (items && !controlForPrimitive(items)) return 'array-of-unknown';
  }
  if (Array.isArray(schema.type)) return 'union-type';
  return null;
}
