// A posture baseline: the findings and contracts of a site at a moment the person chose, and
// the comparison of a later review against it. "Since baseline" is what makes a re-check
// meaningful: not the whole list again, but what appeared, what went away, which contracts
// moved. Pure JavaScript; bounded so a hostile page cannot grow the record without limit.

import { SEVERITY_RANK } from './catalog.js';

export const MAX_BASELINE_FINDINGS = 300;
export const MAX_BASELINE_TOOLS = 1000;

export const findingKey = (f) => `${f.code}|${f.toolName ?? ''}|${f.contractFp ?? ''}`;

export function makeBaseline(review, discovery, { at = Date.now() } = {}) {
  const tools = (discovery?.tools ?? []).slice(0, MAX_BASELINE_TOOLS).map((t) => ({
    logicalId: t.logicalId ?? null, name: t.name, contractFp: t.contractFp ?? null, origin: t.origin ?? null,
  }));
  const findings = (review?.findings ?? []).slice(0, MAX_BASELINE_FINDINGS).map((f) => ({
    key: findingKey(f), code: f.code, severity: f.severity, toolName: f.toolName ?? null, contractFp: f.contractFp ?? null,
  }));
  return {
    origin: discovery?.topOrigin ?? null,
    at,
    tools,
    findings,
    truncated: (review?.findings?.length ?? 0) > MAX_BASELINE_FINDINGS || (discovery?.tools?.length ?? 0) > MAX_BASELINE_TOOLS,
    // Filled by re-checks: when the site was last looked at, and what that look found.
    lastCheckAt: null,
    lastDiff: null,
  };
}

export function diffBaseline(baseline, review, discovery) {
  if (!baseline) return null;
  const nowKeys = new Set((review?.findings ?? []).map(findingKey));
  const baseKeys = new Set(baseline.findings.map((f) => f.key));
  const added = (review?.findings ?? []).filter((f) => !baseKeys.has(findingKey(f)));

  const nowTools = new Map((discovery?.tools ?? []).map((t) => [t.name, t]));
  const baseTools = new Map(baseline.tools.map((t) => [t.name, t]));
  const toolsAdded = [...nowTools.keys()].filter((n) => !baseTools.has(n)).sort();
  const toolsRemoved = [...baseTools.keys()].filter((n) => !nowTools.has(n)).sort();
  const contractsChanged = [...nowTools.values()]
    .filter((t) => baseTools.has(t.name) && baseTools.get(t.name).contractFp !== (t.contractFp ?? null))
    .map((t) => ({ name: t.name, from: baseTools.get(t.name).contractFp, to: t.contractFp ?? null }));

  // A baseline finding is resolved only when its tool is still there with the same contract
  // and the finding is gone; a changed contract or a removed tool is reported as such instead.
  const resolved = baseline.findings.filter((f) => !nowKeys.has(f.key)
    && f.toolName && nowTools.has(f.toolName) && (nowTools.get(f.toolName).contractFp ?? null) === f.contractFp);

  let maxAdded = null;
  for (const f of added) if (maxAdded === null || SEVERITY_RANK[f.severity] < SEVERITY_RANK[maxAdded]) maxAdded = f.severity;
  return {
    baselineAt: baseline.at,
    added,
    resolved,
    toolsAdded,
    toolsRemoved,
    contractsChanged,
    maxAdded,
    // A regression is something new a person should look at; informational facts are not one.
    regressed: added.some((f) => f.severity !== 'info'),
  };
}

// What a re-check stores back on the baseline: counts, never the texts (they are recomputed).
export function summarizeDiff(diff, { at = Date.now() } = {}) {
  if (!diff) return null;
  return {
    at,
    added: diff.added.length,
    maxAdded: diff.maxAdded,
    resolved: diff.resolved.length,
    toolsAdded: diff.toolsAdded.length,
    toolsRemoved: diff.toolsRemoved.length,
    contractsChanged: diff.contractsChanged.length,
    regressed: diff.regressed,
  };
}
