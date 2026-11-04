import test from 'node:test';
import assert from 'node:assert/strict';
import { securityReport } from '../src/core/export/security-report.js';
import { reviewSecurity } from '../src/core/security/review.js';

const discovery = {
  topOrigin: 'http://localhost:8777', url: 'http://localhost:8777/hostile.html', frames: [{ instrumented: false }],
  completeness: { ungrantedOrigins: [], refusedFrames: [] }, unreachableFrames: [],
  env: { checks: { apiAvailability: 'available', toolsPermission: 'allowed' } },
  tools: [
    { name: 'pay_invoice', description: 'Pay the invoice | now.', inputSchema: { type: 'object', properties: {} }, annotations: {}, origin: 'http://localhost:8777', frameId: 0, instanceId: 'p@0', logicalId: 'p', contractFp: 'fp1', source: { known: false } },
  ],
};
const texts = (code, part) => ({ title: `Title of ${code}`, why: 'Because.', fix: 'Do this.' }[part]);

test('the security report is a record and an argument, with every finding, its sources and an auditable provisional score', () => {
  const review = reviewSecurity({ discovery });
  const { json, markdown, filename } = securityReport(review, discovery, { at: Date.UTC(2026, 9, 18, 12, 0, 0), texts });
  assert.equal(json.kind, 'webmcp-explorer/security-review');
  assert.equal(json.version, 2);
  assert.equal(json.findings.length, review.findings.length);
  assert.equal(json.findings[0].title, 'Title of consequential-without-hint');
  assert.ok(json.findings[0].sources.length >= 2);
  assert.ok(json.findings[0].sources.every((s) => /^https:\/\//.test(s.url)));
  assert.equal(json.coverage.tools, 1);
  assert.match(json.method, /not a security certification/);
  assert.equal(json.score.value, review.score.value);
  assert.equal(json.score.provisional, true);
  assert.ok(json.findings[0].remediationCodeSnippet);
  assert.equal(json.findings[0].id, 'WMCP-SEC-002');
  assert.match(markdown, /^# WebMCP security review — ` http:\/\/localhost:8777 `/);
  assert.match(markdown, /## Not observable in this review/);
  assert.match(markdown, /` registration-provenance ` \(instrumentation-off\)/);
  // A pipe in page text does not break the table.
  assert.match(markdown, /Pay the invoice \\\| now\./);
  assert.match(markdown, /\*\*What to do\.\*\* Do this\./);
  assert.equal(filename, 'webmcp-security_http-localhost-8777_2026-10-18_12-00-00');
});

test('a clean review exports "Nothing flagged" and still lists coverage', () => {
  const clean = { ...discovery, tools: [{ ...discovery.tools[0], name: 'search', description: 'Search the catalogue.', annotations: { readOnlyHint: true } }] };
  const review = reviewSecurity({ discovery: clean });
  const { json, markdown } = securityReport(review, clean, { at: 0, texts });
  assert.equal(json.findings.length, 0);
  assert.match(markdown, /Nothing flagged\./);
  assert.match(markdown, /0 findings/);
});
