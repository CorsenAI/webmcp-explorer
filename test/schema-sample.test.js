import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleArguments } from '../src/core/schema/sample.js';

const NOW = new Date('2026-09-04T10:30:00Z');

test('interactive starters omit invented optional filters while preserving declared defaults', () => {
  const schema = { type: 'object', properties: {
    query: { type: 'string' },
    category: { type: 'string', enum: ['laptops', 'phones'] },
    maxPrice: { type: 'number', minimum: 0 },
    limit: { type: 'integer', default: 10 },
    inStock: { type: 'boolean', default: true },
    optionalGroup: { type: 'object', properties: { limit: { type: 'number', default: 2 } } },
  }, required: ['query'] };
  assert.deepEqual(sampleArguments(schema, { requiredOnly: true, includeOptionalDefaults: true }),
    { query: 'query', limit: 10, inStock: true });
  // Evaluation/example generation retains its explicit all-properties behavior.
  assert.equal(sampleArguments(schema).maxPrice, 0);
  assert.deepEqual(sampleArguments(schema, { requiredOnly: true }), { query: 'query' });
});

test('default wins over everything else', () => {
  const v = sampleArguments({
    type: 'object',
    properties: { q: { type: 'string', default: 'chosen', examples: ['other'], enum: ['a'] } },
  }, { now: NOW });
  assert.equal(v.q, 'chosen');
});

test('the first example is used when there is no default', () => {
  const v = sampleArguments({
    type: 'object',
    properties: { q: { type: 'string', examples: ['first', 'second'] } },
  }, { now: NOW });
  assert.equal(v.q, 'first');
});

test('the first enum value is used when there is no default or example', () => {
  const v = sampleArguments({
    type: 'object',
    properties: { cabin: { type: 'string', enum: ['economy', 'business'] } },
  }, { now: NOW });
  assert.equal(v.cabin, 'economy');
});

test('minimum is used for numbers, and stays an integer for integers', () => {
  const v = sampleArguments({
    type: 'object',
    properties: {
      count: { type: 'integer', minimum: 2 },
      price: { type: 'number', minimum: 1.5 },
      plain: { type: 'integer' },
    },
  }, { now: NOW });
  assert.equal(v.count, 2);
  assert.equal(v.price, 1.5);
  assert.equal(Number.isInteger(v.plain), true);
});

test('date formats are generated from the injected clock, not the wall clock', () => {
  const v = sampleArguments({
    type: 'object',
    properties: {
      day: { type: 'string', format: 'date' },
      moment: { type: 'string', format: 'date-time' },
    },
  }, { now: NOW });
  assert.equal(v.day, '2026-09-04');
  assert.equal(v.moment, NOW.toISOString());
});

test('email and uri formats get plausible placeholder values', () => {
  const v = sampleArguments({
    type: 'object',
    properties: {
      who: { type: 'string', format: 'email' },
      site: { type: 'string', format: 'uri' },
    },
  }, { now: NOW });
  assert.match(v.who, /@/);
  assert.match(v.site, /^https:\/\//);
});

test('booleans default to false rather than a surprising true', () => {
  const v = sampleArguments({ type: 'object', properties: { fast: { type: 'boolean' } } }, { now: NOW });
  assert.equal(v.fast, false);
});

test('a plain string falls back to the property name, which reads better than empty', () => {
  const v = sampleArguments({ type: 'object', properties: { query: { type: 'string' } } }, { now: NOW });
  assert.equal(v.query, 'query');
});

test('arrays produce exactly one sample item', () => {
  const v = sampleArguments({
    type: 'object',
    properties: { tags: { type: 'array', items: { type: 'string', examples: ['red'] } } },
  }, { now: NOW });
  assert.deepEqual(v.tags, ['red']);
});

test('nested objects are generated recursively', () => {
  const v = sampleArguments({
    type: 'object',
    properties: {
      filters: { type: 'object', properties: { min: { type: 'integer', minimum: 5 } } },
    },
  }, { now: NOW });
  assert.deepEqual(v.filters, { min: 5 });
});

test('requiredOnly generates just the required properties', () => {
  const schema = {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'string' } },
    required: ['a'],
  };
  const v = sampleArguments(schema, { now: NOW, requiredOnly: true });
  assert.deepEqual(Object.keys(v), ['a']);
});

test('an absent or non-object schema yields an empty object, never a throw', () => {
  assert.deepEqual(sampleArguments(null, { now: NOW }), {});
  assert.deepEqual(sampleArguments({ type: 'string' }, { now: NOW }), {});
});

test('generation is deterministic for the same clock', () => {
  const schema = { type: 'object', properties: { d: { type: 'string', format: 'date' } } };
  assert.deepEqual(sampleArguments(schema, { now: NOW }), sampleArguments(schema, { now: NOW }));
});

test('recursion stops instead of hanging on a deeply nested schema', () => {
  let schema = { type: 'string' };
  for (let i = 0; i < 20; i += 1) schema = { type: 'object', properties: { c: schema } };
  const v = sampleArguments(schema, { now: NOW });
  assert.equal(typeof v, 'object');
});
