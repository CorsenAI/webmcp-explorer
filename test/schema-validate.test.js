import test from 'node:test';
import assert from 'node:assert/strict';
import { validateArguments } from '../src/core/schema/validate.js';

const schema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    count: { type: 'integer', minimum: 1, maximum: 10 },
    cabin: { type: 'string', enum: ['economy', 'business'] },
    fast: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['query'],
};

test('valid arguments produce no errors', () => {
  const r = validateArguments(schema, { query: 'shoes', count: 3, cabin: 'economy' });
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test('a missing required property is reported with its path', () => {
  const r = validateArguments(schema, { count: 3 });
  assert.equal(r.valid, false);
  assert.deepEqual(r.errors, [{ path: ['query'], code: 'required', message: 'query is required' }]);
});

test('a wrong type is reported', () => {
  const r = validateArguments(schema, { query: 42 });
  assert.equal(r.valid, false);
  assert.equal(r.errors[0].code, 'type');
});

test('a non-integer number is rejected for an integer property', () => {
  const r = validateArguments(schema, { query: 'a', count: 2.5 });
  assert.equal(r.errors[0].code, 'type');
});

test('bounds are enforced on both sides', () => {
  assert.equal(validateArguments(schema, { query: 'a', count: 0 }).errors[0].code, 'minimum');
  assert.equal(validateArguments(schema, { query: 'a', count: 99 }).errors[0].code, 'maximum');
});

test('a value outside the enum is rejected and lists what is allowed', () => {
  const r = validateArguments(schema, { query: 'a', cabin: 'first' });
  assert.equal(r.errors[0].code, 'enum');
  assert.match(r.errors[0].message, /economy/);
});

test('array item types are checked', () => {
  const r = validateArguments(schema, { query: 'a', tags: ['ok', 5] });
  assert.equal(r.errors[0].code, 'type');
  assert.deepEqual(r.errors[0].path, ['tags', 1]);
});

test('an unknown property is reported as a warning, never as an error', () => {
  const r = validateArguments(schema, { query: 'a', nope: 1 });
  assert.equal(r.valid, true);
  assert.equal(r.warnings[0].code, 'unknown-property');
});

test('nested object properties are validated by path', () => {
  const nested = {
    type: 'object',
    properties: {
      filters: { type: 'object', properties: { min: { type: 'number' } }, required: ['min'] },
    },
  };
  const r = validateArguments(nested, { filters: {} });
  assert.deepEqual(r.errors[0].path, ['filters', 'min']);
});

test('a null argument object fails cleanly rather than throwing', () => {
  const r = validateArguments(schema, null);
  assert.equal(r.valid, false);
  assert.equal(r.errors[0].code, 'type');
});

// Explorer must not claim a tool is broken because the validator is incomplete.
test('constructs the validator cannot check are declared, not silently passed', () => {
  const r = validateArguments(
    { type: 'object', properties: { pick: { oneOf: [{ type: 'string' }] } } },
    { pick: 'x' },
  );
  assert.equal(r.valid, true);
  assert.equal(r.unchecked[0].reason, 'one-of');
});

test('an absent schema means nothing can be checked, and that is stated', () => {
  const r = validateArguments(null, { anything: true });
  assert.equal(r.valid, true);
  assert.equal(r.unchecked[0].reason, 'no-schema');
});
