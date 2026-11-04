import test from 'node:test';
import assert from 'node:assert/strict';
import { auditToolset, schemaProperties } from '../src/core/audit.js';

const tool = (over = {}) => ({
  name: 'search_products',
  description: 'Search the product catalogue by keyword and return matching items with price and availability.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The keyword to search for.' },
      maxResults: { type: 'number', description: 'Maximum results to return.' },
    },
    required: ['query'],
  },
  ...over,
});

test('a well-described toolset scores high', () => {
  const r = auditToolset([tool()]);
  assert.ok(r.overall >= 95, `expected >=95, got ${r.overall}: ${JSON.stringify(r.perTool[0].findings)}`);
  assert.equal(r.counts.pass, 1);
});

test('missing description is a failing finding', () => {
  const r = auditToolset([tool({ description: '' })]);
  assert.equal(r.perTool[0].findings.some((f) => f.rule === 'desc-missing'), true);
  assert.ok(r.overall < 92);
});

test('a vague one-word description scores below a good one', () => {
  const vague = auditToolset([tool({ description: 'Tools', name: 'mcp-tools' })]).overall;
  const good = auditToolset([tool()]).overall;
  assert.ok(vague < good, `${vague} should be below ${good}`);
});

test('two tools with the same description are both flagged', () => {
  const dup = { name: 'a_tool', description: 'Do the thing on the page.', inputSchema: { type: 'object', properties: {} } };
  const dup2 = { name: 'b_tool', description: 'do THE thing on the page', inputSchema: { type: 'object', properties: {} } };
  const r = auditToolset([dup, dup2]);
  assert.equal(r.perTool.filter((t) => t.findings.some((f) => f.rule === 'desc-duplicate')).length, 2);
});

test('two instances of the same tool name across frames are not flagged as duplicate descriptions', () => {
  const f0 = { name: 'search_products', instanceId: '0:search_products', description: 'Search the catalogue for matching items.', inputSchema: { type: 'object', properties: {} } };
  const f1 = { name: 'search_products', instanceId: '1:search_products', description: 'Search the catalogue for matching items.', inputSchema: { type: 'object', properties: {} } };
  const r = auditToolset([f0, f1]);
  assert.equal(r.perTool.filter((t) => t.findings.some((f) => f.rule === 'desc-duplicate')).length, 0);
  assert.equal(r.perTool[0].instanceId, '0:search_products');
  assert.equal(r.perTool[1].instanceId, '1:search_products');
});

test('properties without descriptions are counted', () => {
  const r = auditToolset([tool({
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string' }, n: { type: 'number' } },
      required: ['q'],
    },
  })]);
  const f = r.perTool[0].findings.find((x) => x.rule === 'param-missing-desc');
  assert.ok(f && f.count === 2, JSON.stringify(r.perTool[0].findings));
});

test('untyped properties are flagged', () => {
  const r = auditToolset([tool({
    inputSchema: { type: 'object', properties: { x: { description: 'mystery value' } } },
  })]);
  assert.ok(r.perTool[0].findings.some((f) => f.rule === 'param-untyped'));
});

test('descriptions restating the name only are flagged', () => {
  const r = auditToolset([{ name: 'search products', description: 'Search products', inputSchema: { type: 'object', properties: {} } }]);
  assert.ok(r.perTool[0].findings.some((f) => f.rule === 'desc-restates-name' || f.rule === 'desc-generic'));
});

test('declared annotations earn a small bonus', () => {
  const bare = auditToolset([tool()]);
  const hinted = auditToolset([tool({ annotations: { readOnlyHint: true } })]);
  assert.ok(hinted.overall >= bare.overall);
});

test('an empty toolset scores zero and reports no tools', () => {
  const r = auditToolset([]);
  assert.equal(r.overall, 0);
  assert.deepEqual(r.counts, { fail: 0, warn: 0, pass: 0 });
});

test('schema walk descends nested items and combinators', () => {
  const props = schemaProperties({
    type: 'object',
    properties: {
      order: { type: 'object', properties: { id: { type: 'string', description: 'd' } } },
      rows: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string', description: 'd' } } } },
      pick: { anyOf: [{ type: 'string', description: 'd' }] },
    },
  });
  const paths = props.map((p) => p.path);
  assert.ok(paths.includes('order.id'), paths.join(','));
  assert.ok(paths.includes('rows[].sku'), paths.join(','));
});
