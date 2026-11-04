// D-136: a versioned heuristic, never an execution permission or a security certification.
// One deduction per rule/tool instance (highest severity); no reward for hiding/reviewing a
// finding, adding clean tools or skipping an opt-in scan. Legacy findings still count.
export const SCORE_WEIGHTS = Object.freeze({ critical: 40, high: 20, medium: 10, low: 5, info: 0 });
export function securityScore({ findings = [], coverage = {} } = {}) {
  const groups = new Map();
  for (const f of findings) {
    const key = JSON.stringify([f.ruleId ?? f.code, f.instanceId ?? f.logicalId ?? [f.origin, f.frameId, f.toolName]]);
    const points = SCORE_WEIGHTS[f.severity] ?? 0;
    if (points > (groups.get(key)?.points ?? 0)) groups.set(key, { key, ruleId: f.ruleId ?? null, code: f.code,
      toolName: f.toolName ?? null, severity: f.severity, points });
  }
  const deductions = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
  const critical = deductions.some(d => d.severity === 'critical');
  const value = coverage.tools > 0 ? Math.max(0, Math.min(critical ? 49 : 100, 100 - deductions.reduce((n, d) => n + d.points, 0))) : null;
  return { version: 1, value, grade: value === null ? null : value >= 90 ? 'A' : value >= 80 ? 'B' : value >= 70 ? 'C' : value >= 60 ? 'D' : value >= 50 ? 'E' : 'F',
    provisional: true, certification: false, weights: SCORE_WEIGHTS, criticalCap: 49,
    deductions, unknownChecks: (coverage.notObservable ?? []).length };
}
