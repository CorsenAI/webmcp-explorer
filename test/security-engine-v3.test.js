import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { RULES, withRule } from '../src/core/security/rules.js';
import { CATALOG, CODES, REFS } from '../src/core/security/catalog.js';
import { reviewSecurity } from '../src/core/security/review.js';
import { reviewDeclarative } from '../src/core/security/declarative-integrity.js';
import { callbackLabels, reviewCallbackSource, callbackCoverage, CALLBACK_LABELS } from '../src/core/security/callback-source.js';
import { reviewExposure } from '../src/core/security/exposure.js';
import { reviewText } from '../src/core/security/description-injection.js';
import { findSecrets, reviewSecrets } from '../src/core/security/secrets.js';
import { starterContracts, imperativeStarter } from '../src/core/security/starter-contract.js';
import { quickFix } from '../src/core/security/quick-fix.js';
import { fixDiff, unifiedDiff, canonicalJson } from '../src/core/security/fix-diff.js';
import { jsonLiteral, htmlText } from '../src/core/security/snippet-encode.js';
import { makeBaseline, diffBaseline, ENGINE_V3_CODES, ENGINE_VERSION } from '../src/core/security/baseline.js';
import { securitySarif } from '../src/core/export/sarif.js';

const ORIGIN = 'https://shop.test';
const tool = (over = {}) => ({ name: 'lookup_order', title: '', description: 'Look up the status of one order by its number.',
  inputSchema: { type: 'object', additionalProperties: false, properties: { number: { type: 'string', pattern: '^[0-9]{6}$', description: 'Order number.' } }, required: ['number'] },
  annotations: { readOnlyHint: true }, origin: ORIGIN, frameId: 0, instanceId: 'o@0', logicalId: 'o', contractFp: 'fp-o',
  callbackObservation: { status: 'source-text-inspected', labels: [] }, ...over });
const form = (over = {}) => tool({ name: 'contact_team', description: 'Contact form for the support team.', registrationType: 'declarative',
  annotations: null, callbackObservation: null, autoSubmit: false, form: { method: 'post', controls: [] },
  inputSchema: { type: 'object', additionalProperties: false, properties: { message: { type: 'string', maxLength: 500, description: 'Message.' } } }, ...over });
const discovery = (tools) => ({ topOrigin: ORIGIN, url: `${ORIGIN}/`, tools, frames: [{ instrumented: true }], completeness: { ungrantedOrigins: [], refusedFrames: [] }, unreachableFrames: [] });
const review = (tools, extra = {}) => reviewSecurity({ discovery: discovery(tools), events: [{ toolName: 'x', kind: 'registered', at: 0 }], originScan: { page: { status: 200 }, files: [], findings: [] }, ...extra });
const codes = (r) => r.findings.map((f) => f.code).sort();
// Provider-shaped test tokens are assembled at run time so this file never contains one.
const token = (prefix, n, ch = 'x') => prefix + ch.repeat(n);

test('families 001-007 are unchanged and every new code belongs to exactly one new family', () => {
  // Engine v5 split the agent-directive phrases in two: 001 gained text-usage-instruction. The
  // seven families are otherwise as engine v2 had them.
  const v2 = {
    'WMCP-SEC-001': ['critical', 'Tool description injection', 'ASI01,ASI02', 'text-agent-directive,text-usage-instruction,text-hidden-characters,text-mixed-scripts,text-encoded-blob,text-markup,text-embedded-address,text-active-payload'],
    'WMCP-SEC-002': ['high', 'Mutating tool annotations', 'ASI02,ASI09', 'consequential-without-hint,state-change-without-hint,readonly-claim-on-mutating-verb,mutation-hints-incomplete'],
    'WMCP-SEC-003': ['high', 'Input schema constraints', 'ASI02,ASI05', 'unbounded-string,permissive-object'],
    'WMCP-SEC-004': ['high', 'Authentication and confirmation boundary', 'ASI03,ASI09', 'mutating-auto-submit'],
    'WMCP-SEC-005': ['medium', 'Legacy WebMCP registration', 'ASI04', 'legacy-host,legacy-registration'],
    'WMCP-SEC-006': ['medium', 'Origin discovery and headers', 'ASI04', 'convention-manifest-present,convention-manifest-invalid,convention-llms-txt-present,convention-permissions-policy,convention-permissions-policy-absent,convention-csp,convention-cors,convention-unavailable'],
    'WMCP-SEC-007': ['low', 'Description budget and ambiguity', 'ASI02', 'text-over-budget,token-estimate-over-budget,ambiguous-description'],
  };
  for (const [id, [severity, title, owasp, list]] of Object.entries(v2)) {
    assert.deepEqual([RULES[id].severity, RULES[id].title, RULES[id].owasp.join(','), RULES[id].codes.join(',')], [severity, title, owasp, list], id);
  }
  const owner = new Map();
  for (const [id, r] of Object.entries(RULES)) {
    for (const code of r.codes) { assert.ok(CATALOG[code], `${id} names unknown ${code}`); assert.ok(!owner.has(code), `${code} in two families`); owner.set(code, id); }
    assert.ok(r.description.length > 40 && r.help.length > 40 && ['high', 'medium'].includes(r.precision), id);
  }
  for (const code of ENGINE_V3_CODES) assert.match(owner.get(code), /^WMCP-SEC-01[0-3]$|^WMCP-SEC-00[89]$/, code);
  assert.equal(Object.keys(RULES).length, 13);
  for (const code of CODES) for (const ref of CATALOG[code].refs) assert.ok(REFS[ref]?.url.startsWith('https://'), `${code}: ${ref}`);
});

