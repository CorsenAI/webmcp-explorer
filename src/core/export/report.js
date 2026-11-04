// Turning what Explorer observed into something you can paste into a code review or keep
// beside a commit. Pure JavaScript: no chrome.*, no DOM, no clock of its own.
//
// Two formats, because they answer different questions. The JSON is the record — complete,
// stable, diffable, and the thing a CI step would read. The Markdown is the argument — short
// enough that a colleague reads it, and it leads with what changed rather than with a schema.
//
// What is deliberately absent: the API key, and any part of the provider configuration that
// could carry one. A report is built from what happened, never from how it was configured, so
// there is no path by which a credential reaches an export (D-035).

import { ISO, slug, stamp, fence, cell } from './text.js';

const percent = (rate) => (rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`);

// ---------------------------------------------------------------------------
// The tools a page exposes: the contract, as observed.
// ---------------------------------------------------------------------------

export function toolsReport(discovery, { at = Date.now() } = {}) {
  const tools = discovery?.tools ?? [];
  const origin = discovery?.topOrigin ?? 'unknown-origin';

  const json = {
    kind: 'webmcp-explorer/tools',
    version: 1,
    observedAt: ISO(at),
    origin,
    complete: discovery?.completeness?.complete ?? null,
    // Saying what could not be seen matters more in a saved report than in the live panel:
    // whoever reads it later has no way to notice the gap themselves.
    notObserved: discovery?.completeness?.reasons ?? [],
    tools: tools.map((tool) => ({
      name: tool.name,
      title: tool.title ?? '',
      description: tool.description ?? '',
      inputSchema: tool.inputSchema ?? null,
      schemaError: tool.schemaError ?? null,
      annotations: tool.annotations ?? {},
      origin: tool.origin,
      frameId: tool.frameId ?? null,
      notInjected: Boolean(tool.notInjected),
      registrationType: tool.registrationType ?? 'unknown',
      // The contract fingerprint is what makes two saved reports comparable at all.
      contractFingerprint: tool.contractFp ?? null,
      overridden: Boolean(tool.overridden),
    })),
  };

  const lines = [
    `# WebMCP tools on ${origin}`,
    '',
    `Observed ${ISO(at)} — ${tools.length} tool${tools.length === 1 ? '' : 's'}.`,
  ];
  if (json.complete === false) {
    lines.push('', '> Discovery was incomplete. Some frames were not observed, so this is not '
      + 'the whole contract.');
  }
  lines.push('', '| Tool | Description | Frame | Notes |', '| --- | --- | --- | --- |');
  for (const tool of json.tools) {
    const notes = [];
    if (tool.notInjected) notes.push('not reachable');
    if (tool.schemaError) notes.push('schema unreadable');
    if (tool.overridden) notes.push('locally overridden');
    if (tool.annotations?.readOnlyHint) notes.push('declared read-only');
    const named = tool.title ? `\`${cell(tool.name)}\` — ${cell(tool.title)}` : `\`${cell(tool.name)}\``;
    lines.push(`| ${named} | ${cell(tool.description) || '—'} | `
      + `${tool.frameId ?? '—'} | ${notes.join(', ') || '—'} |`);
  }

  const withSchema = json.tools.filter((tool) => tool.inputSchema);
  if (withSchema.length) {
    lines.push('', '## Input schemas', '');
    for (const tool of withSchema) {
      lines.push(`### \`${tool.name}\``, '', fence(JSON.stringify(tool.inputSchema, null, 2), 'json'), '');
    }
  }

  return {
    filename: `webmcp-tools_${slug(origin, 'page')}_${stamp(at)}`,
    json,
    markdown: `${lines.join('\n').trimEnd()}\n`,
  };
}

// ---------------------------------------------------------------------------
// The live timeline: what happened to the tools, in order.
// ---------------------------------------------------------------------------

