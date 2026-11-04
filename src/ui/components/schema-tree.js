// A collapsible schema tree. The complaint most often made about existing inspectors is
// that they dump the raw inputSchema into a table cell; this renders the structure instead.
// Uses <details> so keyboard and screen-reader behaviour come from the platform.

import { el, t } from '../dom.js';
import { toSchemaObject } from '../../core/schema/parse.js';

const CONSTRAINT_KEYS = [
  'format', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'default', 'const',
];

function typeLabel(schema) {
  if (!schema || typeof schema !== 'object') return 'any';
  if (schema.$ref) return `$ref ${schema.$ref}`;
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  if (schema.oneOf) return 'oneOf';
  if (schema.anyOf) return 'anyOf';
  if (schema.allOf) return 'allOf';
  if (schema.type === 'array') return `array of ${typeLabel(schema.items)}`;
  return schema.type ?? 'any';
}

function constraintsOf(schema) {
  const parts = [];
  for (const key of CONSTRAINT_KEYS) {
    if (schema[key] === undefined) continue;
    parts.push(`${key}: ${typeof schema[key] === 'object' ? JSON.stringify(schema[key]) : schema[key]}`);
  }
  if (Array.isArray(schema.enum)) parts.push(`enum: ${schema.enum.join(', ')}`);
  return parts;
}

function node(name, schema, { required, depth }) {
  const safe = schema && typeof schema === 'object' ? schema : {};
  const head = el('span', { class: 'tree-head' }, [
    el('span', { class: 'tree-name mono', text: name }),
    el('span', { class: 'tree-type', text: typeLabel(safe) }),
    required ? el('span', { class: 'req', text: '*', title: t('schemaForm_required') }) : null,
  ]);

  const details = el('div', { class: 'tree-detail' });
  if (safe.description) details.append(el('p', { class: 'field-desc', text: safe.description }));
  const constraints = constraintsOf(safe);
  if (constraints.length) {
    details.append(el('p', { class: 'card-origin', text: constraints.join(' · ') }));
  }

  const children = childrenOf(safe, depth);
  if (!children && !details.childElementCount) {
    return el('div', { class: 'tree-row' }, [head]);
  }

  const box = el('details', { class: 'tree-row' });
  if (depth === 0) box.open = true;
  box.append(el('summary', { title: t('help_schemaProperty') }, [head]), details);
  if (children) box.append(children);
  return box;
}

function childrenOf(schema, depth) {
  if (depth > 8) return el('p', { class: 'field-note', text: t('schemaTree_nestedTooDeeplyToExpand') });

  if (schema.type === 'object' && schema.properties) {
    const required = new Set(schema.required ?? []);
    const wrap = el('div', { class: 'tree-children' });
    for (const [name, child] of Object.entries(schema.properties)) {
      wrap.append(node(name, child, { required: required.has(name), depth: depth + 1 }));
    }
    return wrap.childElementCount ? wrap : null;
  }

  if (schema.type === 'array' && schema.items && !Array.isArray(schema.items)
    && (schema.items.properties || schema.items.type === 'object')) {
    const wrap = el('div', { class: 'tree-children' });
    wrap.append(node('items', schema.items, { required: false, depth: depth + 1 }));
    return wrap;
  }

  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (!Array.isArray(schema[key])) continue;
    const wrap = el('div', { class: 'tree-children' });
    schema[key].forEach((branch, index) => {
      wrap.append(node(`${key}[${index}]`, branch, { required: false, depth: depth + 1 }));
    });
    return wrap;
  }

  return null;
}

export function renderSchemaTree(input) {
  const { schema, error } = toSchemaObject(input);
  if (error) {
    return el('p', { class: 'field-note', text: error });
  }
  if (!schema || typeof schema !== 'object') {
    return el('p', { class: 'muted', text: t('schemaTree_thisToolDeclaresNoInput') });
  }

  const root = el('div', { class: 'tree' });
  const required = new Set(schema.required ?? []);
  const properties = schema.properties ?? {};

  if (Object.keys(properties).length === 0) {
    root.append(el('p', { class: 'muted', text: t('schemaTree_theSchemaDeclaresNoProperties') }));
  }

  for (const [name, child] of Object.entries(properties)) {
    root.append(node(name, child, { required: required.has(name), depth: 0 }));
  }

  const raw = el('details', { class: 'tree-raw' });
  raw.append(
    el('summary', { text: t('schemaTree_rawJsonSchema'), title: t('help_rawSchema') }),
    el('pre', { class: 'result-body mono', text: JSON.stringify(schema, null, 2) }),
  );
  root.append(raw);

  return root;
}
