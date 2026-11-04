// The model-facing text of a tool, field by field, and the excerpt helpers the text rules share.
// Pure JavaScript.

import { walkSchema } from './schema-walk.js';

const MAX_EXCERPT = 160;

// Every string an agent reads about a tool: name, title, description and each parameter's
// description, with the path that locates it in the contract.
export function modelFacingText(tool) {
  const fields = [
    { field: 'name', path: 'name', text: String(tool.name ?? '') },
    { field: 'title', path: 'title', text: String(tool.title ?? '') },
    { field: 'description', path: 'description', text: String(tool.description ?? '') },
  ];
  const schema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : null;
  for (const { path, node } of walkSchema(schema).nodes) {
    for (const key of ['description', 'title']) if (typeof node[key] === 'string') {
      fields.push({ field: 'parameter', path: `${path || 'inputSchema'}.${key}`, text: node[key], property: path });
    }
  }
  return fields.filter((f) => f.text.length > 0);
}

// Properties of an object schema, nested objects included, bounded in depth so a hostile
// schema cannot make the review walk forever.
export function walkProperties(schema, options = {}) {
  // Historical callers use depth 0 for the root object's own properties.
  return walkSchema(schema, { ...options, maxDepth: options.maxDepth === undefined ? 32 : options.maxDepth + 1 }).nodes.filter(n => n.isProperty);
}

// A short, exact excerpt around a match: what the reader sees is what the page declared.
export function excerptAround(text, index, length) {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  const slice = text.slice(start, end);
  return `${start > 0 ? '…' : ''}${slice.length > MAX_EXCERPT ? `${slice.slice(0, MAX_EXCERPT)}…` : slice}${end < text.length ? '…' : ''}`;
}

export function firstSentence(text, limit = 160) {
  const m = String(text ?? '').match(/^[^.!?\n]*[.!?\n]?/);
  const s = (m ? m[0] : String(text ?? '')).trim();
  return s.length > limit ? s.slice(0, limit) : s;
}

// snake_case, kebab-case and camelCase names become lower-case words.
export function nameWords(name) {
  return String(name ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}