export function timelineReport(events = [], { origin = null, stats = null, at = Date.now() } = {}) {
  // Newest first on screen; oldest first in a record, the way a log reads.
  const ordered = [...events].sort((a, b) => a.at - b.at);
  const json = {
    kind: 'webmcp-explorer/timeline',
    version: 1,
    observedAt: ISO(at),
    origin,
    // Honest about the sampling model: registrations are derived from snapshots, so a tool that
    // came and went between two snapshots is not here (L-10), and a full buffer drops the oldest.
    sampled: true,
    recorded: stats?.total ?? ordered.length,
    dropped: stats?.dropped ?? 0,
    skippedWhilePaused: stats?.skippedWhilePaused ?? 0,
    events: ordered.map((event) => ({
      at: ISO(event.at),
      kind: event.kind,
      tool: event.toolName ?? null,
      origin: event.origin ?? null,
      frameId: event.frameId ?? null,
      durationMs: Number.isFinite(event.durationMs) ? event.durationMs : null,
      code: event.code ?? null,
      error: event.error ?? null,
    })),
  };

  const lines = [
    `# WebMCP timeline${origin ? ` on ${origin}` : ''}`,
    '',
    `Exported ${ISO(at)} — ${ordered.length} event${ordered.length === 1 ? '' : 's'} shown, `
      + `${json.recorded} recorded.`,
    '',
    '> Sampled, not intercepted: registrations are derived from successive snapshots of the tool '
      + 'list, so a tool registered and removed between two snapshots does not appear.',
  ];
  if (json.dropped) lines.push('', `> ${json.dropped} older event${json.dropped === 1 ? '' : 's'} dropped when the buffer filled.`);
  if (json.skippedWhilePaused) lines.push('', `> ${json.skippedWhilePaused} event${json.skippedWhilePaused === 1 ? '' : 's'} missed while recording was paused.`);
  lines.push('', '| Time | Event | Tool | Frame | Duration | Note |', '| --- | --- | --- | --- | --- | --- |');
  for (const event of json.events) {
    const note = event.error ?? event.code ?? '';
    lines.push(`| ${event.at.slice(11, 23)} | ${event.kind} | \`${cell(event.tool ?? '—')}\` | `
      + `${event.frameId ?? '—'} | ${event.durationMs === null ? '—' : `${event.durationMs} ms`} | ${cell(note) || '—'} |`);
  }

  return {
    filename: `webmcp-timeline_${slug(origin, 'page')}_${stamp(at)}`,
    json,
    markdown: `${lines.join('\n').trimEnd()}\n`,
  };
}

// ---------------------------------------------------------------------------
// One agent run: what the model did with those tools.
// ---------------------------------------------------------------------------

export function agentReport(run, { at = Date.now(), origin = null, model = null } = {}) {
  const turns = run?.transcript ?? [];
  // Captured provenance takes precedence over a caller's current settings. Legacy runs
  // can still receive a known model explicitly; the UI never guesses it from new settings.
  model = Object.hasOwn(run ?? {}, 'model') ? run.model : model;

  const json = {
    kind: 'webmcp-explorer/agent-run',
    version: 1,
    observedAt: ISO(at),
    origin,
    // The model name is useful and cannot carry a secret. The endpoint, the key and the rest
    // of the configuration are deliberately not here.
    model,
    goal: run?.goal ?? '',
    status: run?.status ?? null,
    outcome: run?.doneReason ?? null,
    error: run?.error ?? null,
    steps: run?.steps ?? 0,
    toolCalls: run?.toolCalls ?? 0,
    toolsOffered: (run?.declarations ?? []).map(declaredName),
    toolsWithheld: run?.excluded ?? [],
    toolsRenamed: run?.renamed ?? [],
    toolsAdapted: run?.adapted ?? [],
    transcript: turns.map((turn) => ({
      role: turn.role,
      text: turn.text ?? null,
      calls: turn.calls ?? undefined,
      tool: turn.alias ?? undefined,
      ok: turn.ok ?? undefined,
      mocked: turn.mocked ?? undefined,
      durationMs: turn.durationMs ?? undefined,
    })),
  };

  const lines = [
    '# Agent run',
    '',
    `Goal: ${run?.goal ?? '—'}`,
    '',
    `${origin ? `Page: ${origin}. ` : ''}${model ? `Model: ${model}. ` : ''}`
      + `${json.steps} model turn${json.steps === 1 ? '' : 's'}, `
      + `${json.toolCalls} tool call${json.toolCalls === 1 ? '' : 's'}. `
      + `Outcome: ${json.outcome ?? json.status ?? 'unknown'}.`,
  ];

  if (json.error) lines.push('', `> Failed: ${json.error}`);

  // The caveats belong near the top: a reader who does not know a tool was withheld will
  // conclude the model ignored it.
  if (json.toolsWithheld.length) {
    lines.push('', '> Not offered to the model: '
      + json.toolsWithheld.map((item) => `\`${item.name}\` (${item.reason})`).join(', '));
  }
  if (json.transcript.some((turn) => turn.mocked)) {
    lines.push('', '> Some tool results were mocked by a local override. This run is not '
      + 'evidence that the real tools work.');
  }

  lines.push('', '## What happened', '');
  for (const turn of json.transcript) {
    if (turn.role === 'user') lines.push(`**Goal** — ${turn.text}`, '');
    else if (turn.role === 'assistant') {
      if (turn.text) lines.push(`**Model** — ${turn.text}`, '');
      for (const call of turn.calls ?? []) {
        lines.push(`**Calls** \`${call.alias}\``, '',
          fence(JSON.stringify(call.args ?? {}, null, 2), 'json'), '');
      }
    } else if (turn.role === 'tool') {
      const flags = [turn.ok === false ? 'error' : 'ok'];
      if (turn.mocked) flags.push('mocked');
      if (Number.isFinite(turn.durationMs)) flags.push(`${turn.durationMs} ms`);
      lines.push(`**Result** \`${turn.tool}\` — ${flags.join(', ')}`, '',
        fence(turn.text ?? '', ''), '');
    }
  }

  return {
    filename: `webmcp-agent_${slug(run?.goal, 'run')}_${stamp(at)}`,
    json,
    markdown: `${lines.join('\n').trimEnd()}\n`,
  };
}