test('WMCP-SEC-008: hidden business fields are named, never valued; framework fields are ignored', () => {
  const t = form({ form: { method: 'post', controls: [
    { name: 'amount', type: 'hidden', value: 'SENTINEL-1000' }, { name: 'return_url', type: 'hidden' },
    { name: 'csrf_token', type: 'hidden' }, { name: '__VIEWSTATE', type: 'hidden' }, { name: '_method', type: 'hidden' },
    { name: 'message', type: 'textarea' }] } });
  const [f, ...rest] = reviewDeclarative(t);
  assert.equal(rest.length, 0);
  assert.equal(f.code, 'declarative-hidden-parameter');
  assert.deepEqual(f.detail.names, ['amount', 'return_url']);
  assert.equal(f.detail.valuesRead, false);
  assert.doesNotMatch(JSON.stringify(f), /SENTINEL/);
  assert.deepEqual(reviewDeclarative(tool()), [], 'imperative tools are out of scope');
});

test('WMCP-SEC-008: credential and card fields are reported once, orphan descriptions are low', () => {
  const t = form({ form: { method: 'post', controls: [
    { name: 'pwd', type: 'password' }, { name: 'card', type: 'text', autocomplete: 'billing cc-number' },
    { name: 'password', type: 'password' }, { name: null, type: 'text', hasParamDescription: true, paramDescription: 'Coupon to apply.' },
    { name: 'note', type: 'text', disabled: true, hasParamDescription: true, paramDescription: 'Disabled note.' }] } });
  const prior = [{ code: 'sensitive-parameter', toolName: t.name, instanceId: t.instanceId, detail: { category: 'credentials', path: 'password' } }];
  const found = reviewDeclarative(t, { prior });
  const cred = found.find((f) => f.code === 'declarative-credential-field');
  assert.deepEqual(cred.detail.fields, [{ name: 'pwd', reason: 'type=password' }, { name: 'card', reason: 'autocomplete=cc-number' }]);
  const orphan = found.find((f) => f.code === 'declarative-param-orphan');
  assert.equal(orphan.severity, 'low');
  assert.deepEqual(orphan.detail.controls.map((c) => c.reason), ['no-name', 'disabled']);
});

test('WMCP-SEC-008 and 004 never both report one auto-submitted form', () => {
  const neutral = review([form({ autoSubmit: true })]);
  assert.ok(neutral.findings.some((f) => f.code === 'declarative-post-auto-submit' && f.ruleId === 'WMCP-SEC-008' && f.severity === 'medium'));
  assert.ok(!neutral.findings.some((f) => f.code === 'mutating-auto-submit'));
  const deleting = review([form({ name: 'delete_account', description: 'Delete the account and its data.', autoSubmit: true })]);
  assert.ok(deleting.findings.some((f) => f.code === 'mutating-auto-submit'));
  assert.ok(!deleting.findings.some((f) => f.code === 'declarative-post-auto-submit'));
  assert.ok(!review([form({ autoSubmit: true, form: { method: 'get', controls: [] } })]).findings.some((f) => f.code === 'declarative-post-auto-submit'));
});

