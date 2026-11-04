// Stable identity for WebMCP tools. Pure JavaScript: no chrome.* API, so this module runs
// unchanged in Node and in the extension. See docs/ARCHITECTURE.md section 1.
//
// Neither frameId nor registrationType take part in identity — frameId changes on every
// reload, and registrationType is not reliably observable (docs/DECISIONS.md D-016).

// U+0000 cannot appear in an origin, a frame key or a tool name, so joining on it makes
// the concatenation unambiguous.
const SEP = '\u0000';

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function frameKey({ isTopLevel, frameUrl, frameIndexPath = [] }) {
  if (isTopLevel) return 'top';
  if (frameUrl) {
    try {
      const url = new URL(frameUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin + url.pathname;
    } catch {
      // Malformed URL: fall through to the index path.
    }
  }
  return 'idx:' + frameIndexPath.join('/');
}

export function logicalId({ topOrigin, frameKey: key, toolName }) {
  return sha256Hex([topOrigin, key, toolName].join(SEP));
}

export function normalizeAnnotations(annotations) {
  if (!annotations || typeof annotations !== 'object') return {};
  const out = {};
  for (const key of Object.keys(annotations).sort()) {
    const value = annotations[key];
    out[key] = typeof value === 'boolean' ? value : value ?? null;
  }
  return out;
}

export async function contractFingerprint({ inputSchema, annotations, description }) {
  const schemaFp = await sha256Hex(canonicalJson(inputSchema ?? null));
  const annotationsFp = await sha256Hex(canonicalJson(normalizeAnnotations(annotations)));
  const descriptionFp = await sha256Hex(description ?? '');
  return sha256Hex(schemaFp + annotationsFp + descriptionFp);
}
