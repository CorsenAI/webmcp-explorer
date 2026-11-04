import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTool, checkTools, CHECK, LEVEL } from '../src/core/checks.js';

const good = {
  instanceId: 'a@0', logicalId: 'a', name: 'search_products',
  description: 'Search the product catalogue by keyword, category and maximum price.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Free text search' } },
    required: ['query'],
  },
  annotations: { readOnlyHint: true, untrustedContentHint: false },
};

const codes = (result) => result.items.map((item) => item.code);

test('a complete contract has nothing flagged', () => {
  const out = checkTool(good, [good]);
  assert.deepEqual(codes(out), []);
  assert.equal(out.warnings, 0);
  assert.equal(out.notes, 0);
});

test('a missing description is a warning, a short one a note with its length', () => {
  assert.deepEqual(codes(checkTool({ ...good, description: '' })), [CHECK.noDescription]);
  const short = checkTool({ ...good, description: 'Search things.' });
  assert.deepEqual(short.items[0], { code: CHECK.shortDescription, level: LEVEL.note, detail: '14' });
});

test('two tools with the same description are each warned, naming the other', () => {
  const twin = { ...good, instanceId: 'b@0', logicalId: 'b', name: 'find_products' };
  const out = checkTool(good, [good, twin]);
  assert.deepEqual(out.items, [{ code: CHECK.duplicateDescription, level: LEVEL.warn, detail: 'find_products' }]);
  // Case and spacing do not make two descriptions different to a model.
  const loose = { ...twin, description: `  ${good.description.toUpperCase()} ` };
  assert.equal(checkTool(good, [good, loose]).warnings, 1);
});

test('schema problems: unparseable, absent, not an object, undescribed properties, undeclared required', () => {
  assert.deepEqual(codes(checkTool({ ...good, inputSchema: null, schemaError: 'inputSchema is not valid JSON: x' })),
    [CHECK.schemaError]);
  assert.deepEqual(codes(checkTool({ ...good, inputSchema: null })), [CHECK.noSchema]);
  assert.deepEqual(codes(checkTool({ ...good, inputSchema: { type: 'string' } })), [CHECK.schemaNotObject]);
  const undescribed = checkTool({ ...good, inputSchema: {
    type: 'object', properties: { sku: { type: 'string' }, quantity: { type: 'integer' } }, required: ['sku', 'store'],
  } });
  assert.deepEqual(undescribed.items, [
    { code: CHECK.propertyWithoutDescription, level: LEVEL.note, detail: 'sku, quantity' },
    { code: CHECK.requiredNotDeclared, level: LEVEL.warn, detail: 'store' },
  ]);
  // A schema still in string form, as Chrome hands it over, is parsed rather than flagged.
  assert.deepEqual(codes(checkTool({ ...good, inputSchema: JSON.stringify(good.inputSchema) })), []);
});

test('a name a model API rejects, and a name shared with another frame, are notes', () => {
  assert.deepEqual(codes(checkTool({ ...good, name: 'search.products' })), [CHECK.nameNeedsAlias]);
  const sibling = { ...good, instanceId: 'a@5' };
  const out = checkTool(good, [good, sibling]);
  assert.deepEqual(out.items, [{ code: CHECK.duplicateName, level: LEVEL.note, detail: '1' }]);
});

test('no annotation declared is a note; a normalised all-false set counts as none', () => {
  assert.deepEqual(codes(checkTool({ ...good, annotations: {} })), [CHECK.noAnnotations]);
  assert.deepEqual(codes(checkTool({ ...good, annotations: { readOnlyHint: false, untrustedContentHint: false } })),
    [CHECK.noAnnotations]);
});

test('checkTools sums the page and keys results by instance', () => {
  const bare = { instanceId: 'c@0', logicalId: 'c', name: 'do_it', description: '', inputSchema: null, annotations: {} };
  const out = checkTools([good, bare]);
  assert.equal(out.byTool.get('a@0').warnings, 0);
  assert.deepEqual(codes(out.byTool.get('c@0')), [CHECK.noDescription, CHECK.noSchema, CHECK.noAnnotations]);
  assert.equal(out.warnings, 1);
  assert.equal(out.notes, 2);
});

test('batch checks retain peer order, description normalization and frame identity', () => {
  const entries = [good,
    {...good, name:'find_products', instanceId:'b@0', description:' '+good.description.toUpperCase()+' '},
    {...good, instanceId:'a@5'},
    {...good, name:'find_products', instanceId:'b@5'},
  ];
  const batch = checkTools(entries);
  assert.equal(batch.byTool.get('a@0').items.find(x=>x.code===CHECK.duplicateDescription).detail,'find_products');
  assert.equal(batch.byTool.get('b@0').items.find(x=>x.code===CHECK.duplicateDescription).detail,'search_products');
  assert.equal(batch.byTool.get('a@0').items.find(x=>x.code===CHECK.duplicateName).detail,'1');
  entries[1].description='An unrelated description that was changed after discovery.';
  entries[3].description=entries[1].description;
  assert.ok(!checkTools(entries).byTool.get('a@0').items.some(x=>x.code===CHECK.duplicateDescription));
});

test('checking a page with distinct descriptions does not reread every peer for every tool', () => {
  let reads=0;
  const entries=Array.from({length:1000},(_,i)=>({...good,name:'tool_'+i,instanceId:'t'+i,
    get description(){reads++;return 'A unique tool contract for entry number '+i;},
  }));
  assert.equal(checkTools(entries).warnings,0);
  assert.ok(reads<6000, `Expected linear description reads; received ${reads}`);
});
