import test from 'node:test';
import assert from 'node:assert/strict';
import { validateArguments } from '../src/core/schema/validate.js';

// The validator promises to list what it could not check. A combinator at the root of the
// schema used to slip through with a clean "valid" and an empty `unchecked`.
test('a oneOf at the root of the schema is reported as unchecked, not silently accepted', () => {
  const out = validateArguments(
    { type: 'object', oneOf: [{ required: ['query'] }, { required: ['id'] }] },
    { query: 'x' },
  );
  assert.equal(out.valid, true);
  assert.deepEqual(out.unchecked, [{ path: [], reason: 'one-of' }]);
});

test('a $ref at the root is reported too, and the checkable part is still checked', () => {
  const out = validateArguments(
    { type: 'object', $ref: '#/definitions/x', properties: { n: { type: 'integer' } }, required: ['n'] },
    { n: 'not a number' },
  );
  assert.equal(out.valid, false);
  assert.equal(out.unchecked[0].reason, 'ref');
  assert.match(out.errors[0].message, /must be integer/);
});

test('a plain object schema reports nothing unchecked', () => {
  const out = validateArguments({ type: 'object', properties: { q: { type: 'string' } } }, { q: 'x' });
  assert.deepEqual(out.unchecked, []);
});
