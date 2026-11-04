import test from 'node:test';
import assert from 'node:assert/strict';
import { createSavedCall, addSavedCall, reviewSavedCall, savedChecksForPage, defaultName, REVIEW, SAVED_CALLS_PER_TOOL }
  from '../src/core/saved-calls.js';

const schema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    category: { type: 'string', enum: ['laptops', 'phones'] },
    maxPrice: { type: 'number', minimum: 0 },
  },
  required: ['query'],
};

const tool = (over = {}) => ({
  name: 'search_products', origin: 'http://a.test', logicalId: 'lid-1', contractFp: 'fp-1',
  inputSchema: schema, ...over,
});

const AT = Date.parse('2026-09-10T10:00:00.000Z');

test('a saved call records the tool, the contract and a copy of the arguments', () => {
  const args = { query: 'jacket', category: 'phones' };
  const saved = createSavedCall({ tool: tool(), name: ' Jackets ', args, at: AT, id: 'sc-1' });
  assert.equal(saved.name, 'Jackets');
  assert.equal(saved.logicalId, 'lid-1');
  assert.equal(saved.contractFp, 'fp-1');
  assert.equal(saved.savedAt, AT);
  assert.deepEqual(saved.args, args);
  args.query = 'changed after saving';
  assert.equal(saved.args.query, 'jacket', 'the saved arguments are a copy, not a reference');
});

test('a call saved without a name is named after its arguments', () => {
  assert.equal(defaultName({}), 'no arguments');
  assert.equal(defaultName({ query: 'x' }), '{"query":"x"}');
  const long = defaultName({ query: 'a'.repeat(80) });
  assert.ok(long.length <= 48 && long.endsWith('…'));
  assert.equal(createSavedCall({ tool: tool(), args: { q: 1 }, at: AT }).name, '{"q":1}');
});

test('adding keeps the newest first, replaces a call of the same name, and caps the list', () => {
  let list = [];
  for (let i = 0; i < SAVED_CALLS_PER_TOOL + 3; i += 1) {
    list = addSavedCall(list, createSavedCall({ tool: tool(), name: `call ${i}`, args: { query: String(i) }, at: AT + i }));
  }
  assert.equal(list.length, SAVED_CALLS_PER_TOOL);
  assert.equal(list[0].name, `call ${SAVED_CALLS_PER_TOOL + 2}`);
  const replaced = addSavedCall(list, createSavedCall({ tool: tool(), name: 'call 5', args: { query: 'new' }, at: AT + 100 }));
  assert.equal(replaced.filter((c) => c.name === 'call 5').length, 1);
  assert.equal(replaced[0].args.query, 'new');
});

test('a call whose arguments still validate is ok, even with the same contract', () => {
  const saved = createSavedCall({ tool: tool(), args: { query: 'x', category: 'laptops' }, at: AT });
  assert.deepEqual(reviewSavedCall(saved, tool()), { status: REVIEW.ok, contractChanged: false, problems: [] });
});

test('a schema change that breaks the arguments flags the call for review, naming the problem', () => {
  const saved = createSavedCall({ tool: tool(), args: { query: 'x', category: 'laptops' }, at: AT });
  const stricter = tool({
    contractFp: 'fp-2',
    inputSchema: { ...schema, properties: { ...schema.properties, category: { type: 'string', enum: ['phones'] } }, required: ['query', 'maxPrice'] },
  });
  const review = reviewSavedCall(saved, stricter);
  assert.equal(review.status, REVIEW.needsReview);
  assert.equal(review.contractChanged, true);
  assert.ok(review.problems.length >= 1);
  assert.ok(review.problems.some((p) => /maxPrice is required/.test(p)));
});

test('a contract change the validator cannot vouch for is also flagged, and says why', () => {
  const saved = createSavedCall({ tool: tool(), args: { query: 'x' }, at: AT });
  const opaque = tool({ contractFp: 'fp-3', inputSchema: { type: 'object', oneOf: [{ required: ['query'] }, { required: ['id'] }] } });
  const review = reviewSavedCall(saved, opaque);
  assert.equal(review.status, REVIEW.needsReview);
  assert.match(review.problems[0], /cannot be checked/);
});

test('a description-only change keeps the call ok but says the contract moved', () => {
  const saved = createSavedCall({ tool: tool(), args: { query: 'x' }, at: AT });
  const review = reviewSavedCall(saved, tool({ contractFp: 'fp-desc' }));
  assert.equal(review.status, REVIEW.ok);
  assert.equal(review.contractChanged, true);
});

test('a call for a tool that is no longer on the page is tool-gone, never deleted here', () => {
  const saved = createSavedCall({ tool: tool(), args: { query: 'x' }, at: AT });
  assert.equal(reviewSavedCall(saved, null).status, REVIEW.toolGone);
});

import { judgeSavedCall, expectationFromOutcome, normalizeExpect, EXPECT, VERDICT } from '../src/core/saved-calls.js';

test('a saved call without an expectation is a bookmark: running it judges nothing', () => {
  const saved = createSavedCall({ tool: tool(), name: 'x', args: {}, at: AT, id: 'sc-b' });
  assert.equal(saved.expect, null);
  assert.equal(judgeSavedCall(saved, { ok: true, result: 'anything' }).verdict, VERDICT.notAcheck);
});

