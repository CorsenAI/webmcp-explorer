// Comparing two snapshots of a page's WebMCP contract.
//
// The hard part is not spotting a difference, it is not inventing one. Four ways a naive diff
// lies about a page:
//
//  - A tool that moved to another frame gets a new logicalId, so matching on identity alone
//    reports one removal and one addition where the site changed nothing.
//  - A partial capture on either side makes every unobserved tool look deleted.
//  - A schema compared as text reports a change when only the key order moved.
//  - A logicalId can be owned by several live instances at once — two iframes loading the same
//    URL (D-056) — whose contracts may differ; keeping only the last one written hides a change
//    in the others and makes the verdict depend on array order (D-057).
//
// Pure JavaScript: no chrome.*.

export const CHANGE = {
  added: 'added',
  removed: 'removed',
  moved: 'moved',
  changed: 'changed',
  unchanged: 'unchanged',
};

// A stable serialisation, so two structurally identical schemas compare equal whatever order
// their keys arrived in.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

function detailsOf(before, after) {
  const details = [];
  // Snapshots taken before titles were recorded have none; an empty title on both sides is
  // not a change.
  if ((before.title ?? '') !== (after.title ?? '')) details.push('title');
  if ((before.description ?? '') !== (after.description ?? '')) details.push('description');
  if (canonical(before.inputSchema) !== canonical(after.inputSchema)) details.push('schema');
  if (canonical(before.annotations) !== canonical(after.annotations)) details.push('annotations');
  if ((before.schemaError ?? null) !== (after.schemaError ?? null)) details.push('schema-error');
  return details;
}

// How two snapshots are matched up. `identity` is the same page over time: the logicalId (top
// origin, frame path, name) says which tool is which, and leftovers are re-paired by origin and
// name to spot a tool that moved frame. `name` is the same page across environments — localhost
// against staging, staging against production — where every logicalId differs because the top
// origin does: tools are matched by frame path and name, leftovers by name alone, and a
// different origin is the premise of the comparison, not a change.
export const MATCH = { identity: 'identity', name: 'name' };

function keyFns(matchBy) {
  if (matchBy === MATCH.name) {
    return {
      identity: (tool) => `${tool.frameKey ?? ''}\u0000${tool.name}`,
      place: (tool) => tool.name,
    };
  }
  return {
    identity: (tool) => tool.logicalId,
    place: (tool) => `${tool.origin ?? ''}\u0000${tool.name}`,
  };
}

// Every variant of a key is kept, never the last one written.
function index(tools = [], keys) {
  const byId = new Map();
  const byPlace = new Map();
  for (const tool of tools) {
    const id = keys.identity(tool);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(tool);
    const place = keys.place(tool);
    if (!byPlace.has(place)) byPlace.set(place, []);
    byPlace.get(place).push(tool);
  }
  return { byId, byPlace };
}

function sameContract(x, y) {
  if (x.contractFp && y.contractFp) return x.contractFp === y.contractFp;
  return detailsOf(x, y).length === 0;
}

function comparison(beforeTool, afterTool) {
  const details = detailsOf(beforeTool, afterTool);
  // The fingerprint is the authority on whether the contract changed; the details say what,
  // and a disagreement between the two is worth surfacing rather than hiding.
  const fingerprintMoved = Boolean(beforeTool.contractFp && afterTool.contractFp
    && beforeTool.contractFp !== afterTool.contractFp);
  return {
    name: afterTool.name,
    origin: afterTool.origin,
    change: details.length || fingerprintMoved ? CHANGE.changed : CHANGE.unchanged,
    details,
    fingerprintChanged: fingerprintMoved,
    before: beforeTool,
    after: afterTool,
  };
}

const removal = (beforeTool) => ({
  name: beforeTool.name,
  origin: beforeTool.origin,
  change: CHANGE.removed,
  details: [],
  fingerprintChanged: false,
  before: beforeTool,
  after: null,
});

const addition = (afterTool) => ({
  name: afterTool.name,
  origin: afterTool.origin,
  change: CHANGE.added,
  details: [],
  fingerprintChanged: false,
  before: null,
  after: afterTool,
});

