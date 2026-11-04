// Execution history, performance summaries and replay eligibility.
// Pure JavaScript: no chrome.* API, no storage — persistence lives elsewhere.
//
// An entry freezes the tool contract as it was at call time. That is what makes an old call
// readable, diffable and replayable after the page changed, and what lets Explorer say
// "this tool's schema changed since you ran this" instead of silently replaying against a
// contract that no longer exists (ARCHITECTURE section 2).

const DEFAULT_MAX_ENTRIES = 500;

export function createEntry({ tool, args, outcome, at = Date.now(), id }) {
  return {
    id: id ?? cryptoId(),
    at,
    logicalId: tool.logicalId,
    contractFp: tool.contractFp,
    toolName: tool.name,
    origin: tool.origin,
    frameId: tool.frameId ?? null,
    args: deepFreezeCopy(args ?? {}),
    ok: outcome.ok === true,
    code: outcome.code ?? null,
    error: outcome.error ?? null,
    result: outcome.result ?? null,
    durationMs: typeof outcome.durationMs === 'number' ? outcome.durationMs : null,
    roundTripMs: typeof outcome.roundTripMs === 'number' ? outcome.roundTripMs : null,
    argsEncoding: outcome.argsEncoding ?? null,
    callId: outcome.callId ?? null, engine: outcome.engine ?? null,
    dispatchState: outcome.dispatchState ?? null, effectState: outcome.effectState ?? null,
    attempts: outcome.attempts ?? null,
    // A call made by an active security probe (S2) names its probe; a later reader must not
    // take it for something the person typed.
    probe: typeof outcome.probe === 'string' ? outcome.probe : null,
    // A result served by a local override never reached the page; a later reproduction must know.
    mocked: outcome.mocked === true,
    mockMode: outcome.mocked === true ? (outcome.mockMode ?? null) : null,
    // A copy, not a reference: the live tool object keeps changing underneath us.
    contractSnapshot: {
      description: tool.description ?? '',
      inputSchema: deepFreezeCopy(tool.inputSchema ?? null),
      annotations: deepFreezeCopy(tool.annotations ?? {}),
    },
  };
}

export function summarize(entries) {
  const groups = new Map();

  for (const entry of entries) {
    let group = groups.get(entry.logicalId);
    if (!group) {
      group = {
        logicalId: entry.logicalId,
        toolName: entry.toolName,
        origin: entry.origin,
        calls: 0,
        failures: 0,
        timed: 0,
        durations: [],
        lastAt: 0,
      };
      groups.set(entry.logicalId, group);
    }
    group.calls += 1;
    if (!entry.ok) group.failures += 1;
    if (typeof entry.durationMs === 'number') {
      group.timed += 1;
      group.durations.push(entry.durationMs);
    }
    group.lastAt = Math.max(group.lastAt, entry.at);
  }

  return Array.from(groups.values()).map((group) => {
    const sorted = group.durations.slice().sort((a, b) => a - b);
    return {
      logicalId: group.logicalId,
      toolName: group.toolName,
      origin: group.origin,
      calls: group.calls,
      failures: group.failures,
      timed: group.timed,
      successRate: Math.round(((group.calls - group.failures) / group.calls) * 100),
      min: sorted.length ? sorted[0] : null,
      max: sorted.length ? sorted[sorted.length - 1] : null,
      average: sorted.length
        ? Math.round(sorted.reduce((sum, n) => sum + n, 0) / sorted.length)
        : null,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      lastAt: group.lastAt,
    };
  }).sort((a, b) => b.calls - a.calls || a.toolName.localeCompare(b.toolName));
}

// Resolves the ONE live instance a recorded call would replay against, and judges it. The
// target is returned so the screen that shows the verdict and the code that runs the replay
// use the same instance (D-057): two frames may own the same logical tool (D-056), and a call
// recorded in one must never be quietly re-run in the other.
//
//  - the frame the call was made in still owns the tool → that instance;
//  - that frame is gone and exactly one instance owns the tool → that one (frame ids change on
//    every load, so a lone instance under a new id is the same tool);
//  - that frame is gone and several instances own the tool → ambiguous, no replay.
export function replayability(entry, currentTools) {
  const owners = currentTools.filter((tool) => tool.logicalId === entry.logicalId);
  const sameFrame = owners.find((tool) => tool.frameId === (entry.frameId ?? null));
  const live = sameFrame ?? (owners.length === 1 ? owners[0] : null);

  if (owners.length === 0) {
    return {
      status: 'gone',
      canReplay: false,
      target: null,
      message: 'This tool is no longer registered on the page.',
    };
  }

  if (!live) {
    return {
      status: 'ambiguous',
      canReplay: false,
      target: null,
      message: `This call was made in a frame that is gone, and ${owners.length} frames now own this tool. Open the instance you mean and run it from there.`,
    };
  }

  if (live.contractFp !== entry.contractFp) {
    return {
      status: 'contract-changed',
      canReplay: true,
      target: live,
      message: 'The tool contract changed since this call. Arguments may no longer validate.',
    };
  }

  return { status: 'exact', canReplay: true, target: live, message: '' };
}

export function trimHistory(entries, { maxEntries = DEFAULT_MAX_ENTRIES, maxAgeMs, now = Date.now() } = {}) {
  let kept = entries;
  if (typeof maxAgeMs === 'number') {
    kept = kept.filter((entry) => now - entry.at <= maxAgeMs);
  }
  if (kept.length <= maxEntries) return kept.slice();
  return kept.slice(kept.length - maxEntries);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function deepFreezeCopy(value) {
  if (value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function cryptoId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
