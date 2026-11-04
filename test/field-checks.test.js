import test from 'node:test';
import assert from 'node:assert/strict';
import { compareJsonNumbers } from '../src/core/json-compare.js';
import { parseFieldJson, valueAtPointer, exactJsonText } from '../src/core/json-pointer.js';
import { judgeFieldExpectation, validateFieldExpectation } from '../src/core/field-checks.js';
import { createSavedCall, judgeSavedCall, reviewSavedCall, addSavedCall } from '../src/core/saved-calls.js';
import { checksReport } from '../src/core/export/checks-report.js';

const expect = (...rules) => ({ kind: 'fields', version: 1, rules });
const rule = (path, op, value) => ({ path, op, ...(value === undefined ? {} : { value }) });
const judge = (definition, text) => judgeFieldExpectation(definition, { ok: true, result: text });

test('decimal ordering distinguishes exact magnitude without expanding huge exponents', () => {
  for (const [a,b,want] of [
    ['9007199254740993','9007199254740992',1],['1.00000000000000001','1',1],
    ['1e400','2e400',-1],['-1e400','-2e400',1],['1e-400','0',1],
    ['-0','0',0],['10e399','1e400',0],['-12.01','-12.001',-1],
    ['1e999999999999999999999','10e999999999999999999998',0],
    ['0.099','0.1',-1],['-0.1','-0.099',-1],['1.2','1.21',-1],
  ]) {
    assert.equal(compareJsonNumbers(a,b),want,`${a} versus ${b}`);
    assert.equal(compareJsonNumbers(b,a),want === 0 ? 0 : -want);
  }
  assert.throws(()=>compareJsonNumbers('Infinity','0'));
  assert.throws(()=>compareJsonNumbers('01','0'));
});

test('JSON Pointer examples, escaped keys, own properties and arrays preserve types', () => {
  const value = parseFieldJson('{"foo":["bar","baz"],"":0,"a/b":1,"m~n":8,"~1":null,"__proto__":false}');
  for (const [path,want] of [['/foo/0','"bar"'],['/','0'],['/a~1b','1'],['/m~0n','8'],['/~01','null'],['/__proto__','false']]) {
    const got=valueAtPointer(value,path);assert(got.found);assert.equal(exactJsonText(got.value),want);
  }
  for(const path of ['/toString','/foo/length','/foo/01','/foo/-','/foo/2','/missing/x']) assert.equal(valueAtPointer(value,path).found,false,path);
  assert.equal(valueAtPointer(value,'').value,value);
  assert.throws(()=>valueAtPointer(value,'foo'));assert.throws(()=>valueAtPointer(value,'/~2'));
});

test('duplicate fields are ambiguous even with escapes or nesting; repeated keys across siblings are fine', () => {
  for(const text of ['{"x":1,"x":2}','{"a":{"x":1,"\\u0078":2}}']) assert.throws(()=>parseFieldJson(text),/duplicate/);
  assert.equal(exactJsonText(parseFieldJson('{"a":{"x":1},"b":{"x":2},"s":"{x:,}\\\""}')),'{"a":{"x":1},"b":{"x":2},"s":"{x:,}\\\""}');
});

test('selected list rule ignores timestamps and fails with the exact empty-list reason', () => {
  const e=expect(rule('/products','length-min','1'));
  assert.equal(judge(e,'{"products":[{"id":1}],"timestamp":2}').verdict,'pass');
  const failed=judge(e,'{"products":[],"timestamp":3}');
  assert.equal(failed.verdict,'fail');assert.match(failed.reason,/0 items/);
  assert.deepEqual(failed.rules[0],{path:'/products',op:'length-min',expected:'1',actual:'0 items',actualType:'array',pass:false,reason:'/products has list length at least 1; received 0 items (array).'});
});