export function diffSnapshots(before, after, { matchBy = MATCH.identity } = {}) {
  const keys = keyFns(matchBy);
  const a = index(before?.tools, keys);
  const b = index(after?.tools, keys);

  const entries = [];

  // Same identity: the tool is in the same place under the same name. Variants that kept
  // their contract are paired first, whatever their position in either array; what is left is
  // paired in order and reported as changed; a variant with no counterpart is a removal or an
  // addition of that variant.
  for (const [id, beforeVariants] of a.byId) {
    const afterVariants = b.byId.get(id);
    if (!afterVariants) continue;
    const remainingAfter = [...afterVariants];
    const unpairedBefore = [];
    for (const beforeTool of beforeVariants) {
      const i = remainingAfter.findIndex((afterTool) => sameContract(beforeTool, afterTool));
      if (i >= 0) {
        entries.push(comparison(beforeTool, remainingAfter[i]));
        remainingAfter.splice(i, 1);
      } else {
        unpairedBefore.push(beforeTool);
      }
    }
    while (unpairedBefore.length > 0 && remainingAfter.length > 0) {
      entries.push(comparison(unpairedBefore.shift(), remainingAfter.shift()));
    }
    for (const beforeTool of unpairedBefore) entries.push(removal(beforeTool));
    for (const afterTool of remainingAfter) entries.push(addition(afterTool));
  }

  const leftBefore = [...a.byId.values()].flat().filter((tool) => !b.byId.has(keys.identity(tool)));
  const leftAfter = [...b.byId.values()].flat().filter((tool) => !a.byId.has(keys.identity(tool)));

  // Same name and origin, different frame: the site moved it, it did not delete and recreate
  // it. Reporting that as a removal plus an addition would be technically defensible and
  // practically useless.
  const usedAfter = new Set();
  for (const beforeTool of leftBefore) {
    const place = keys.place(beforeTool);
    const candidate = (b.byPlace.get(place) ?? [])
      .find((tool) => !a.byId.has(keys.identity(tool)) && !usedAfter.has(tool));
    if (!candidate) {
      entries.push(removal(beforeTool));
      continue;
    }
    usedAfter.add(candidate);
    const details = detailsOf(beforeTool, candidate);
    entries.push({
      name: candidate.name,
      origin: candidate.origin,
      change: CHANGE.moved,
      details,
      movedFrom: beforeTool.frameKey,
      movedTo: candidate.frameKey,
      fingerprintChanged: Boolean(beforeTool.contractFp && candidate.contractFp
        && beforeTool.contractFp !== candidate.contractFp),
      before: beforeTool,
      after: candidate,
    });
  }

  for (const afterTool of leftAfter) {
    if (usedAfter.has(afterTool)) continue;
    entries.push(addition(afterTool));
  }

  entries.sort((x, y) => x.name.localeCompare(y.name));

  const counts = Object.fromEntries(Object.values(CHANGE).map((k) => [k, 0]));
  for (const entry of entries) counts[entry.change] += 1;

  // A partial capture on either side means an absence proves nothing. The diff still reports
  // what it saw, but it says the removals cannot be trusted rather than quietly asserting them.
  const partial = before?.complete === false || after?.complete === false;

  return {
    matchBy,
    from: { id: before?.id ?? null, label: before?.label ?? null, takenAt: before?.takenAt ?? null, origin: before?.origin ?? null },
    to: { id: after?.id ?? null, label: after?.label ?? null, takenAt: after?.takenAt ?? null, origin: after?.origin ?? null },
    entries,
    counts,
    changed: counts.added + counts.removed + counts.moved + counts.changed > 0,
    // Removals are the claim a partial capture cannot support; additions and changes are still
    // real, because something was actually seen.
    removalsUncertain: partial && counts.removed > 0,
    partial,
    notObserved: [...new Set([
      ...(before?.notObserved ?? []),
      ...(after?.notObserved ?? []),
    ])],
  };
}
