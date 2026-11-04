// RFC 6901 field access over exact JSON values. Own properties only; never guess an index.
// Original number spellings use the same representation as the readable result view.
import { DisplayNumber } from './json-display.js';

export const MAX_FIELD_DOCUMENT = 2_000_000;
export const MAX_POINTER_LENGTH = 2048;
export const jsonType = value => value instanceof DisplayNumber ? 'number'
  : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
export const pointerToken = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

export function pointerParts(pointer) {
  if (typeof pointer !== 'string' || pointer.length > MAX_POINTER_LENGTH
    || (pointer !== '' && !pointer.startsWith('/')) || /~(?![01])/.test(pointer)) {
    throw new Error('Use a JSON Pointer such as /products/0/id; escape ~ as ~0 and / as ~1.');
  }
  const parts = pointer === '' ? [] : pointer.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts.length > 128) throw new Error('A field path can contain at most 128 segments.');
  return parts;
}

export function valueAtPointer(value, pointer) {
  for (const key of pointerParts(pointer)) {
    if (value === null || typeof value !== 'object' || value instanceof DisplayNumber) return { found: false };
    if (Array.isArray(value) && !/^(?:0|[1-9]\d*)$/.test(key)) return { found: false };
    if (!Object.hasOwn(value, key)) return { found: false };
    value = value[key];
  }
  return { found: true, value };
}

export function parseFieldJson(text) {
  if (typeof text !== 'string') throw new Error('The result must be JSON text.');
  if (text.length > MAX_FIELD_DOCUMENT) throw new Error(`Field checks support JSON up to ${MAX_FIELD_DOCUMENT} characters.`);
  const value = JSON.parse(text, (_key, item, context) => {
    if (typeof item !== 'number') return item;
    if (!context?.source) throw new Error('This browser cannot preserve exact JSON numbers.');
    return new DisplayNumber(context.source);
  });
  // JSON.parse has already checked syntax. Walk only structure and key tokens to detect
  // ambiguous duplicate members before its last-key-wins behavior can produce a verdict.
  const stack = [];
  for (const [token] of text.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]|[^\s{}\[\],:]+/g)) {
    const top = stack.at(-1);
    if (token === '{') stack.push({ keys: new Set(), key: true });
    else if (token === '[') stack.push({ keys: null });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && top?.keys) top.key = true;
    else if (token === ':' && top?.keys) top.key = false;
    else if (top?.keys && top.key && token.startsWith('"')) {
      const key = JSON.parse(token);
      if (top.keys.has(key)) throw new Error(`Ambiguous JSON: duplicate object field ${JSON.stringify(key).slice(0, 100)}.`);
      top.keys.add(key);
    }
  }
  return value;
}

export function exactJsonText(value) {
  if (value instanceof DisplayNumber) return value.text;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(exactJsonText).join(',')}]`;
  return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${exactJsonText(item)}`).join(',')}}`;
}
