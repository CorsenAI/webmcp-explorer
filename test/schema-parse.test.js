import test from 'node:test';
import assert from 'node:assert/strict';
import { toSchemaObject } from '../src/core/schema/parse.js';
import { buildFormModel } from '../src/core/schema/model.js';

test('an object passes through unchanged', () => {
  const schema = { type: 'object' };
  const r = toSchemaObject(schema);
  assert.equal(r.schema, schema);
  assert.equal(r.error, null);
});

// This is the Chrome 152 behaviour that broke the form: a JSON string, not an object.
test('a JSON string is parsed', () => {
  const r = toSchemaObject('{"type":"object","properties":{"q":{"type":"string"}}}');
  assert.equal(r.error, null);
  assert.equal(r.schema.properties.q.type, 'string');
});

test('null and empty string mean no schema, not an error', () => {
  assert.deepEqual(toSchemaObject(null), { schema: null, error: null });
  assert.deepEqual(toSchemaObject('   '), { schema: null, error: null });
});

test('malformed JSON is reported, never swallowed', () => {
  const r = toSchemaObject('{oops');
  assert.equal(r.schema, null);
  assert.match(r.error, /not valid JSON/);
});

test('a JSON scalar is rejected rather than treated as a schema', () => {
  const r = toSchemaObject('42');
  assert.equal(r.schema, null);
  assert.match(r.error, /did not parse to an object/);
});

// Defence in depth: the form model must survive being handed the raw string directly.
test('buildFormModel accepts a schema string as well as an object', () => {
  const m = buildFormModel('{"type":"object","properties":{"q":{"type":"string"}}}');
  assert.equal(m.fields.length, 1);
  assert.equal(m.fields[0].control, 'text');
});

test('buildFormModel reports an unparseable schema instead of showing no fields', () => {
  const m = buildFormModel('{broken');
  assert.equal(m.renderable, false);
  assert.equal(m.unsupported[0].reason, 'unparseable-schema');
});
