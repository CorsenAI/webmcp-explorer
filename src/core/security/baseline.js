// A posture baseline: the findings and contracts of a site at a moment the person chose, and
// the comparison of a later review against it. "Since baseline" is what makes a re-check
// meaningful: not the whole list again, but what appeared, what went away, which contracts
// moved. Pure JavaScript; bounded so a hostile page cannot grow the record without limit.

import { SEVERITY_RANK, CODES } from './catalog.js';
import { CONTRACT_PARTS } from './contract-lock.js';

// Engine v3 (2026-11-08) and v4 (2026-11-10) added finding codes. A baseline records the engine
// that made it, so a finding whose code did not exist then is shown as a new rule, never as a
// regression of the site.
export const ENGINE_VERSION = 4;
export const ENGINE_V3_CODES = Object.freeze(['declarative-hidden-parameter', 'declarative-credential-field',
  'declarative-param-orphan', 'declarative-post-auto-submit', 'readonly-callback-mutation', 'exposed-to-cross-origin',
  'text-far-over-budget', 'client-secret-exposed', 'output-reflects-input']);
export const ENGINE_V4_CODES = Object.freeze(['contract-changed-in-session']);
const CODES_BEFORE = {
  2: new Set(CODES.filter((code) => !ENGINE_V3_CODES.includes(code) && !ENGINE_V4_CODES.includes(code))),
  3: new Set(CODES.filter((code) => !ENGINE_V4_CODES.includes(code))),
};
const knownAt = (baseline) => (baseline?.engine === ENGINE_VERSION ? null : CODES_BEFORE[baseline?.engine ?? 2] ?? CODES_BEFORE[2]);

export const MAX_BASELINE_FINDINGS = 300;
export const MAX_BASELINE_TOOLS = 1000;

export const findingKey = (f) => `${f.code}|${f.toolName ?? ''}|${f.contractFp ?? ''}`;

// Per-part fingerprints (description, schema, annotations), when the discovery carries them.
const HASH = /^[0-9a-f]{64}$/;
const partsOf = (source) => {
  if (!source || typeof source !== 'object') return null;
  const parts = Object.fromEntries(CONTRACT_PARTS.filter((p) => HASH.test(String(source[p] ?? ''))).map((p) => [p, source[p]]));
  return Object.keys(parts).length ? parts : null;
};

