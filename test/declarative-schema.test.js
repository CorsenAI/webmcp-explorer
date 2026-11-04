import test from 'node:test';
import assert from 'node:assert/strict';
import { declarativeSchema } from '../src/core/declarative-schema.js';
test('required constraints, selections and disabled controls are inferred from metadata',()=>{
  const {schema,complete}=declarativeSchema([
    {name:'q',required:true,pattern:'[a-z]+',maxlength:'20',description:'Query'},
    {name:'price',type:'number',min:'0',max:'10'},
    {name:'category',tag:'select',multiple:true,options:[{value:'a'},{value:'b',disabled:true}]},
    {name:'skip',disabled:true},
  ]);
  assert.equal(complete,true);assert.deepEqual(schema.required,['q']);
  assert.equal(schema.properties.q.maxLength,20);assert.equal(schema.properties.price.minimum,0);
  assert.deepEqual(schema.properties.category.items.enum,['a']);assert.equal(schema.properties.skip,undefined);
});
test('sensitive and unsupported fields make the estimate partial; live values never become defaults',()=>{
  const out=declarativeSchema([{name:'csrf',type:'hidden',value:'do-not-copy'}, {name:'q',value:'private-input'}, {name:'file',type:'file'}]);
  assert.equal(out.complete,false);assert.equal(out.warnings.length,2);
  assert.equal(JSON.stringify(out).includes('do-not-copy'),false);assert.equal(JSON.stringify(out).includes('private-input'),false);
});
test('radio and checkbox groups preserve choices',()=>{
  const out=declarativeSchema([{name:'pick',type:'radio',choice:'a'}, {name:'pick',type:'radio',choice:'b'}]);
  assert.deepEqual(out.schema.properties.pick.enum,['a','b']);
});
