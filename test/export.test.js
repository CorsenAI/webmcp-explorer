import test from 'node:test';
import assert from 'node:assert/strict';

import { toolsReport, agentReport, evalReport } from '../src/core/export/report.js';

const AT = Date.parse('2026-09-04T10:20:30.000Z');

const discovery = {
  topOrigin: 'http://localhost:8777',
  completeness: { complete: true, reasons: [] },
  tools: [
    {
      name: 'search_products',
      description: 'Search the catalogue',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      annotations: { readOnlyHint: true },
      origin: 'http://localhost:8777',
      frameId: 0,
      contractFp: 'fp-1',
    },
    {
      name: 'ghost',
      description: '',
      inputSchema: null,
      schemaError: 'inputSchema is not valid JSON',
      annotations: {},
      origin: 'https://other.example',
      frameId: null,
      notInjected: true,
    },
  ],
};

const run = {
  goal: 'Find a laptop',
  status: 'done',
  doneReason: 'answered',
  steps: 2,
  toolCalls: 1,
  declarations: [{ type: 'function', function: { name: 'search_products' } }],
  excluded: [{ name: 'ghost', reason: 'schema-unparsed', detail: 'boom' }],
  renamed: [],
  transcript: [
    { role: 'user', text: 'Find a laptop' },
    { role: 'assistant', text: 'Looking.', calls: [{ id: 'c1', alias: 'search_products', args: { q: 'mac' } }] },
    { role: 'tool', alias: 'search_products', ok: true, text: '{"products":[]}', durationMs: 12 },
    { role: 'assistant', text: 'Found one.', calls: [] },
  ],
};

const evalResult = {
  name: 'Every tool, once',
  label: 'after rewrite',
  origin: 'http://localhost:8777',
  ranAt: AT,
  passed: 1,
  failed: 1,
  errored: 0,
  total: 2,
  passRate: 0.5,
  unknownTools: [],
  overrides: [{ logicalId: 'a', changedDescription: true, mockMode: 'off' }],
  cases: [
    {
      goal: 'Add a product', expectTool: 'add_to_cart', outcome: 'pass',
      passes: 1, attempts: 1, errored: 0, passRate: 1,
      firstChoices: [{ value: 'add_to_cart', count: 1 }], misses: [],
    },
    {
      goal: 'Search the catalogue', expectTool: 'search_products', outcome: 'fail',
      passes: 0, attempts: 1, errored: 0, passRate: 0,
      firstChoices: [{ value: 'add_to_cart', count: 1 }],
      misses: [{ value: 'expected-tool-not-called', count: 1 }],
    },
  ],
};

