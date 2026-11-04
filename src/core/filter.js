// Filtering and sorting for the tool list. Pure JavaScript: no chrome.* API.
//
// Facets are derived from what the browser actually returned, never from a hard-coded list
// of annotations: Chrome 152 does not expose consequentialHint at all, and a fixed list
// would offer a filter that can never match anything (D-025 and the annotation finding).

export const SORTS = ['name', 'origin', 'frame'];

export function facetsOf(tools, { severityOf = null } = {}) {
  const annotations = new Map();
  const origins = new Map();
  const registrations = new Map();
  // Security severities come from the review, not from the tool: the caller hands a lookup.
  const severities = new Map();

  for (const tool of tools) {
    const severity = severityOf ? severityOf(tool) : null;
    if (severity) severities.set(severity, (severities.get(severity) ?? 0) + 1);
    for (const [key, value] of Object.entries(tool.annotations ?? {})) {
      if (value !== true) continue;
      annotations.set(key, (annotations.get(key) ?? 0) + 1);
    }
    origins.set(tool.origin, (origins.get(tool.origin) ?? 0) + 1);
    if (tool.registrationType && tool.registrationType !== 'unknown') {
      registrations.set(tool.registrationType, (registrations.get(tool.registrationType) ?? 0) + 1);
    }
  }

  const toList = (map) => Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    annotations: toList(annotations),
    origins: toList(origins),
    registrations: toList(registrations),
    severities: toList(severities),
  };
}

export function filterTools(tools, { query = '', annotations = [], origins = [], severities = [], severityOf = null, sort = 'name' } = {}) {
  const needle = query.trim().toLowerCase();

  const filtered = tools.filter((tool) => {
    if (needle) {
      const haystack = `${tool.name} ${tool.title ?? ''} ${tool.description} ${tool.origin}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    // Selected annotations are ANDed: "read only AND untrusted" is a narrowing, not a union.
    for (const key of annotations) {
      if (tool.annotations?.[key] !== true) return false;
    }
    if (origins.length > 0 && !origins.includes(tool.origin)) return false;
    if (severities.length > 0 && !severities.includes(severityOf ? severityOf(tool) : null)) return false;
    return true;
  });

  return sortTools(filtered, sort);
}

export function sortTools(tools, sort) {
  const copy = tools.slice();
  if (sort === 'origin') {
    copy.sort((a, b) => a.origin.localeCompare(b.origin) || a.name.localeCompare(b.name));
  } else if (sort === 'frame') {
    // Tools with no frame (an origin Explorer could not enter) sort last, not as frame 0.
    const frameOf = (t) => (t.frameId === null ? Number.MAX_SAFE_INTEGER : t.frameId);
    copy.sort((a, b) => frameOf(a) - frameOf(b) || a.name.localeCompare(b.name));
  } else {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  }
  return copy;
}