test('callback labels: write methods, POST, submissions and an agent header', () => {
  assert.deepEqual(callbackLabels('fetch(u, { method: "DELETE" })'), ['request-method-write']);
  assert.deepEqual(callbackLabels("fetch('/graphql', {method:'POST', body})"), ['request-method-post']);
  assert.deepEqual(callbackLabels('axios.patch(u, d)'), ['axios-write']);
  assert.deepEqual(callbackLabels('x.open(`PUT`, u)'), ['xhr-open-write']);
  assert.deepEqual(callbackLabels('form.requestSubmit()'), ['submit-call']);
  assert.deepEqual(callbackLabels('navigator.sendBeacon(u, d)'), ['send-beacon']);
  assert.deepEqual(callbackLabels("fetch(u, { headers: { 'X-Agent-Initiated': 'webmcp' } })"), ['agent-header']);
  assert.deepEqual(callbackLabels('return list.filter(x => x.ok)'), []);
  for (const label of callbackLabels('fetch(u,{method:"PUT"});axios.post(u);x.open("POST",u);f.submit();navigator.sendBeacon(u);h.set("x-ai-request",1)')) assert.ok(CALLBACK_LABELS.includes(label));
});

test('WMCP-SEC-009: a read-only claim against write code is high, against POST only medium, never critical', () => {
  const write = review([tool({ callbackObservation: { status: 'source-text-inspected', labels: ['request-method-write', 'agent-header'] } })]);
  assert.deepEqual(write.findings.map((f) => [f.code, f.ruleId, f.severity]), [['readonly-callback-mutation', 'WMCP-SEC-009', 'high']]);
  assert.equal(write.score.value, 80); assert.equal(write.score.grade, 'B');
  const post = review([tool({ callbackObservation: { status: 'source-text-inspected', labels: ['request-method-post'] } })]);
  assert.equal(post.findings[0].severity, 'medium'); assert.equal(post.score.value, 90); assert.equal(post.score.grade, 'A');
  assert.deepEqual(reviewCallbackSource(tool({ annotations: {}, callbackObservation: { labels: ['request-method-write'] } })), []);
  assert.deepEqual(reviewCallbackSource(tool({ callbackObservation: { labels: ['agent-header'] } })), []);
  assert.deepEqual(callbackCoverage([tool({ callbackObservation: { status: 'native-or-bound', labels: [] } })]),
    [{ code: 'callback-source', reason: 'not-fully-observable', detail: ['lookup_order: native-or-bound'] }]);
  assert.equal(review([tool()]).score.value, 100);
});

test('WMCP-SEC-011: exposedTo to another origin is medium unless the tool is declared read-only', () => {
  const exposedTo = ['https://partner.example/path?q=1', ORIGIN, 'not a url', 'https://partner.example'];
  const pay = tool({ name: 'pay_invoice', description: 'Pay the invoice.', annotations: { readOnlyHint: false, consequentialHint: true }, exposedTo });
  const [f] = reviewExposure(pay);
  assert.deepEqual([f.code, f.severity, f.detail.origins], ['exposed-to-cross-origin', 'medium', ['https://partner.example']]);
  assert.equal(reviewExposure(tool({ exposedTo }))[0].severity, 'info');
  assert.deepEqual(reviewExposure(tool({ exposedTo: [ORIGIN] })), []);
  const r = review([pay]);
  assert.equal(r.score.value, 90, JSON.stringify(r.score.deductions));
  assert.deepEqual(r.score.deductions.map((d) => d.ruleId), ['WMCP-SEC-011']);
});

test('WMCP-SEC-012: more than twice a budget is medium, high with invisible or encoded content; 007 is unchanged', () => {
  const plain = 'Look up one order. '.repeat(58);
  const found = reviewText(tool({ description: plain }));
  assert.deepEqual(found.map((f) => [f.code, f.severity]), [['text-over-budget', 'low'], ['text-far-over-budget', 'medium']]);
  assert.deepEqual(found[0].detail, { over: [{ path: 'description', length: plain.length, budget: 500 }] });
  const hidden = reviewText(tool({ description: `${plain}\u200b` })).find((f) => f.code === 'text-far-over-budget');
  assert.deepEqual([hidden.severity, hidden.detail.concealment], ['high', ['description']]);
  const param = reviewText(tool({ inputSchema: { type: 'object', properties: { q: { type: 'string', maxLength: 9, description: 'Order number. '.repeat(23) } } } }));
  assert.deepEqual(param.map((f) => f.code), ['text-over-budget', 'text-far-over-budget']);
  assert.deepEqual(reviewText(tool({ description: 'Look up one order. '.repeat(30) })).map((f) => f.code), ['text-over-budget']);
});

