import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTools, facetsOf, sortTools } from '../src/core/filter.js';

const tools = [
  { name: 'search_products', description: 'Search the catalogue', origin: 'https://shop.test', frameId: 0, annotations: { readOnlyHint: true }, registrationType: 'unknown' },
  { name: 'add_to_cart', description: 'Add an item', origin: 'https://shop.test', frameId: 0, annotations: {}, registrationType: 'declarative' },
  { name: 'pay', description: 'Take payment', origin: 'https://pay.test', frameId: null, annotations: { readOnlyHint: true, untrustedContentHint: true }, registrationType: 'unknown' },
];

test('an empty query returns everything, sorted by name', () => {
  assert.deepEqual(filterTools(tools, {}).map((t) => t.name), ['add_to_cart', 'pay', 'search_products']);
});

test('the query matches name, description and origin', () => {
  assert.deepEqual(filterTools(tools, { query: 'cart' }).map((t) => t.name), ['add_to_cart']);
  assert.deepEqual(filterTools(tools, { query: 'catalogue' }).map((t) => t.name), ['search_products']);
  assert.deepEqual(filterTools(tools, { query: 'pay.test' }).map((t) => t.name), ['pay']);
});

test('the query is case-insensitive and ignores surrounding spaces', () => {
  assert.deepEqual(filterTools(tools, { query: '  CART ' }).map((t) => t.name), ['add_to_cart']);
});

test('selected annotations narrow the list rather than widening it', () => {
  const both = filterTools(tools, { annotations: ['readOnlyHint', 'untrustedContentHint'] });
  assert.deepEqual(both.map((t) => t.name), ['pay']);
});

test('origins can be restricted', () => {
  assert.deepEqual(
    filterTools(tools, { origins: ['https://pay.test'] }).map((t) => t.name),
    ['pay'],
  );
});

test('filters combine', () => {
  const r = filterTools(tools, { query: 'a', annotations: ['readOnlyHint'], origins: ['https://shop.test'] });
  assert.deepEqual(r.map((t) => t.name), ['search_products']);
});

test('no match yields an empty list, never a throw', () => {
  assert.deepEqual(filterTools(tools, { query: 'zzz' }), []);
});

test('sorting by frame puts tools with no frame last, not first', () => {
  const sorted = sortTools(tools, 'frame');
  assert.equal(sorted[sorted.length - 1].name, 'pay');
});

test('sorting by origin groups by origin then name', () => {
  assert.deepEqual(sortTools(tools, 'origin').map((t) => t.name), ['pay', 'add_to_cart', 'search_products']);
});

// Chrome 152 never returns consequentialHint, so offering it as a facet would be a filter
// that can never match. Facets are derived from what actually came back.
test('facets are derived from the data, with counts', () => {
  const f = facetsOf(tools);
  assert.deepEqual(f.annotations, [
    { key: 'readOnlyHint', count: 2 },
    { key: 'untrustedContentHint', count: 1 },
  ]);
  assert.deepEqual(f.origins.map((o) => o.key), ['https://pay.test', 'https://shop.test']);
  assert.deepEqual(f.registrations, [{ key: 'declarative', count: 1 }]);
});

test('facets of an empty list are empty, not undefined', () => {
  assert.deepEqual(facetsOf([]), { annotations: [], origins: [], registrations: [], severities: [] });
});
