// Structural schema lint, not a JSON Schema evaluator. Local definitions are visited once
// where declared; no remote references are fetched. Limits are part of the review coverage.
export function walkSchema(schema, { maxDepth = 32, maxNodes = 2000 } = {}) {
  const nodes = [], limits = new Set(), ancestors = new Set();
  const escape = s => s.replace(/~/g, '~0').replace(/\//g, '~1');
  const maps = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
  const singles = ['items', 'additionalItems', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contains', 'not', 'if', 'then', 'else', 'propertyNames'];
  const arrays = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
  function visit(node, path, pointer, depth, required, name = null, isProperty = false) {
    if (depth > maxDepth) { limits.add('depth-limit'); return; }
    if (nodes.length >= maxNodes) { limits.add('node-limit'); return; }
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (ancestors.has(node)) { limits.add('cycle'); return; }
    ancestors.add(node);
    nodes.push({ node, property: node, path, pointer, required, name, isProperty });
    if (typeof node.$ref === 'string') {
      if (!node.$ref.startsWith('#')) limits.add('external-reference');
      else {
        let target = schema;
        try {
          const ref = decodeURIComponent(node.$ref.slice(1));
          if (ref && !ref.startsWith('/')) throw Error();
          for (const key of ref ? ref.slice(1).split('/').map(x => x.replace(/~1/g, '/').replace(/~0/g, '~')) : []) {
            if (!target || !Object.hasOwn(target, key)) throw Error();
            target = target[key];
          }
          if (typeof target !== 'object' && typeof target !== 'boolean') throw Error();
        } catch { limits.add('unresolved-reference'); }
      }
    }
    const requiredNames = new Set(Array.isArray(node.required) ? node.required : []);
    const child = (n, p, ptr, req = false, key = null, prop = false) => visit(n, p, ptr, depth + 1, req, key, prop);
    for (const map of maps) {
      if (!node[map] || typeof node[map] !== 'object' || Array.isArray(node[map])) continue;
      for (const key of Object.keys(node[map])) {
        const prop = map === 'properties';
        const p = prop ? (path ? `${path}.${key}` : key) : `${path ? `${path}.` : ''}${map}.${key}`;
        child(node[map][key], p, `${pointer}/${map}/${escape(key)}`, prop && required && requiredNames.has(key), key, prop);
        if (nodes.length >= maxNodes) { limits.add('node-limit'); break; }
      }
    }
    for (const key of singles) if (!Array.isArray(node[key])) {
      child(node[key], key === 'items' ? `${path}[]` : `${path ? `${path}.` : ''}${key}`, `${pointer}/${key}`);
    }
    for (const key of [...arrays, 'items']) if (Array.isArray(node[key])) {
      for (let i = 0; i < node[key].length; i++) {
        child(node[key][i], `${path ? `${path}.` : ''}${key}[${i}]`, `${pointer}/${key}/${i}`);
        if (nodes.length >= maxNodes) { limits.add('node-limit'); break; }
      }
    }
    ancestors.delete(node);
  }
  if (schema == null) limits.add('schema-unavailable');
  visit(schema, '', '', 0, true);
  return { nodes, limitations: [...limits].sort() };
}

export const isStringSchema = node => node.type === 'string' || (Array.isArray(node.type) && node.type.includes('string'));
export const hasStringConstraint = node => (Number.isInteger(node.maxLength) && node.maxLength >= 0)
  || Array.isArray(node.enum) || Object.hasOwn(node, 'const')
  || (typeof node.pattern === 'string' && node.pattern.length > 0) || (typeof node.format === 'string' && node.format.length > 0);