function declaredName(declaration) {
  return declaration?.function?.name ?? declaration?.name ?? null;
}

// ---------------------------------------------------------------------------
// An eval result, and the comparison that gives it meaning.
// ---------------------------------------------------------------------------

export function evalReport(result, { comparison = null, before = null, at = Date.now() } = {}) {
  const json = {
    kind: 'webmcp-explorer/eval-result',
    version: 1,
    observedAt: ISO(at),
    origin: result?.origin ?? null,
    suite: result?.name ?? '',
    label: result?.label ?? null,
    ranAt: result?.ranAt ? ISO(result.ranAt) : null,
    passed: result?.passed ?? 0,
    failed: result?.failed ?? 0,
    errored: result?.errored ?? 0,
    total: result?.total ?? 0,
    passRate: result?.passRate ?? null,
    unknownTools: result?.unknownTools ?? [],
    overridesInForce: result?.overrides ?? [],
    cases: (result?.cases ?? []).map((entry) => ({
      goal: entry.goal,
      expectTool: entry.expectTool,
      outcome: entry.outcome,
      passes: entry.passes,
      attempts: entry.attempts,
      errored: entry.errored,
      passRate: entry.passRate,
      firstChoices: entry.firstChoices,
      misses: entry.misses,
    })),
    comparison: comparison
      ? {
        against: before?.label ?? null,
        counts: comparison.counts,
        netPassRateDelta: comparison.netPassRateDelta,
        regressed: comparison.regressed,
        improved: comparison.improved,
        cases: comparison.cases.map((entry) => ({
          goal: entry.goal,
          expectTool: entry.expectTool,
          change: entry.change,
          passRateDelta: entry.passRateDelta,
          firstChoiceChanged: entry.firstChoiceChanged,
        })),
      }
      : null,
  };

  const lines = [
    `# Eval: ${json.suite}${json.label ? ` — ${json.label}` : ''}`,
    '',
    `${json.origin ? `${json.origin} · ` : ''}${json.passed}/${json.total} cases passed`
      + `${json.errored ? `, ${json.errored} could not run` : ''}`
      + ` · ${percent(json.passRate)} of judged attempts.`,
  ];

  if (json.errored) {
    lines.push('', '> Attempts that errored are excluded from the rate rather than counted as '
      + 'failures. They say nothing about the page.');
  }
  if (json.unknownTools.length) {
    lines.push('', `> The suite names tools this page does not expose: `
      + `${json.unknownTools.map((n) => `\`${n}\``).join(', ')}. Those cases failed for a `
      + 'reason that is not the model.');
  }
  if (json.overridesInForce.length) {
    lines.push('', `> ${json.overridesInForce.length} local override`
      + `${json.overridesInForce.length === 1 ? ' was' : 's were'} in force during this run.`);
  }

  lines.push('', '| Case | Expects | Result | Rate | Reached for first |',
    '| --- | --- | --- | --- | --- |');
  for (const entry of json.cases) {
    lines.push(`| ${cell(entry.goal)} | \`${cell(entry.expectTool ?? '—')}\` | `
      + `${entry.outcome} | ${percent(entry.passRate)} | `
      + `${cell(entry.firstChoices.map((c) => `${c.value} (${c.count})`).join(', ')) || '—'} |`);
  }

  if (json.comparison) {
    const c = json.comparison;
    lines.push('', `## Compared with ${c.against ?? 'the previous run'}`, '',
      `${c.counts.fixed} fixed, ${c.counts.broken} broken, `
      + `${c.counts['still-passing']} still passing, ${c.counts['still-failing']} still failing`
      + `${c.counts.unjudged ? `, ${c.counts.unjudged} not comparable` : ''}.`);
    if (c.regressed) {
      lines.push('', '> This change broke at least one case, whatever the net figure says.');
    }
    lines.push('', '| Case | Change | Rate change |', '| --- | --- | --- |');
    for (const entry of c.cases) {
      const delta = entry.passRateDelta === null
        ? '—'
        : `${entry.passRateDelta > 0 ? '+' : ''}${Math.round(entry.passRateDelta * 100)} pts`;
      lines.push(`| ${cell(entry.goal)} | ${entry.change} | ${delta} |`);
    }
  }

  return {
    filename: `webmcp-eval_${slug(json.suite, 'suite')}${json.label ? `_${slug(json.label)}` : ''}`
      + `_${stamp(at)}`,
    json,
    markdown: `${lines.join('\n').trimEnd()}\n`,
  };
}
