import test from 'node:test';
import assert from 'node:assert/strict';
import { CALLBACK_PATTERN_DATA, formFactsOf } from '../src/core/discovery-facts.js';
import { CALLBACK_PATTERNS, TRACE_PATTERN } from '../src/core/security/callback-source.js';
import { buildRegistry } from '../src/core/registry.js';
import { reviewSecurity } from '../src/core/security/review.js';

test('the probe receives exactly the engine patterns, as plain data', () => {
  assert.deepEqual(CALLBACK_PATTERN_DATA, [...CALLBACK_PATTERNS, TRACE_PATTERN].map(({ label, source, flags }) => ({ label, source, flags })));
  assert.deepEqual(JSON.parse(JSON.stringify(CALLBACK_PATTERN_DATA)), CALLBACK_PATTERN_DATA);
});

test('form facts keep names, types and markers of every control, never a value', () => {
  const facts = formFactsOf([{ name: 'contact_team', method: 'post', fields: [
    { tag: 'input', type: 'hidden', name: 'amount', value: 'SECRET' }, { tag: 'textarea', type: 'text', name: 'message', hasParamDescription: true, description: 'What to say.' },
    { tag: 'input', type: 'password', name: 'pw', autocomplete: 'current-password' }, { tag: 'select', type: 'text', name: '' }] }, { name: '' }]);
  assert.deepEqual(Object.keys(facts), ['contact_team']);
  assert.deepEqual(facts.contact_team.controls.map((c) => [c.name, c.type, c.autocomplete, c.hasParamDescription]),
    [['amount', 'hidden', null, false], ['message', 'textarea', null, true], ['pw', 'password', 'current-password', false], [null, 'select', null, false]]);
  assert.doesNotMatch(JSON.stringify(facts), /SECRET/);
});

test('the registry carries form facts, exposedTo and callback labels into the security review', async () => {
  const frame = { frameId: 0, documentId: 'd', isTopLevel: true, origin: 'https://shop.test', frameUrl: 'https://shop.test/', frameIndexPath: [],
    declarativeToolNames: ['contact_team'], declarativeAutoSubmitNames: ['contact_team'],
    formFacts: formFactsOf([{ name: 'contact_team', method: 'post', fields: [{ tag: 'input', type: 'hidden', name: 'amount' }] }]),
    tools: [
      { name: 'contact_team', description: 'Contact form for the support team.', inputSchema: { type: 'object', additionalProperties: false, properties: {} }, ownFrame: true, runtimeId: 'document' },
      { name: 'lookup_order', description: 'Look up one order.', inputSchema: { type: 'object', additionalProperties: false, properties: {} }, annotations: { readOnlyHint: true },
        ownFrame: true, runtimeId: 'document', registrationSource: 'imperative-document', exposedTo: ['https://partner.example'],
        callbackObservation: { status: 'source-text-inspected', labels: ['request-method-write'] } },
    ] };
  const registry = await buildRegistry({ topOrigin: 'https://shop.test', frames: [frame] });
  const contact = registry.tools.find((t) => t.name === 'contact_team'), lookup = registry.tools.find((t) => t.name === 'lookup_order');
  assert.deepEqual([contact.registrationType, contact.autoSubmit, contact.form.method], ['declarative', true, 'post']);
  assert.deepEqual([lookup.exposedTo, lookup.callbackObservation.labels], [['https://partner.example'], ['request-method-write']]);
  const codes = reviewSecurity({ discovery: { topOrigin: 'https://shop.test', tools: registry.tools, frames: [{ instrumented: true }], completeness: { ungrantedOrigins: [], refusedFrames: [] }, unreachableFrames: [] } })
    .findings.map((f) => `${f.toolName}:${f.code}`).sort();
  for (const code of ['contact_team:declarative-hidden-parameter', 'contact_team:declarative-post-auto-submit', 'lookup_order:exposed-to-cross-origin', 'lookup_order:readonly-callback-mutation']) assert.ok(codes.includes(code), `${code} in ${codes}`);
});
