import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDisplayJson, DisplayNumber } from '../src/core/json-display.js';

test('readable results retain numeric spelling instead of silently rounding it', () => {
  const values = parseDisplayJson('[9007199254740993,1.00000000000000001,-0,1e400]');
  assert(values.every(v => v instanceof DisplayNumber));
  assert.deepEqual(values.map(v=>v.text), ['9007199254740993','1.00000000000000001','-0','1e400']);
});

test('nested results keep string, boolean, null and object keys distinct', () => {
  const value = parseDisplayJson('{"__proto__":{"n":0},"empty":"","bool":false,"none":null,"number":"9007199254740993"}');
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(value.__proto__.n.text, '0');
  assert.equal(value.empty, ''); assert.equal(value.bool, false); assert.equal(value.none, null);
  assert.equal(value.number, '9007199254740993');
});

test('plain or malformed output stays original text rather than being guessed', () => {
  for (const text of ['hello','{broken','null','42','"quoted"',null]) assert.equal(parseDisplayJson(text),null);
  assert.deepEqual(parseDisplayJson('[]'),[]);
  assert.deepEqual(parseDisplayJson('{}'),{});
});
