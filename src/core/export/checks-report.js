// The record of one "Run all checks for this site": which saved checks passed, which failed
// and why, with the arguments and results, as JSON for a CI step and Markdown for a review.
// Pure JavaScript: no chrome.*, no DOM.

import { ISO, slug, stamp, fence, cell } from './text.js';

export function checksReport(results, { origin = null, at = Date.now() } = {}) {
  const json = {
    kind: 'webmcp-explorer/checks',
    version: 1,
    observedAt: ISO(at),
    origin,
    counts: {
      pass: results.filter((r) => r.judgement.verdict === 'pass').length,
      fail: results.filter((r) => r.judgement.verdict === 'fail').length,
      noVerdict: results.filter((r) => r.judgement.verdict === 'not-a-check').length,
    },
    checks: results.map((r) => ({
      tool: r.saved.toolName,
      name: r.saved.name,
      frameId: r.target?.frameId ?? null,
      expect: r.saved.expect,
      args: r.saved.args,
      verdict: r.judgement.verdict,
      reason: r.judgement.reason,
      ...(r.judgement.rules ? { rules: r.judgement.rules } : {}),
      ok: r.outcome?.ok ?? null,
      result: r.outcome?.result ?? null,
      error: r.outcome?.error ?? null,
      durationMs: Number.isFinite(r.outcome?.durationMs) ? r.outcome.durationMs : null,
      argsEncoding: r.outcome?.argsEncoding ?? null,
    })),
  };

  const lines = [
    `# Saved checks${origin ? ` on ${origin}` : ''}`,
    '',
    `Run ${ISO(at)} — ${json.counts.pass} passed, ${json.counts.fail} failed, ${json.counts.noVerdict} without verdict.`,
    '',
    '| Tool | Check | Verdict | Why |',
    '| --- | --- | --- | --- |',
  ];
  for (const check of json.checks) {
    lines.push(`| \`${cell(check.tool)}\` | ${cell(check.name)} | ${check.verdict} | ${cell(check.reason)} |`);
  }
  for (const check of json.checks.filter(c => c.expect?.kind === 'fields')) {
    lines.push('', `## Field rules — ${check.name}`, '', 'Definition:', '', fence(JSON.stringify(check.expect, null, 2), 'json'), '');
    for (const rule of check.rules ?? []) lines.push(`- ${rule.pass ? 'PASS' : 'FAIL'}: ${rule.reason}`);
  }
  const failed = json.checks.filter((c) => c.verdict === 'fail');
  if (failed.length) {
    lines.push('', '## What failed', '');
    for (const check of failed) {
      lines.push(`### \`${check.tool}\` — ${check.name}`, '', 'Arguments:', '', fence(JSON.stringify(check.args, null, 2), 'json'), '');
      if (check.error) lines.push(`Error: ${check.error}`, '');
      else lines.push('Result:', '', fence(check.result ?? '', ''), '');
    }
  }
  return {
    filename: `webmcp-checks_${slug(origin)}_${stamp(at)}`,
    json,
    markdown: `${lines.join('\n').trimEnd()}\n`,
  };
}
