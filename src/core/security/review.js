// The security and governance review of one discovery: every rule over every tool, the page
// rules, and a coverage block that says what was evaluated and what could not be observed.
// Deterministic with bounded schema and pair work. No chrome.*, network or execution (D-136).

import { CODES, SEVERITY, SEVERITY_RANK } from './catalog.js';
import { reviewText } from './description-injection.js';
import { reviewGovernance } from './annotations-governance.js';
import { reviewSchema } from './schema-privacy.js';
import { reviewSurface, reviewSurfacePage, surfaceCoverage } from './surface-provenance.js';
import { reviewLifecycle, lifecycleCoverage } from './lifecycle.js';
import { reviewPhaseB } from './phase-b.js';
import { withRule, RULES } from './rules.js';
import { securityScore } from './score.js';
import { quickFix } from './quick-fix.js';
import { reviewEnvironment } from './environment.js';
import { reviewDeclarative } from './declarative-integrity.js';
import { reviewCallbackSource, callbackCoverage } from './callback-source.js';
import { reviewExposure } from './exposure.js';

export function reviewSecurity({ discovery, events = [], originScan = null, extraFindings = [] } = {}) {
  const tools = discovery?.tools ?? [];
  let findings = [];
  for (const tool of tools) {
    findings.push(...reviewText(tool), ...reviewGovernance(tool), ...reviewSchema(tool).filter(f => f.code !== 'unbounded-string'), ...reviewSurface(tool, discovery),
      ...reviewExposure(tool), ...reviewCallbackSource(tool));
  }
  // Declarative integrity reads the findings above, so a credential field is never reported twice.
  for (const tool of tools) findings.push(...reviewDeclarative(tool, { prior: findings }));
  findings.push(...reviewSurfacePage(discovery), ...reviewLifecycle(tools, events), ...reviewEnvironment(discovery));

  const phaseB = reviewPhaseB(tools, { prior: findings, originScan });
  findings.push(...phaseB.findings, ...(originScan?.findings ?? []), ...extraFindings);
  const fixCache = new Map();
  findings = findings.map(f => {
    const enriched = withRule(f);
    if (!enriched.ruleId) return enriched;
    const tool = tools.find(t => (t.instanceId ?? null) === f.instanceId && t.name === f.toolName && (t.frameId ?? null) === f.frameId) ?? null;
    const key = JSON.stringify([enriched.ruleId, tool?.instanceId, tool?.name, tool?.frameId, tool?.origin]);
    if (!fixCache.has(key)) fixCache.set(key, quickFix(enriched, tool));
    const fix = fixCache.get(key);
    return { ...enriched, remediationCodeSnippet: fix.code, remediation: fix };
  });

  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || String(a.toolName ?? '').localeCompare(String(b.toolName ?? ''))
    || a.code.localeCompare(b.code));

  const bySeverity = Object.fromEntries(SEVERITY.map((s) => [s, 0]));
  const byTool = new Map();
  for (const f of findings) {
    bySeverity[f.severity] += 1;
    const key = f.instanceId ?? f.logicalId ?? f.toolName ?? '__page__';
    if (!byTool.has(key)) byTool.set(key, []);
    byTool.get(key).push(f);
  }

  const notObservable = [...surfaceCoverage(discovery), ...lifecycleCoverage(events), ...phaseB.notObservable, ...callbackCoverage(tools)];
  const review = {
    findings,
    bySeverity,
    byTool,
    coverage: {
      tools: tools.length,
      rules: CODES.length,
      ruleIds: Object.keys(RULES),
      originScan: originScan ? 'requested' : 'not-run',
      findings: findings.length,
      indicators: findings.filter((f) => f.nature === 'indicator').length,
      observed: findings.filter((f) => f.nature === 'observed').length,
      notObservable,
    },
  };
  review.score = securityScore(review);
  return review;
}

// The highest severity a tool carries, for its card badge; null when it carries none.
export function maxSeverity(list = []) {
  let best = null;
  for (const f of list) if (best === null || SEVERITY_RANK[f.severity] < SEVERITY_RANK[best]) best = f.severity;
  return best;
}