test('an expectation drawn from a result: JSON when it parses, exact text otherwise, failure when the call failed', () => {
  assert.deepEqual(expectationFromOutcome({ ok: true, result: '{"a":1}' }), { kind: EXPECT.jsonEquals, value: '{"a":1}' });
  assert.deepEqual(expectationFromOutcome({ ok: true, result: 'plain' }), { kind: EXPECT.equals, value: 'plain' });
  assert.deepEqual(expectationFromOutcome({ ok: false, error: 'nope' }), { kind: EXPECT.error });
  assert.equal(normalizeExpect({ kind: 'bogus' }), null);
});

test('JSON checks preserve exact numbers and equivalent decimal spellings', () => {
  const verdict = (want, got) => judgeSavedCall({ expect: { kind: EXPECT.jsonEquals, value: want } }, { ok: true, result: got }).verdict;
  for (const [want, got] of [
    ['{"id":9007199254740992}', '{"id":9007199254740993}'],
    ['{"v":1e400}', '{"v":2e400}'],
    ['{"v":1.00000000000000001}', '{"v":1}'],
    ['{"v":1e-400}', '{"v":0}'],
    ['{"v":null}', '{"v":1e400}'],
    ['{"v":"1e0"}', '{"v":1}'],
  ]) assert.equal(verdict(want, got), VERDICT.fail, `${want} != ${got}`);
  for (const [want, got] of [
    ['{"x":1.0,"y":-0}', '{"y":0,"x":10e-1}'],
    ['[1e400,0.000012300]', '[10e399,123e-7]'],
    ['{"x":1e999999999999999999999}', '{"x":10e999999999999999999998}'],
  ]) assert.equal(verdict(want, got), VERDICT.pass, `${want} == ${got}`);
});

test('json-equals passes on a reordered result and fails, with the place, on a changed one', () => {
  const saved = createSavedCall({ tool: tool(), name: 'c', args: {}, at: AT, id: 'sc-c', expect: { kind: EXPECT.jsonEquals, value: '{"total": 3, "items": ["a", "b"]}' } });
  assert.equal(judgeSavedCall(saved, { ok: true, result: '{"items":["a","b"],"total":3}' }).verdict, VERDICT.pass);
  const failed = judgeSavedCall(saved, { ok: true, result: '{"items":["a","b"],"total":4}' });
  assert.equal(failed.verdict, VERDICT.fail);
  assert.match(failed.reason, /at character \d+/);
  assert.equal(judgeSavedCall(saved, { ok: true, result: 'not json' }).verdict, VERDICT.fail);
  assert.match(judgeSavedCall(saved, { ok: false, error: 'boom' }).reason, /the call failed: boom/);
});

test('ok, error and equals expectations judge as their names say; a cancelled call is no verdict', () => {
  const mk = (expect) => createSavedCall({ tool: tool(), name: 'e', args: {}, at: AT, id: 'sc-e', expect });
  assert.equal(judgeSavedCall(mk({ kind: EXPECT.ok }), { ok: true, result: '' }).verdict, VERDICT.pass);
  assert.equal(judgeSavedCall(mk({ kind: EXPECT.ok }), { ok: false, error: 'x' }).verdict, VERDICT.fail);
  assert.equal(judgeSavedCall(mk({ kind: EXPECT.error }), { ok: false, error: 'x' }).verdict, VERDICT.pass);
  assert.equal(judgeSavedCall(mk({ kind: EXPECT.error }), { ok: true, result: 'fine' }).verdict, VERDICT.fail);
  assert.equal(judgeSavedCall(mk({ kind: EXPECT.equals, value: 'exact' }), { ok: true, result: 'exact' }).verdict, VERDICT.pass);
  assert.equal(judgeSavedCall(mk({ kind: EXPECT.equals, value: 'exact' }), { ok: true, result: 'Exact' }).verdict, VERDICT.fail);
  assert.equal(judgeSavedCall(mk({ kind: EXPECT.ok }), { ok: false, code: 'cancelled', cancelled: true }).verdict, VERDICT.notAcheck);
});


test('a removed cross-origin tool stays in its embedding site checks and not another site', () => {
  const saved = createSavedCall({ tool: tool(), topOrigin: 'https://parent.test', args: {}, expect: { kind: 'ok' } });
  assert.equal(saved.origin, 'http://a.test');
  assert.equal(saved.topOrigin, 'https://parent.test');
  assert.deepEqual(savedChecksForPage([saved], [], 'https://parent.test'), [saved]);
  assert.deepEqual(savedChecksForPage([saved], [], 'http://a.test'), []);
  assert.deepEqual(savedChecksForPage([saved], [], 'https://unrelated.test'), []);
});

test('old calls keep live-tool and same-origin discovery without guessing their missing parent', () => {
  const saved = createSavedCall({ tool: tool(), args: {}, expect: { kind: 'ok' } });
  delete saved.topOrigin;
  assert.deepEqual(savedChecksForPage([saved], [tool()], 'https://parent.test'), [saved]);
  assert.deepEqual(savedChecksForPage([saved], [], 'http://a.test'), [saved]);
  assert.deepEqual(savedChecksForPage([saved], [], 'https://parent.test'), []);
  const bookmark = { ...saved, expect: null };
  assert.deepEqual(savedChecksForPage([bookmark], [tool()], 'http://a.test'), []);
});
