import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptRoot } from '../src/core/agent/schema-adapt.js';
import { declareTools } from '../src/core/agent/tools.js';
import { DIALECTS } from '../src/core/agent/providers.js';

// The live case that broke Agent Lab on Anthropic (webmcp.corsen.ai, get_product, 2026-10-20):
// "tools.2.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level".
const GET_PRODUCT = {
  type: 'object',
  properties: {
    slug: { type: 'string', minLength: 1, maxLength: 200, description: 'The product slug.' },
    uri: { type: 'string', minLength: 1, maxLength: 2000, description: 'The product page URL.' },
  },
  oneOf: [{ type: 'object', required: ['slug'] }, { type: 'object', required: ['uri'] }],
  additionalProperties: false,
};

const COMBINATORS = ['oneOf', 'anyOf', 'allOf'];

test('a root oneOf of required fields becomes a plain object plus a stated rule', () => {
  const out = adaptRoot(GET_PRODUCT);
  assert.equal(out.adapted, true);
  for (const k of COMBINATORS) assert.equal(out.schema[k], undefined, k);
  assert.equal(out.schema.type, 'object');
  assert.deepEqual(Object.keys(out.schema.properties), ['slug', 'uri']);
  assert.equal(out.schema.additionalProperties, false);
  assert.equal(out.schema.required, undefined);
  assert.equal(out.rule, 'Provide exactly one of: slug, uri.');
  assert.ok(GET_PRODUCT.oneOf, 'the page schema itself is never modified');
});

test('a root anyOf of required fields says "at least one"', () => {
  const out = adaptRoot({ type: 'object', properties: { a: {}, b: {} }, anyOf: [{ required: ['a'] }, { required: ['b'] }] });
  assert.equal(out.rule, 'Provide at least one of: a, b.');
  assert.equal(out.schema.anyOf, undefined);
});

test('alternatives that need several fields are named as sets', () => {
  const out = adaptRoot({ type: 'object', properties: { id: {}, name: {}, zip: {} },
    oneOf: [{ required: ['id'] }, { required: ['name', 'zip'] }] });
  assert.equal(out.rule, 'Provide exactly one of these sets: (id) or (name, zip).');
});

test('a root allOf merges into one object without a rule', () => {
  const out = adaptRoot({ allOf: [
    { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
  ] });
  assert.equal(out.adapted, true);
  assert.equal(out.schema.type, 'object');
  assert.deepEqual(out.schema.properties, { a: { type: 'string' }, b: { type: 'number' } });
  assert.deepEqual(out.schema.required, ['a', 'b']);
  assert.equal(out.schema.allOf, undefined);
  assert.equal(out.rule, null);
});

test('alternatives with their own properties are merged and described', () => {
  const out = adaptRoot({ oneOf: [
    { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
  ] });
  assert.deepEqual(Object.keys(out.schema.properties), ['id', 'email']);
  assert.equal(out.schema.required, undefined);
  assert.equal(out.rule, 'Provide exactly one of: id, email.');
});

test('a schema without a root combinator is left exactly as it is', () => {
  const plain = { type: 'object', properties: { q: { type: 'string', anyOf: [{ minLength: 1 }] } }, required: ['q'] };
  const out = adaptRoot(plain);
  assert.equal(out.adapted, false);
  assert.equal(out.schema, plain);
  assert.equal(out.rule, null);
});

test('every dialect receives a root without combinators, the rule in the description, and the adaptation listed', () => {
  const tools = [{ logicalId: 't1', name: 'get_product', origin: 'https://shop.example', frameId: 0,
    description: 'Read one product.', inputSchema: GET_PRODUCT }];
  for (const dialect of [DIALECTS.anthropicMessages, DIALECTS.openaiResponses, DIALECTS.openaiChat, DIALECTS.geminiGenerate]) {
    const { declarations, adapted } = declareTools(tools, dialect);
    const d = declarations[0];
    const schema = d.input_schema ?? d.parameters ?? d.function?.parameters;
    const description = d.description ?? d.function?.description;
    for (const k of COMBINATORS) assert.equal(schema[k], undefined, `${dialect} ${k}`);
    assert.match(description, /Provide exactly one of: slug, uri\./, dialect);
    assert.deepEqual(adapted, [{ name: 'get_product', rule: 'Provide exactly one of: slug, uri.' }], dialect);
  }
});

test('Gemini keeps the documented Schema fields instead of dropping them', () => {
  const tools = [{ logicalId: 't2', name: 'search', origin: 'https://x.example', frameId: 0, description: 'Search.',
    inputSchema: { type: 'object', properties: {
      q: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[a-z]+$', title: 'Query', default: 'a' },
      kind: { oneOf: [{ type: 'string', enum: ['a'] }, { type: 'integer' }] },
      tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
      note: { type: ['string', 'null'] },
    }, required: ['q'], additionalProperties: false } }];
  const { declarations } = declareTools(tools, DIALECTS.geminiGenerate);
  const p = declarations[0].parameters;
  assert.deepEqual(p.properties.q, { type: 'string', minLength: 1, maxLength: 200, pattern: '^[a-z]+$', title: 'Query', default: 'a' });
  assert.deepEqual(p.properties.kind, { anyOf: [{ type: 'string', enum: ['a'] }, { type: 'integer' }] });
  assert.deepEqual(p.properties.tags, { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 });
  assert.deepEqual(p.properties.note, { type: 'string', nullable: true });
  assert.equal(p.additionalProperties, undefined, 'not a Gemini Schema field');
});

test('a field every alternative requires stays required (agav#359)', () => {
  const out = adaptRoot({ type: 'object', properties: { a: {}, b: {}, c: {} },
    oneOf: [{ required: ['a', 'b'] }, { required: ['a', 'c'] }] });
  assert.deepEqual(out.schema.required, ['a']);
  assert.equal(out.rule, 'Provide exactly one of these sets: (a, b) or (a, c).');
});

test('properties named like Object.prototype members merge as plain names (agav#359)', () => {
  const branch = JSON.parse('{"type":"object","properties":{"constructor":{"type":"string"},"__proto__":{"type":"number"},"toString":{"type":"boolean"}},"required":["constructor"]}');
  const out = adaptRoot({ oneOf: [branch, { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }] });
  assert.deepEqual(Object.keys(out.schema.properties), ['constructor', '__proto__', 'toString', 'id']);
  assert.equal(Object.getPrototypeOf(out.schema.properties), Object.prototype);
  assert.deepEqual(out.schema.properties.constructor, { type: 'string' });
  assert.deepEqual(JSON.parse(JSON.stringify(out.schema.properties))['__proto__'], { type: 'number' });
});
