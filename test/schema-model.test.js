import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFormModel } from '../src/core/schema/model.js';

test('an empty schema yields no fields and is renderable', () => {
  const m = buildFormModel({ type: 'object', properties: {} });
  assert.deepEqual(m.fields, []);
  assert.equal(m.renderable, true);
});

test('a missing schema is renderable with no fields, not a crash', () => {
  const m = buildFormModel(null);
  assert.deepEqual(m.fields, []);
  assert.equal(m.renderable, true);
});

test('a string property becomes a text control', () => {
  const m = buildFormModel({ type: 'object', properties: { q: { type: 'string' } } });
  assert.equal(m.fields.length, 1);
  assert.equal(m.fields[0].control, 'text');
  assert.deepEqual(m.fields[0].path, ['q']);
  assert.equal(m.fields[0].required, false);
});

test('required properties are marked', () => {
  const m = buildFormModel({
    type: 'object',
    properties: { q: { type: 'string' }, page: { type: 'integer' } },
    required: ['q'],
  });
  assert.equal(m.fields.find((f) => f.name === 'q').required, true);
  assert.equal(m.fields.find((f) => f.name === 'page').required, false);
});

test('description and default are carried to the control', () => {
  const m = buildFormModel({
    type: 'object',
    properties: { q: { type: 'string', description: 'Free text', default: 'shoes' } },
  });
  assert.equal(m.fields[0].description, 'Free text');
  assert.equal(m.fields[0].default, 'shoes');
});

test('integer and number map to a number control with their bounds', () => {
  const m = buildFormModel({
    type: 'object',
    properties: {
      count: { type: 'integer', minimum: 1, maximum: 10 },
      price: { type: 'number', minimum: 0 },
    },
  });
  const count = m.fields.find((f) => f.name === 'count');
  assert.equal(count.control, 'number');
  assert.equal(count.integer, true);
  assert.equal(count.minimum, 1);
  assert.equal(count.maximum, 10);
  assert.equal(m.fields.find((f) => f.name === 'price').integer, false);
});

test('boolean maps to a checkbox', () => {
  const m = buildFormModel({ type: 'object', properties: { fast: { type: 'boolean' } } });
  assert.equal(m.fields[0].control, 'checkbox');
});

test('a short enum becomes radios, a long one becomes a select', () => {
  const short = buildFormModel({
    type: 'object',
    properties: { cabin: { type: 'string', enum: ['economy', 'business'] } },
  });
  const long = buildFormModel({
    type: 'object',
    properties: { city: { type: 'string', enum: ['a', 'b', 'c', 'd', 'e'] } },
  });
  assert.equal(short.fields[0].control, 'radio');
  assert.deepEqual(short.fields[0].options, ['economy', 'business']);
  assert.equal(long.fields[0].control, 'select');
});

test('string formats map to dedicated controls', () => {
  const m = buildFormModel({
    type: 'object',
    properties: {
      when: { type: 'string', format: 'date' },
      who: { type: 'string', format: 'email' },
      site: { type: 'string', format: 'uri' },
      at: { type: 'string', format: 'date-time' },
    },
  });
  const by = Object.fromEntries(m.fields.map((f) => [f.name, f.control]));
  assert.deepEqual(by, { when: 'date', who: 'email', site: 'url', at: 'datetime-local' });
});

test('a long string becomes a textarea', () => {
  const m = buildFormModel({
    type: 'object',
    properties: { body: { type: 'string', maxLength: 5000 } },
  });
  assert.equal(m.fields[0].control, 'textarea');
});

test('nested objects are flattened into dotted paths, keeping the group', () => {
  const m = buildFormModel({
    type: 'object',
    properties: {
      filters: {
        type: 'object',
        properties: { min: { type: 'number' }, max: { type: 'number' } },
        required: ['min'],
      },
    },
  });
  assert.deepEqual(m.fields.map((f) => f.path), [['filters', 'min'], ['filters', 'max']]);
  assert.equal(m.fields[0].group, 'filters');
  assert.equal(m.fields[0].required, true);
});

test('an array of primitives becomes a repeatable list', () => {
  const m = buildFormModel({
    type: 'object',
    properties: { tags: { type: 'array', items: { type: 'string' } } },
  });
  assert.equal(m.fields[0].control, 'list');
  assert.equal(m.fields[0].itemControl, 'text');
});

test('an array of objects is not faked as a form', () => {
  const m = buildFormModel({
    type: 'object',
    properties: { rows: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } } },
  });
  assert.equal(m.fields[0].control, 'json');
  assert.equal(m.renderable, false);
  assert.equal(m.unsupported[0].reason, 'array-of-objects');
});

test('oneOf and anyOf are surfaced as unsupported rather than guessed', () => {
  const m = buildFormModel({
    type: 'object',
    properties: { pick: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
  });
  assert.equal(m.fields[0].control, 'json');
  assert.equal(m.renderable, false);
  assert.equal(m.unsupported[0].reason, 'one-of');
});

test('a $ref is reported honestly instead of silently dropped', () => {
  const m = buildFormModel({
    type: 'object',
    properties: { user: { $ref: '#/$defs/User' } },
  });
  assert.equal(m.fields[0].control, 'json');
  assert.equal(m.unsupported[0].reason, 'ref');
});

test('a property with no type is treated as free JSON, not as text', () => {
  const m = buildFormModel({ type: 'object', properties: { anything: {} } });
  assert.equal(m.fields[0].control, 'json');
});

test('a non-object root schema is not renderable as a form', () => {
  const m = buildFormModel({ type: 'string' });
  assert.equal(m.renderable, false);
  assert.equal(m.unsupported[0].reason, 'root-not-object');
});

test('property order follows the schema, not alphabetical order', () => {
  const m = buildFormModel({
    type: 'object',
    properties: { zulu: { type: 'string' }, alpha: { type: 'string' } },
  });
  assert.deepEqual(m.fields.map((f) => f.name), ['zulu', 'alpha']);
});

test('deep nesting stops at a sane depth instead of recursing forever', () => {
  let schema = { type: 'string' };
  for (let i = 0; i < 12; i += 1) {
    schema = { type: 'object', properties: { child: schema } };
  }
  const m = buildFormModel(schema);
  assert.equal(m.renderable, false);
  assert.ok(m.unsupported.some((u) => u.reason === 'too-deep'));
});