export function makeBaseline(review, discovery, { at = Date.now() } = {}) {
  const tools = (discovery?.tools ?? []).slice(0, MAX_BASELINE_TOOLS).map((t) => ({
    logicalId: t.logicalId ?? null, name: t.name, contractFp: t.contractFp ?? null, origin: t.origin ?? null,
    ...(partsOf(t.contractParts) ? { parts: partsOf(t.contractParts) } : {}),
  }));
  const findings = (review?.findings ?? []).slice(0, MAX_BASELINE_FINDINGS).map((f) => ({
    key: findingKey(f), code: f.code, severity: f.severity, toolName: f.toolName ?? null, contractFp: f.contractFp ?? null,
  }));
  return {
    origin: discovery?.topOrigin ?? null,
    at,
    engine: ENGINE_VERSION,
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
  const known = knownAt(baseline);
  const fresh = (review?.findings ?? []).filter((f) => !baseKeys.has(findingKey(f)));
  const added = known ? fresh.filter((f) => known.has(f.code)) : fresh;
  const newRules = known ? fresh.filter((f) => !known.has(f.code)) : [];

  const nowTools = new Map((discovery?.tools ?? []).map((t) => [t.name, t]));
  const baseTools = new Map(baseline.tools.map((t) => [t.name, t]));
  const toolsAdded = [...nowTools.keys()].filter((n) => !baseTools.has(n)).sort();
  const toolsRemoved = [...baseTools.keys()].filter((n) => !nowTools.has(n)).sort();
  const contractsChanged = [...nowTools.values()]
    .filter((t) => baseTools.has(t.name) && baseTools.get(t.name).contractFp !== (t.contractFp ?? null))
    .map((t) => {
      // Which parts moved; null when the baseline was saved before parts were recorded.
      const before = partsOf(baseTools.get(t.name).parts), after = partsOf(t.contractParts);
      return { name: t.name, from: baseTools.get(t.name).contractFp, to: t.contractFp ?? null,
        parts: before && after ? CONTRACT_PARTS.filter((p) => before[p] && after[p] && before[p] !== after[p]) : null };
    });

  // A baseline finding is resolved only when its tool is still there with the same contract
  // and the finding is gone; a changed contract or a removed tool is reported as such instead.
  const resolved = baseline.findings.filter((f) => !nowKeys.has(f.key)
    && f.toolName && nowTools.has(f.toolName) && (nowTools.get(f.toolName).contractFp ?? null) === f.contractFp);

  let maxAdded = null;
  for (const f of added) if (maxAdded === null || SEVERITY_RANK[f.severity] < SEVERITY_RANK[maxAdded]) maxAdded = f.severity;
  return {
    baselineAt: baseline.at,
    added,
    newRules,
    resolved,
    toolsAdded,
    toolsRemoved,
    contractsChanged,
    maxAdded,
    // A regression is something new a person should look at; informational facts are not one.
    regressed: added.some((f) => f.severity !== 'info'),
    // A reviewed tool whose contract is no longer the one that was reviewed.
    drifted: contractsChanged.length > 0,
  };
}

// What a re-check stores back on the baseline: counts, never the texts (they are recomputed).
export function summarizeDiff(diff, { at = Date.now() } = {}) {
  if (!diff) return null;
  return {
    at,
    added: diff.added.length,
    newRules: diff.newRules?.length ?? 0,
    maxAdded: diff.maxAdded,
    resolved: diff.resolved.length,
    toolsAdded: diff.toolsAdded.length,
    toolsRemoved: diff.toolsRemoved.length,
    contractsChanged: diff.contractsChanged.length,
    descriptionsChanged: diff.contractsChanged.filter((c) => c.parts?.includes('description')).length,
    regressed: diff.regressed,
    drifted: diff.drifted === true,
  };
}

// A baseline as a file: what was reviewed for one site (tool names, fingerprints, finding keys),
// never page text, so it can be kept across a reinstall or handed to a colleague who then gets the
// same "since baseline" comparison. The last re-check is local to a browser and is left out.
export const BASELINE_FILE = Object.freeze({ app: 'webmcp-explorer', kind: 'security-baseline', version: 1 });

export function exportBaseline(baseline, { at = Date.now() } = {}) {
  if (!baseline?.origin) return null;
  const { lastCheckAt, lastDiff, ...reviewed } = baseline;
  return { ...BASELINE_FILE, exportedAt: new Date(at).toISOString(), baseline: reviewed };
}

// Reads such a file for the site being inspected. The file is outside data: every field is checked
// and bounded again, finding keys are rebuilt, and a file made for another site is refused by name.
export function importBaseline(file, { origin } = {}) {
  const none = { error: 'not-a-baseline' };
  if (!file || typeof file !== 'object' || file.app !== BASELINE_FILE.app || file.kind !== BASELINE_FILE.kind || file.version !== BASELINE_FILE.version) return none;
  const b = file.baseline;
  if (!b || typeof b !== 'object' || typeof b.origin !== 'string' || !Array.isArray(b.tools) || !Array.isArray(b.findings) || !Number.isFinite(b.at) || b.at <= 0) return none;
  if (!origin || b.origin !== origin) return { error: 'other-site', origin: b.origin.slice(0, 200) };
  const hash = (value) => (typeof value === 'string' && HASH.test(value) ? value : null);
  const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : null);
  const tools = b.tools.filter((t) => t && typeof t === 'object' && typeof t.name === 'string' && t.name).slice(0, MAX_BASELINE_TOOLS)
    .map((t) => ({ logicalId: text(t.logicalId, 2000), name: t.name.slice(0, 300), contractFp: hash(t.contractFp), origin: text(t.origin, 300),
      ...(partsOf(t.parts) ? { parts: partsOf(t.parts) } : {}) }));
  const findings = b.findings
    .filter((f) => f && typeof f === 'object' && typeof f.code === 'string' && f.code && SEVERITY_RANK[f.severity] !== undefined)
    .slice(0, MAX_BASELINE_FINDINGS)
    .map((f) => {
      const entry = { code: f.code.slice(0, 80), severity: f.severity, toolName: text(f.toolName, 300), contractFp: hash(f.contractFp) };
      return { key: findingKey(entry), ...entry };
    });
  return { baseline: { origin, at: b.at, engine: Number.isInteger(b.engine) ? b.engine : 2, tools, findings,
    truncated: b.truncated === true || b.tools.length > MAX_BASELINE_TOOLS || b.findings.length > MAX_BASELINE_FINDINGS, lastCheckAt: null, lastDiff: null } };
}
