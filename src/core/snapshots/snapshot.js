// Capturing what a page exposed, so it can be compared with what it exposes later.
//
// A WebMCP tool list is a contract with every agent that visits the page, and it changes
// without anyone noticing: a description gets reworded, a field becomes required, a tool moves
// into a different frame. Explorer already computes a fingerprint of that contract for each
// tool (D-025); a snapshot is that fingerprint plus enough of the tool to say *what* moved.
//
// Pure JavaScript: no chrome.*, no clock of its own.

export const SNAPSHOT_VERSION = 1;

// The fields that make up the contract, and nothing else. A snapshot deliberately does not
// keep frameId — it is a runtime number that changes on every load and would report a
// difference where the contract is identical (D-016).
function capture(tool) {
  return {
    name: tool.name,
    title: tool.title ?? '',
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? null,
    schemaError: tool.schemaError ?? null,
    annotations: tool.annotations ?? {},
    origin: tool.origin ?? null,
    frameKey: tool.frameKey ?? null,
    logicalId: tool.logicalId,
    contractFp: tool.contractFp ?? null,
    notInjected: Boolean(tool.notInjected),
  };
}

export function createSnapshot(discovery, { at = Date.now(), label = null } = {}) {
  const tools = (discovery?.tools ?? [])
    // An override changes what Explorer shows, not what the page declares. Snapshotting the
    // rewritten version would make a later diff report a change the site never made.
    .map((tool) => capture(tool.overridden
      ? {
        ...tool,
        description: tool.originalDescription ?? tool.description,
        inputSchema: tool.originalInputSchema ?? tool.inputSchema,
      }
      : tool))
    .sort((a, b) => (a.origin ?? '').localeCompare(b.origin ?? '')
      || a.name.localeCompare(b.name));

  return {
    version: SNAPSHOT_VERSION,
    id: `snap_${at.toString(36)}`,
    label,
    takenAt: at,
    origin: discovery?.topOrigin ?? null,
    // Saying the capture was partial is what stops a later diff from announcing that half the
    // page's tools were removed (D-023).
    complete: discovery?.completeness?.complete ?? null,
    notObserved: discovery?.completeness?.reasons ?? [],
    tools,
  };
}

// True when a diff against this snapshot could invent removals that never happened.
export function isTrustworthy(snapshot) {
  return snapshot?.complete !== false;
}
