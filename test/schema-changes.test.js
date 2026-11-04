import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSchemaChanges, summarizeSchemaChanges, SCHEMA_CHANGE } from '../src/core/snapshots/schema-changes.js';

const BEFORE = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'What to look for' },
    maxPrice: { type: 'number', maximum: 500 },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['query'],
};

test('two equivalent schemas, whatever the key order, have no change', () => {
  const reordered = { required: ['query'], properties: { tags: BEFORE.properties.tags, maxPrice: { maximum: 500, type: 'number' }, query: BEFORE.properties.query }, type: 'object' };
  assert.deepEqual(describeSchemaChanges(BEFORE, reordered), []);
  assert.deepEqual(describeSchemaChanges(JSON.stringify(BEFORE), reordered), [], 'a string form of the same schema is not a change');
});

test('a property that became required, a shrunk enum and a tightened maximum are each named', () => {
  const after = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look for', enum: ['jackets', 'boots'] },
      maxPrice: { type: 'number', maximum: 100 },
      limit: { type: 'integer', minimum: 1 },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['query', 'limit'],
  };
  const changes = describeSchemaChanges(BEFORE, after);
  const kinds = changes.map((c) => `${c.kind}@${c.path.join('.')}`);
  assert.deepEqual(kinds, [
    'property-added@limit',
    'constraint-changed@maxPrice',
    'enum-changed@query',
  ]);
  assert.equal(changes[0].text, 'limit was added, and it is required');
  assert.equal(changes[1].text, "maxPrice: maximum went from 500 to 100");
  assert.equal(changes[2].text, "query now accepts only: 'jackets', 'boots'");
  assert.equal(summarizeSchemaChanges(changes, { max: 2 }), "limit was added, and it is required; maxPrice: maximum went from 500 to 100; and 1 more");
});

test('a removed property, a type change, a loosened requirement and an enum that lost a value', () => {
  const before = { type: 'object', properties: { a: { type: 'string', enum: ['x', 'y'] }, b: { type: 'number' }, c: { type: 'string' } }, required: ['a', 'c'] };
  const after = { type: 'object', properties: { a: { type: 'string', enum: ['x'] }, b: { type: 'string' } }, required: ['a'] };
  const changes = describeSchemaChanges(before, after);
  assert.deepEqual(changes.map((c) => c.text), [
    "a lost 'y'",
    'b is now string (was number)',
    'c was removed',
  ]);
  assert.equal(changes[0].kind, SCHEMA_CHANGE.enumChanged);
  assert.deepEqual(changes[0].lost, ['y']);
});

test('nested objects and array items are walked, and a description change is a change', () => {
  const before = { type: 'object', properties: { filter: { type: 'object', properties: { colour: { type: 'string' } } }, items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } } } };
  const after = { type: 'object', properties: { filter: { type: 'object', properties: { colour: { type: 'string', description: 'A colour name' }, size: { type: 'string' } }, required: ['size'] }, items: { type: 'array', items: { type: 'object', properties: { id: { type: 'number' } } } } } };
  const texts = describeSchemaChanges(before, after).map((c) => c.text);
  assert.deepEqual(texts, [
    'filter.colour: description changed',
    'filter.size was added, and it is required',
    'items.[].id is now number (was string)',
  ]);
});

test('a schema that stops being an object schema is one root change, not a list of removals', () => {
  const changes = describeSchemaChanges(BEFORE, 'not json');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, SCHEMA_CHANGE.rootChanged);
  assert.deepEqual(describeSchemaChanges(null, null), []);
  assert.equal(summarizeSchemaChanges([]), '');
});