test('missing, null, false, zero, empty text and list do not collapse', () => {
  const text='{"null":null,"false":false,"zero":0,"empty":"","list":[]}';
  const e=expect(rule('/gone','missing'),rule('/null','exists'),rule('/false','equals','false'),rule('/zero','equals','0'),rule('/empty','equals','""'),rule('/list','length-equals','0'));
  assert.equal(judge(e,text).verdict,'pass');
  assert.equal(judge(expect(rule('/gone','equals','null')),text).verdict,'fail');
  assert.equal(judge(expect(rule('/null','missing')),text).verdict,'fail');
  assert.equal(judge(expect(rule('/zero','equals','"0"')),text).verdict,'fail');
  assert.equal(judge(expect(rule('/empty','length-equals','0')),text).verdict,'fail');
});

test('number ranges and typed equality preserve adjacent IDs, decimals and nested numbers', () => {
  const text='{"id":9007199254740993,"decimal":1.00000000000000001,"huge":1e400,"v":{"n":2}}';
  const e=expect(rule('/id','number-min','9007199254740993'),rule('/id','number-max','9007199254740993'),rule('/decimal','equals','1.00000000000000001'),rule('/huge','number-max','10e399'),rule('/v','equals','{"n":2.0}'));
  assert.equal(judge(e,text).verdict,'pass');
  assert.equal(judge(expect(rule('/id','number-max','9007199254740992')),text).verdict,'fail');
  assert.equal(judge(expect(rule('/decimal','equals','1')),text).verdict,'fail');
  assert.equal(judge(expect(rule('/v','number-min','1')),text).verdict,'fail');
});

test('text contains and list bounds require the correct type, all rules are required', () => {
  const e=expect(rule('/s','text-contains','Hello'),rule('/a','length-max','2'));
  assert.equal(judge(e,'{"s":"Hello there","a":[1,2]}').verdict,'pass');
  const bad=judge(e,'{"s":123,"a":[1,2,3]}');assert.equal(bad.rules.filter(r=>!r.pass).length,2);
  assert.equal(judge(expect(rule('','text-contains','')),'""').verdict,'pass');
});

test('invalid/future/empty rules do not become passing checks; errors and truncation are explicit', () => {
  for(const e of [{kind:'fields',version:2,rules:[]},expect(),expect(rule('/x','script','alert(1)')),expect(rule('/x','length-min','-1')),expect(rule('/x','equals','1,2')),expect(rule('/x','number-max','"1"'))]) {
    assert(validateFieldExpectation(e));assert.equal(judge(e,'{}').verdict,'not-a-check');
  }
  const e=expect(rule('/gone','missing'));
  assert.equal(judge(e,'not JSON').verdict,'fail');
  assert.equal(judgeFieldExpectation(e,{ok:false,error:'boom'}).verdict,'fail');
  assert.equal(judgeFieldExpectation(e,{ok:false,code:'cancelled'}).verdict,'not-a-check');
  assert.equal(judgeFieldExpectation(e,{ok:true,result:'{}',resultTruncated:true}).verdict,'not-a-check');
});

test('saved field definitions survive JSON storage, editing, review and report round trip', () => {
  const tool={name:'search',logicalId:'one',inputSchema:{type:'object'},contractFp:'c'};
  const original=createSavedCall({tool,id:'check1',name:'Products',args:{},expect:expect(rule('/products','length-min','1'))});
  const saved=JSON.parse(JSON.stringify(original));const outcome={ok:true,result:'{"products":[]}'};
  const judgement=judgeSavedCall(saved,outcome);assert.equal(judgement.verdict,'fail');
  const report=checksReport([{saved,outcome,judgement}],{at:0});
  const exported=JSON.parse(JSON.stringify(report.json)).checks[0];
  assert.deepEqual(judgeSavedCall({expect:exported.expect},{ok:exported.ok,result:exported.result}),judgement);
  assert.match(report.markdown,/"length-min"/);assert.match(report.markdown,/0 items/);
  const renamed={...saved,name:'Renamed'};assert.deepEqual(addSavedCall([saved],renamed),[renamed]);
  saved.expect.version=2;assert.equal(reviewSavedCall(saved,tool).status,'needs-review');
});
