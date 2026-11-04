import test from 'node:test';
import assert from 'node:assert/strict';
import { staleness, STALE } from '../src/core/evals/stale.js';

const result = {
  tools: {
    search: { declaredFp: 'd-search', offeredFp: 'o-search' },
    add_to_cart: { declaredFp: 'd-cart', offeredFp: 'd-cart' },
  },
  cases: [
    { caseId: 'c1', expectTool: 'search' },
    { caseId: 'c2', expectTool: 'add_to_cart' },
    { caseId: 'c3', expectTool: null },
  ],
};

test('nothing is stale while the offered contracts are what the run saw', () => {
  const out = staleness(result, [
    { name: 'search', contractFp: 'd-search', offeredFp: 'o-search' },
    { name: 'add_to_cart', contractFp: 'd-cart' },
  ]);
  assert.equal(out.known, true);
  assert.equal(out.count, 0);
});

test('a case whose expected tool is offered differently now is stale, the others are not', () => {
  const out = staleness(result, [
    { name: 'search', contractFp: 'd-search', offeredFp: 'o-search-rewritten' },
    { name: 'add_to_cart', contractFp: 'd-cart' },
  ]);
  assert.deepEqual(out.byCase, { c1: { tool: 'search', reason: STALE.changed } });
  assert.equal(out.count, 1);
});

test('a page change to the declared contract counts too, since the offered one follows it', () => {
  const out = staleness(result, [
    { name: 'search', contractFp: 'd-search', offeredFp: 'o-search' },
    { name: 'add_to_cart', contractFp: 'd-cart-v2' },
  ]);
  assert.deepEqual(out.byCase, { c2: { tool: 'add_to_cart', reason: STALE.changed } });
});

test('a tool that left the page makes its cases gone', () => {
  const out = staleness(result, [{ name: 'search', contractFp: 'd-search', offeredFp: 'o-search' }]);
  assert.deepEqual(out.byCase, { c2: { tool: 'add_to_cart', reason: STALE.gone } });
});

test('a result recorded before fingerprints were kept is not declared fresh or stale', () => {
  const out = staleness({ cases: result.cases }, [{ name: 'search', contractFp: 'x' }]);
  assert.equal(out.known, false);
  assert.equal(out.count, 0);
});
