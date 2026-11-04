// What changed between two input schemas, said in the words a developer uses: "limit is now
// required", "query lost the value 'boots'", "maxPrice: maximum went from 500 to 100". The
// snapshot diff knows THAT a schema changed (a fingerprint moved); this says WHAT moved, and
// it is what turns "1 contract changed" into "2 saved calls need review: limit is now required".
// Pure JavaScript: no chrome.*, no DOM.
//
// Deliberately a description, not a judgement: an added optional property breaks nothing, a
// new required one breaks every call that omits it — the caller (core/saved-calls.js) decides
// what a change does to a call by validating the call, never from the change's kind.

import { toSchemaObject } from '../schema/parse.js';

export const SCHEMA_CHANGE = {
  propertyAdded: 'property-added',
  propertyRemoved: 'property-removed',
  typeChanged: 'type-changed',
  nowRequired: 'now-required',
  nowOptional: 'now-optional',
  enumChanged: 'enum-changed',
  constraintChanged: 'constraint-changed',
  descriptionChanged: 'description-changed',
  rootChanged: 'root-changed',
};

// The keywords that narrow what a value may be. A change to any of them can break a call.
const CONSTRAINTS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength',
  'maxLength', 'pattern', 'minItems', 'maxItems', 'format', 'const', 'multipleOf'];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const typeText = (schema) => (Array.isArray(schema?.type) ? schema.type.join(' | ') : (schema?.type ?? 'any'));
const joined = (path) => path.join('.');
const quote = (v) => (typeof v === 'string' ? `'${v}'` : JSON.stringify(v));

function objectOf(input) {
  const { schema } = toSchemaObject(input);
  return schema && typeof schema === 'object' ? schema : null;
}

// Every change under one object schema, recursively, with the property path each one is at.
function walk(before, after, path, out) {
  const beforeProps = before.properties ?? {};
  const afterProps = after.properties ?? {};
  const beforeRequired = new Set(Array.isArray(before.required) ? before.required : []);
  const afterRequired = new Set(Array.isArray(after.required) ? after.required : []);
  const names = [...new Set([...Object.keys(beforeProps), ...Object.keys(afterProps)])].sort();

  for (const name of names) {
    const at = [...path, name];
    const b = beforeProps[name];
    const a = afterProps[name];
    if (b === undefined) {
      out.push({
        kind: SCHEMA_CHANGE.propertyAdded, path: at, from: null, to: typeText(a),
        required: afterRequired.has(name),
        text: `${joined(at)} was added${afterRequired.has(name) ? ', and it is required' : ' (optional)'}`,
      });
      continue;
    }
    if (a === undefined) {
      out.push({ kind: SCHEMA_CHANGE.propertyRemoved, path: at, from: typeText(b), to: null, text: `${joined(at)} was removed` });
      continue;
    }
    if (!same(b.type, a.type)) {
      out.push({ kind: SCHEMA_CHANGE.typeChanged, path: at, from: typeText(b), to: typeText(a), text: `${joined(at)} is now ${typeText(a)} (was ${typeText(b)})` });
    }
    if (!beforeRequired.has(name) && afterRequired.has(name)) {
      out.push({ kind: SCHEMA_CHANGE.nowRequired, path: at, from: 'optional', to: 'required', text: `${joined(at)} is now required` });
    } else if (beforeRequired.has(name) && !afterRequired.has(name)) {
      out.push({ kind: SCHEMA_CHANGE.nowOptional, path: at, from: 'required', to: 'optional', text: `${joined(at)} is now optional` });
    }
    if (!same(b.enum, a.enum)) {
      const was = Array.isArray(b.enum) ? b.enum : null;
      const now = Array.isArray(a.enum) ? a.enum : null;
      const lost = was && now ? was.filter((v) => !now.some((w) => same(v, w))) : (was && !now ? [] : []);
      const gained = was && now ? now.filter((v) => !was.some((w) => same(v, w))) : [];
      let text;
      if (!was && now) text = `${joined(at)} now accepts only: ${now.map(quote).join(', ')}`;
      else if (was && !now) text = `${joined(at)} no longer restricts its values (was one of ${was.map(quote).join(', ')})`;
      else {
        const parts = [];
        if (lost.length) parts.push(`lost ${lost.map(quote).join(', ')}`);
        if (gained.length) parts.push(`gained ${gained.map(quote).join(', ')}`);
        text = `${joined(at)} ${parts.join(' and ') || 'changed its accepted values'}`;
      }
      out.push({ kind: SCHEMA_CHANGE.enumChanged, path: at, from: was, to: now, lost, gained, text });
    }
    for (const key of CONSTRAINTS) {
      if (!same(b[key], a[key])) {
        out.push({
          kind: SCHEMA_CHANGE.constraintChanged, path: at, keyword: key, from: b[key] ?? null, to: a[key] ?? null,
          text: b[key] === undefined
            ? `${joined(at)}: ${key} ${quote(a[key])} was added`
            : a[key] === undefined
              ? `${joined(at)}: ${key} ${quote(b[key])} was dropped`
              : `${joined(at)}: ${key} went from ${quote(b[key])} to ${quote(a[key])}`,
        });
      }
    }
    if ((b.description ?? '') !== (a.description ?? '')) {
      out.push({ kind: SCHEMA_CHANGE.descriptionChanged, path: at, from: b.description ?? '', to: a.description ?? '', text: `${joined(at)}: description changed` });
    }
    // Nested objects: the same questions, one level down.
    if (b.type === 'object' && a.type === 'object' && (b.properties || a.properties)) walk(b, a, at, out);
    if (b.type === 'array' && a.type === 'array' && b.items && a.items && typeof b.items === 'object' && typeof a.items === 'object') {
      if (!same(b.items.type, a.items.type)) {
        out.push({ kind: SCHEMA_CHANGE.typeChanged, path: [...at, '[]'], from: typeText(b.items), to: typeText(a.items), text: `${joined(at)} items are now ${typeText(a.items)} (was ${typeText(b.items)})` });
      }
      if (b.items.type === 'object' && a.items.type === 'object') walk(b.items, a.items, [...at, '[]'], out);
    }
  }
}

// Returns the list of changes, in property order. An empty list for two equivalent schemas
// (key order is not a change); a single root-changed entry when one side is not an object
// schema at all, since a property-by-property account would then be an invention.
export function describeSchemaChanges(beforeInput, afterInput) {
  const before = objectOf(beforeInput);
  const after = objectOf(afterInput);
  if (!before && !after) return [];
  if (!before || !after) {
    return [{ kind: SCHEMA_CHANGE.rootChanged, path: [], from: before ? 'object schema' : 'no readable schema', to: after ? 'object schema' : 'no readable schema', text: !after ? 'the schema is no longer readable as an object schema' : 'the schema became readable as an object schema' }];
  }
  const out = [];
  if (!same(before.type, after.type)) {
    out.push({ kind: SCHEMA_CHANGE.rootChanged, path: [], from: typeText(before), to: typeText(after), text: `the schema root is now ${typeText(after)} (was ${typeText(before)})` });
  }
  walk(before, after, [], out);
  return out;
}

// One line for a summary: "limit is now required; query lost 'boots'". Bounded, so a schema
// rewritten from top to bottom does not produce a paragraph where a count is wanted.
export function summarizeSchemaChanges(changes, { max = 3 } = {}) {
  if (!changes.length) return '';
  const shown = changes.slice(0, max).map((c) => c.text);
  const rest = changes.length - shown.length;
  return rest > 0 ? `${shown.join('; ')}; and ${rest} more` : shown.join('; ');
}