test('WMCP-SEC-013 (Explorer only): provider secrets are typed and sized, never shown; publishable keys are not secrets', () => {
  const live = token('sk' + '_live_', 24, 'A'), test1 = token('rk' + '_test_', 24, 'B'), gh = token('gh' + 'p_', 36, 'C');
  const slack = token('xox' + 'b-', 30, '1'), pub = token('pk' + '_live_', 24, 'D');
  const hits = findSecrets(`a=${live};b=${test1};c=${gh};d=${slack};e=${pub}`);
  assert.deepEqual(hits.map((h) => [h.type, h.live]), [['stripe-secret-key', true], ['stripe-test-key', false], ['github-token', true], ['slack-token', true]]);
  const findings = reviewSecrets([{ kind: 'inline-script', label: 'inline script #1', text: `${live} ${live} ${test1}` }]);
  assert.deepEqual(findings.map((f) => [f.code, f.severity, f.detail.count]), [['client-secret-exposed', 'critical', 2], ['client-secret-exposed', 'medium', 1]]);
  for (const value of [live, test1, live.slice(8, 20)]) assert.ok(!JSON.stringify(findings).includes(value));
  const r = review([tool()], { extraFindings: findings });
  assert.equal(r.score.value, 49); assert.equal(r.score.grade, 'F');
  assert.ok(r.findings.every((f) => f.code !== 'client-secret-exposed' || f.ruleId === 'WMCP-SEC-013'));
  assert.equal(quickFix(withRule(findings[0]), null).language, 'text');
});

test('starter contracts: one per eligible form, never for credential forms, inert and parseable', async () => {
  const label = 'Query */ </script> `${x}` \u2028 "quoted"';
  const forms = [
    { id: 'site-search', method: 'get', action: '/search?token=abc', toolname: null, fields: [{ tag: 'input', type: 'search', name: 'q', required: true, maxlength: '80', label }] },
    { id: '', name: 'contact', method: 'post', action: '/contact.php', toolname: null, fields: [{ tag: 'input', type: 'email', name: 'email', required: true },
      { tag: 'textarea', type: 'textarea', name: 'message', label: 'Message' }, { tag: 'input', type: 'checkbox', name: '__proto__' }] },
    { id: 'login', method: 'post', toolname: null, fields: [{ tag: 'input', type: 'text', name: 'user' }, { tag: 'input', type: 'password', name: 'pw' }] },
    { id: 'already', method: 'get', toolname: 'existing_tool', fields: [{ tag: 'input', type: 'text', name: 'x' }] },
  ];
  const { contracts, skipped } = starterContracts(forms);
  assert.deepEqual(contracts.map((c) => [c.toolName, c.readOnly]), [['search_site_search', true], ['submit_contact', false]]);
  assert.deepEqual(skipped, [{ formIndex: 2, reason: 'credential-or-payment-field' }]);
  const [search, contact] = contracts;
  assert.deepEqual(search.descriptor.inputSchema.properties.q, { type: 'string', description: label.replace(/\s+/g, ' ').trim(), maxLength: 80 });
  assert.deepEqual(contact.descriptor.annotations, { readOnlyHint: false, consequentialHint: true, untrustedContentHint: false });
  assert.ok(Object.hasOwn(contact.descriptor.inputSchema.properties, '__proto__'));
  for (const c of contracts) {
    assert.doesNotMatch(c.declarative, /<form[^>]*toolautosubmit/);
    assert.doesNotMatch(c.declarative, /<\/script>|"quoted"|\u2028/);
    assert.doesNotMatch(c.imperative, /<\/script>|\u2028|token=abc/);
    new vm.Script(c.imperative);
    const calls = [];
    const ctx = { document: { modelContext: { registerTool: (d, o) => { calls.push(o); return d; } } } };
    vm.runInNewContext(c.imperative, ctx);
    assert.equal(calls.length, 0, 'defining the snippet registers nothing');
    const registered = await ctx.registerStarterTool('signal');
    assert.equal(calls.length, 1); assert.equal(calls[0].signal, 'signal');
    await assert.rejects(registered.execute({ unexpected: 1 }), /Unknown argument/);
  }
  const ctx = { document: {} };
  vm.runInNewContext(imperativeStarter(search.descriptor), ctx);
  assert.equal(await ctx.registerStarterTool(), undefined, 'without WebMCP the starter registers nothing');
});

