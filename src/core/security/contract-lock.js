// Contract fingerprints over time: a document that records the fingerprint of every tool a page
// exposed, and the comparison of a later observation against it. A tool whose contract moved after
// it was reviewed (a description rewritten by a third-party script, a schema loosened) is the case
// this exists for. Fingerprints are only comparable between two observations made the same way:
// the public scanner and the extension do not see the same schema and annotation forms.
// Pure JavaScript; bounded so a hostile page or file cannot grow the result without limit.

export const LOCK_FORMAT = 'webmcp-contracts/1';
export const CONTRACT_PARTS = Object.freeze(['description', 'schema', 'annotations']);
export const MAX_LOCK_TOOLS = 1000;
const NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const HASH = /^[0-9a-f]{64}$/;

const validEntry = (t) => t && typeof t === 'object' && typeof t.name === 'string' && NAME.test(t.name) && HASH.test(String(t.contract ?? ''));

// tools: [{ name, contract, description?, schema?, annotations?, surface? }]. Sorted by name so the
// document is stable from one observation to the next.
export function contractsDocument({ page = null, observer = null, at = null, tools = [] } = {}) {
  const entries = tools.filter(validEntry).slice(0, MAX_LOCK_TOOLS).map((t) => ({
    name: t.name, ...(typeof t.surface === 'string' ? { surface: t.surface.slice(0, 40) } : {}), contract: t.contract,
    ...Object.fromEntries(CONTRACT_PARTS.filter((part) => HASH.test(String(t[part] ?? ''))).map((part) => [part, t[part]])),
  })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { format: LOCK_FORMAT, page, observer, generatedAt: at, tools: entries };
}

const index = (doc) => {
  const map = new Map();
  let invalid = 0;
  for (const t of Array.isArray(doc?.tools) ? doc.tools.slice(0, MAX_LOCK_TOOLS) : []) {
    if (validEntry(t) && !map.has(t.name)) map.set(t.name, t); else invalid += 1;
  }
  return { map, invalid };
};

// base: the reviewed document; now: the current one. `changed` names the parts that moved, or an
// empty list when the reviewed document predates per-part fingerprints. `missing` is a tool that
// was reviewed and is not observed now: not a contract change, and often only a tool that
// registers later or behind a login.
export function diffContracts(base, now) {
  const comparable = base?.format === LOCK_FORMAT && now?.format === LOCK_FORMAT;
  const a = index(base), b = index(now);
  const names = (list) => list.sort();
  const added = names([...b.map.keys()].filter((n) => !a.map.has(n)));
  const missing = names([...a.map.keys()].filter((n) => !b.map.has(n)));
  const changed = names([...b.map.keys()].filter((n) => a.map.has(n) && a.map.get(n).contract !== b.map.get(n).contract)).map((name) => ({
    name, parts: CONTRACT_PARTS.filter((part) => HASH.test(String(a.map.get(name)[part] ?? '')) && HASH.test(String(b.map.get(name)[part] ?? ''))
      && a.map.get(name)[part] !== b.map.get(name)[part]),
  }));
  return { comparable, added, missing, changed, invalid: a.invalid + b.invalid, drift: added.length > 0 || changed.length > 0 };
}
