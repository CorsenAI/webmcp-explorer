// The security review as a record (JSON) and as an argument (Markdown): the Markdown opens on
// the highest severity, states the coverage and what could not be observed, then every finding
// with its evidence, sources and provisional score (D-136). Pure JavaScript.

import { ISO, slug, stamp, fence } from './text.js';
import { mdCode, mdText, safeLink, jsonText, visible } from './safe.js';
import { securitySarif } from './sarif.js';
import { securityScore } from '../security/score.js';
import { SEVERITY } from '../security/catalog.js';
const order=(a,b)=>String(a??'')<String(b??'')?-1:String(a??'')>String(b??'')?1:0;

export function securityReport(review, discovery, { at = Date.now(), texts = null } = {}) {
  const origin = discovery?.topOrigin ?? 'unknown-origin';
  const say = (code, part, fallback) => (texts ? texts(code, part) : null) ?? fallback;
  const findings = [...(review?.findings ?? [])].sort((a,b)=>SEVERITY.indexOf(a.severity)-SEVERITY.indexOf(b.severity)||order(a.toolName,b.toolName)||order(a.code,b.code)||order(a.evidence?.path,b.evidence?.path));

  const json = {
    kind: 'webmcp-explorer/security-review',
    version: 2,
    observedAt: ISO(at),
    origin,
    page: discovery?.url ?? null,
    coverage: review?.coverage ?? null,
    bySeverity: review?.bySeverity ?? null,
    // Score is recalculated from the exported evidence, including opt-in findings.
    method: 'Observed facts and labelled indicators with evidence and sources. The provisional Explorer heuristic score is not a security certification or an authorization to execute tools.',
    score: securityScore(review),
    findings: findings.map((f) => ({
      code: f.code,
      id: f.ruleId ?? null,
      ruleId: f.ruleId ?? null,
      owasp: f.owasp ?? [],
      severityLevel: f.severity.toUpperCase(),
      remediationCodeSnippet: f.remediationCodeSnippet ?? null,
      remediation: f.remediation ?? null,
      title: say(f.code, 'title', f.code),
      severity: f.severity,
      nature: f.nature,
      axis: f.axis,
      tool: f.toolName,
      frameId: f.frameId,
      origin: f.origin,
      contractFingerprint: f.contractFp,
      evidence: f.evidence,
      detail: f.detail,
      why: say(f.code, 'why', null),
      fix: say(f.code, 'fix', null),
      sources: f.refs.map((r) => ({ id: r.id, label: r.label, url: r.url })),
      reviewed: Boolean(f.reviewed),
    })),
  };

  const counts = SEVERITY.map((s) => `${review?.bySeverity?.[s] ?? 0} ${s}`).join(', ');
  const lines = [
    `# WebMCP security review — ${mdCode(origin)}`,
    '',
    `Observed ${ISO(at)} — ${findings.length} finding${findings.length === 1 ? '' : 's'} (${counts}) over ${review?.coverage?.tools ?? 0} tool${review?.coverage?.tools === 1 ? '' : 's'}, ${review?.coverage?.rules ?? 0} rules.`,
    '',
    '> Findings are observed facts or labelled indicators, each with its exact evidence and sources. '
    + 'An indicator is a pattern, not a proven attack. The provisional heuristic score is not a security certification.',
    '',
    `Provisional score: ${json.score.value === null ? 'not available (no tools)' : `${json.score.value}/100 · ${json.score.grade}`}. Formula v1: start at 100, deduct the highest severity per rule/tool (critical 40, high 20, medium 10, low 5, info 0); critical cap 49; floor 0. Grades: A ≥90, B ≥80, C ≥70, D ≥60, E ≥50, F <50.`,
  ];
  const notObservable = review?.coverage?.notObservable ?? [];
  if (notObservable.length) {
    lines.push('', '## Not observable in this review', '');
    for (const n of notObservable) lines.push(`- ${mdCode(n.code)} (${mdText(n.reason)})${n.detail ? `: ${mdCode([].concat(n.detail).join(', '))}` : ''}`);
  }
  if (!findings.length) {
    lines.push('', 'Nothing flagged.');
  } else {
    lines.push('', '| Severity | Nature | Finding | Tool | Evidence |', '| --- | --- | --- | --- | --- |');
    for (const f of json.findings) {
      lines.push(`| ${f.severity} | ${f.nature} | ${mdText(f.title)} | ${f.tool ? mdCode(f.tool) : 'page'} | ${mdCode(f.evidence?.excerpt ?? '')} |`);
    }
    lines.push('', '## Findings', '');
    for (const f of json.findings) {
      lines.push(`### ${f.severity} · ${mdText(f.title)}${f.tool ? ` — ${mdCode(f.tool)}` : ''}`, '');
      lines.push(`Code \`${f.code}\` · ${f.nature} · ${f.axis}${f.frameId !== null && f.frameId !== undefined ? ` · frame #${f.frameId}` : ''}${f.reviewed ? ' · marked reviewed' : ''}`, '');
      if (f.evidence?.path) lines.push(`Where: ${mdCode(f.evidence.path)}`, '');
      if (f.evidence?.excerpt) lines.push(fence(visible(f.evidence.excerpt)), '');
      if (f.why) lines.push(mdText(f.why), '');
      if (f.fix) lines.push(`**What to do.** ${mdText(f.fix)}`, '');
      if (f.ruleId) lines.push(`Rule: ${f.ruleId} · Explorer mapping: ${f.owasp.join(', ')}`, '');
      if (f.remediationCodeSnippet) lines.push('<details>', '<summary>Proposed fix — review required; never applied automatically</summary>', '', fence(f.remediationCodeSnippet.replace(/[\u034f\u2028\u2029\p{Cf}]/gu,visible), 'javascript'), '', '</details>', '');
      lines.push('Sources:', ...f.sources.map(s=>safeLink(s.url)?`- [${mdText(s.label)}](${safeLink(s.url)})`:`- ${mdCode(s.label)}`), '');
    }
  }
  return {
    filename: `webmcp-security_${slug(origin, 'page')}_${stamp(at)}`,
    json,
    sarif: jsonText(securitySarif({...review,findings},discovery),2)+'\n',
    markdown: `${lines.join('\n').trimEnd()}\n`,
  };
}