test('before/after: a hint fix and an exposure fix produce exact diffs; advice-only fixes have none', () => {
  const pay = tool({ name: 'pay_invoice', description: 'Pay the invoice.', annotations: {}, exposedTo: ['https://partner.example'] });
  const r = review([pay]);
  const hint = r.findings.find((f) => f.ruleId === 'WMCP-SEC-002');
  const d = fixDiff(hint, pay);
  assert.match(d.unified, /^--- observed\n\+\+\+ proposed\n/);
  assert.match(d.unified, /\n-  "annotations": \{\},\n\+  "annotations": \{\n\+    "consequentialHint": true,\n\+    "readOnlyHint": false\n\+  \},/);
  const exposure = fixDiff(r.findings.find((f) => f.ruleId === 'WMCP-SEC-011'), pay);
  assert.match(exposure.after, /"exposedTo": \[\]/);
  assert.equal(fixDiff({ ruleId: 'WMCP-SEC-013' }, pay), null);
  assert.equal(fixDiff({ ruleId: 'WMCP-SEC-006' }, pay), null);
  assert.equal(unifiedDiff('a\nb', 'a\nc'), '--- observed\n+++ proposed\n a\n-b\n+c');
  const bidi = fixDiff(hint, { ...pay, description: 'Pay\u202e now' });
  assert.doesNotMatch(bidi.unified, /\u202e/);
});

test('declarative quick fix is escaped HTML without toolautosubmit or credential parameters', () => {
  const t = form({ autoSubmit: true, description: 'Send "a" <b>message</b>.', form: { method: 'post', controls: [{ name: 'pwd', type: 'password' }] },
    inputSchema: { type: 'object', properties: { message: { type: 'string' }, pwd: { type: 'string' } } } });
  const f = review([t]).findings.find((x) => x.ruleId === 'WMCP-SEC-008');
  const fix = quickFix(f, t);
  assert.equal(fix.language, 'html');
  assert.doesNotMatch(fix.code, /toolautosubmit=|name="pwd"|<b>/);
  assert.match(fix.code, /tooldescription="Send &#x22;a&#x22; &#x3c;b&#x3e;message&#x3c;\/b&#x3e;\."/);
  assert.match(fix.code, /name="message" toolparamdescription="TODO: describe this parameter\." type="text" maxlength="256"/);
});

test('a baseline made before engine v3 shows new-rule findings apart from regressions', () => {
  const t = tool({ callbackObservation: { status: 'source-text-inspected', labels: [] } });
  const d0 = discovery([t]);
  const old = makeBaseline(reviewSecurity({ discovery: d0 }), d0);
  delete old.engine;
  const d1 = discovery([{ ...t, callbackObservation: { status: 'source-text-inspected', labels: ['request-method-write'] } }]);
  const diff = diffBaseline(old, reviewSecurity({ discovery: d1 }), d1);
  assert.deepEqual(diff.newRules.map((f) => f.code), ['readonly-callback-mutation']);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.regressed, false);
  const current = makeBaseline(reviewSecurity({ discovery: d0 }), d0);
  assert.equal(current.engine, ENGINE_VERSION);
  assert.equal(diffBaseline(current, reviewSecurity({ discovery: d1 }), d1).regressed, true);
});

test('SARIF rules carry GitHub metadata: full description, help and security severity', () => {
  const d = discovery([tool({ callbackObservation: { status: 'source-text-inspected', labels: ['request-method-write'] } })]);
  const s = securitySarif(reviewSecurity({ discovery: d }), d);
  const rules = new Map(s.runs[0].tool.driver.rules.map((r) => [r.id, r]));
  for (const r of rules.values()) assert.ok(r.fullDescription.text && r.help.text && r.shortDescription.text, r.id);
  assert.equal(rules.get('WMCP-SEC-013').properties['security-severity'], '9.5');
  assert.equal(rules.get('WMCP-SEC-009').properties['security-severity'], '8.0');
  assert.equal(rules.get('WMCP-SEC-010').properties['security-severity'], '5.5');
  assert.equal(rules.get('WMCP-SEC-007').properties['security-severity'], '3.0');
  assert.ok(s.runs[0].results.some((r) => r.ruleId === 'WMCP-SEC-009' && r.level === 'error'));
});

test('snippet and diff encoders show every format character, supplementary ones included', () => {
  const hostile = 'a\u00ad\u061c\u180e\u202e\u2028\u{E0001}b';
  for (const out of [jsonLiteral(hostile), canonicalJson({ hostile })]) {
    assert.doesNotMatch(out, /[\u034f\u2028\u2029\p{Cf}]/u);
    assert.match(out, /\\udb40\\udc01/);
  }
  assert.equal(JSON.parse(JSON.parse(jsonLiteral(JSON.stringify(hostile)))), hostile);
  assert.doesNotMatch(htmlText(hostile), /[\u034f\u2028\u2029\p{Cf}]/u);
});