test('a tools report names the origin, the count and every tool', () => {
  const out = toolsReport(discovery, { at: AT });
  assert.equal(out.json.kind, 'webmcp-explorer/tools');
  assert.equal(out.json.origin, 'http://localhost:8777');
  assert.equal(out.json.tools.length, 2);
  assert.match(out.markdown, /# WebMCP tools on http:\/\/localhost:8777/);
  assert.match(out.markdown, /`search_products`/);
  assert.match(out.markdown, /2 tools/);
});

test('a tools report says what could not be reached, rather than omitting it', () => {
  const out = toolsReport(discovery, { at: AT });
  assert.match(out.markdown, /not reachable/);
  assert.match(out.markdown, /schema unreadable/);
});

test('an incomplete discovery is called out at the top', () => {
  const out = toolsReport({
    ...discovery,
    completeness: { complete: false, reasons: ['origin-not-granted'] },
  }, { at: AT });
  assert.match(out.markdown, /Discovery was incomplete/);
  assert.deepEqual(out.json.notObserved, ['origin-not-granted']);
});

test('the contract fingerprint travels, so two reports can be compared', () => {
  assert.equal(toolsReport(discovery, { at: AT }).json.tools[0].contractFingerprint, 'fp-1');
});

test('filenames are safe, dated, and carry the subject', () => {
  const out = toolsReport(discovery, { at: AT });
  assert.match(out.filename, /^webmcp-tools_http-localhost-8777_2026-09-04_10-20-30$/);
  assert.doesNotMatch(out.filename, /[^a-zA-Z0-9._-]/);
});

test('an agent report leads with the goal and the outcome', () => {
  const out = agentReport(run, { at: AT, origin: 'http://localhost:8777', model: 'gpt-5.1' });
  assert.equal(out.json.kind, 'webmcp-explorer/agent-run');
  assert.equal(out.json.outcome, 'answered');
  assert.match(out.markdown, /Goal: Find a laptop/);
  assert.match(out.markdown, /Model: gpt-5\.1/);
  assert.match(out.markdown, /2 model turns, 1 tool call\./);
});

test('a withheld tool is stated near the top, not buried', () => {
  const out = agentReport(run, { at: AT });
  const header = out.markdown.split('## What happened')[0];
  assert.match(header, /Not offered to the model: `ghost`/);
});

test('an agent export keeps the model used even after the next model is selected', () => {
  const captured = { ...run, model: 'original-model', providerId: 'openai-compatible' };
  const out = agentReport(captured, { at: AT, model: 'next-model' });
  assert.equal(out.json.model, 'original-model');
  assert.match(out.markdown, /Model: original-model/);
  assert.doesNotMatch(out.markdown, /next-model/);
});

test('a captured unknown model is not replaced with the current configuration', () => {
  assert.equal(agentReport({ ...run, model: null }, { model: 'next-model' }).json.model, null);
  assert.equal(agentReport(run).json.model, null);
});

test('a mocked run is flagged so it cannot be read as evidence', () => {
  const mocked = {
    ...run,
    transcript: run.transcript.map((t) => (t.role === 'tool' ? { ...t, mocked: true } : t)),
  };
  assert.match(agentReport(mocked, { at: AT }).markdown, /not evidence that the real tools work/);
});

test('a failed run carries its error', () => {
  const failed = { ...run, status: 'failed', doneReason: 'error', error: '401 Invalid API key' };
  const out = agentReport(failed, { at: AT });
  assert.match(out.markdown, /Failed: 401 Invalid API key/);
  assert.equal(out.json.error, '401 Invalid API key');
});

test('the transcript keeps calls, arguments and results in order', () => {
  const out = agentReport(run, { at: AT });
  const body = out.markdown.split('## What happened')[1];
  assert.ok(body.indexOf('**Goal**') < body.indexOf('**Calls**'));
  assert.ok(body.indexOf('**Calls**') < body.indexOf('**Result**'));
  assert.match(body, /"q": "mac"/);
  assert.match(body, /12 ms/);
});

test('a payload containing a code fence cannot break out of its block', () => {
  const tricky = {
    ...run,
    transcript: [{ role: 'tool', alias: 't', ok: true, text: 'before ``` after ```` end' }],
  };
  const md = agentReport(tricky, { at: AT }).markdown;
  const opener = md.match(/^(`{3,})/m)[1];
  assert.ok(opener.length >= 5, `fence was ${opener.length} backticks`);
  assert.match(md, /before ``` after/);
});

test('no part of the provider configuration reaches an agent report', () => {
  const out = agentReport(run, { at: AT, origin: 'o', model: 'gpt-5.1' });
  const text = JSON.stringify(out.json) + out.markdown;
  for (const forbidden of ['apiKey', 'baseUrl', 'authorization', 'sk-']) {
    assert.ok(!text.includes(forbidden), `export leaked ${forbidden}`);
  }
});

test('an eval report leads with the score and the rate', () => {
  const out = evalReport(evalResult, { at: AT });
  assert.equal(out.json.kind, 'webmcp-explorer/eval-result');
  assert.match(out.markdown, /# Eval: Every tool, once — after rewrite/);
  assert.match(out.markdown, /1\/2 cases passed/);
  assert.match(out.markdown, /50% of judged attempts/);
});

test('an eval report says errored attempts were excluded, when there were any', () => {
  assert.doesNotMatch(evalReport(evalResult, { at: AT }).markdown, /excluded from the rate/);
  const withErrors = { ...evalResult, errored: 2 };
  assert.match(evalReport(withErrors, { at: AT }).markdown, /excluded from the rate/);
});

test('overrides in force are disclosed, or the result means something else', () => {
  assert.match(evalReport(evalResult, { at: AT }).markdown, /1 local override was in force/);
});

test('tools the suite names but the page lacks are called out', () => {
  const out = evalReport({ ...evalResult, unknownTools: ['gone'] }, { at: AT });
  assert.match(out.markdown, /does not expose: `gone`/);
});

test('a goal containing a pipe does not break the table', () => {
  const out = evalReport({
    ...evalResult,
    cases: [{ ...evalResult.cases[0], goal: 'a | b\nc' }],
  }, { at: AT });
  const row = out.markdown.split('\n').find((line) => line.includes('a \\| b'));
  assert.ok(row, 'the pipe was not escaped');
  assert.equal(row.split(/(?<!\\)\|/).length - 1, 6);
});

test('a comparison is included when there is one, with the label it ran against', () => {
  const out = evalReport(evalResult, {
    at: AT,
    before: { label: 'before rewrite' },
    comparison: {
      counts: { fixed: 1, broken: 1, 'still-passing': 0, 'still-failing': 0, unjudged: 0 },
      netPassRateDelta: 0,
      regressed: true,
      improved: true,
      cases: [
        { goal: 'Add a product', expectTool: 'add_to_cart', change: 'fixed', passRateDelta: 1, firstChoiceChanged: true },
        { goal: 'Search', expectTool: 'search_products', change: 'broken', passRateDelta: -1, firstChoiceChanged: true },
      ],
    },
  });
  assert.match(out.markdown, /## Compared with before rewrite/);
  assert.match(out.markdown, /1 fixed, 1 broken/);
  assert.match(out.markdown, /broke at least one case/);
  assert.match(out.markdown, /\+100 pts/);
  assert.match(out.markdown, /-100 pts/);
  assert.equal(out.json.comparison.against, 'before rewrite');
});

test('a regression is stated even when the net figure is flat', () => {
  const out = evalReport(evalResult, {
    at: AT,
    comparison: {
      counts: { fixed: 2, broken: 1, 'still-passing': 0, 'still-failing': 0, unjudged: 0 },
      netPassRateDelta: 0.2, regressed: true, improved: true, cases: [],
    },
  });
  assert.match(out.markdown, /broke at least one case, whatever the net figure says/);
});

test('every report ends with exactly one newline', () => {
  for (const out of [
    toolsReport(discovery, { at: AT }),
    agentReport(run, { at: AT }),
    evalReport(evalResult, { at: AT }),
  ]) {
    assert.match(out.markdown, /[^\n]\n$/);
  }
});

test('an empty subject produces a report rather than throwing', () => {
  assert.doesNotThrow(() => toolsReport({}, { at: AT }));
  assert.doesNotThrow(() => agentReport(null, { at: AT }));
  assert.doesNotThrow(() => evalReport(null, { at: AT }));
  assert.match(toolsReport({}, { at: AT }).filename, /^webmcp-tools_unknown-origin_/);
});
