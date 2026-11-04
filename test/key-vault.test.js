import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptKeys, decryptKeys } from '../src/core/key-vault.js';
import { createKeyVault, VAULT_KEY } from '../src/storage/key-vault.js';
const pass='synthetic master phrase';
const fakeKey='synthetic-provider-credential';
function area() {
  const data={};return {data,access:[],get:async key=>({[key]:structuredClone(data[key])}),
    set:async obj=>Object.assign(data,structuredClone(obj)),remove:async key=>{for(const k of [key].flat())delete data[k];},
    setAccessLevel:async function(value){this.access.push(value.accessLevel);}};
}
test('AES-GCM round trip, fresh salt/IV, wrong passphrase and tampering',async()=>{
  const a=await encryptKeys({test:fakeKey},pass), b=await encryptKeys({test:fakeKey},pass);
  assert.notEqual(a.iv,b.iv);assert.notEqual(a.salt,b.salt);
  assert.equal((await decryptKeys(a,pass)).test,fakeKey);
  assert.equal(JSON.stringify(a).includes(fakeKey),false);assert.equal(a.iterations,600000);
  await assert.rejects(decryptKeys(a,'wrong master phrase'));
  await assert.rejects(decryptKeys({...a,ciphertext:(a.ciphertext[0]==='A'?'B':'A')+a.ciphertext.slice(1)},pass));
  await assert.rejects(decryptKeys({...a,iterations:1},pass));
  await assert.rejects(encryptKeys({},'1234'));
});
test('session survives worker recreation; encrypted vault locks on browser session loss',async()=>{
  const local=area(),session=area(),vault=createKeyVault({local,session});
  await vault.setKey('one',fakeKey);
  assert.equal(await createKeyVault({local,session}).getKey('one'),fakeKey);
  await vault.create(pass);
  assert.deepEqual(Object.keys(local.data),[VAULT_KEY]);assert.equal(JSON.stringify(local.data).includes(fakeKey),false);
  await vault.lock();assert.equal(await vault.getKey('one'),null);
  await vault.unlock(pass);assert.equal(await vault.getKey('one'),fakeKey);
  const restarted=createKeyVault({local,session:area()});assert.equal((await restarted.status()).locked,true);
  await assert.rejects(restarted.unlock('wrong master phrase'));assert.equal(await restarted.getKey('one'),null);
  assert.ok(local.access.every(x=>x==='TRUSTED_CONTEXTS'));
  await restarted.reset();assert.equal(local.data[VAULT_KEY],undefined);
});
test('concurrent updates keep both providers; mutation of a vault requires its passphrase',async()=>{
  const local=area(),session=area(),vault=createKeyVault({local,session});
  await Promise.all([vault.setKey('one','first'),vault.setKey('two','second')]);
  assert.equal(await vault.getKey('one'),'first');assert.equal(await vault.getKey('two'),'second');
  await vault.create(pass);await assert.rejects(vault.setKey('one','changed'));
  assert.equal(await vault.getKey('one'),'first');
  await vault.clearKey('one',pass);assert.equal(await vault.getKey('one'),null);
  await vault.useSession(pass);assert.equal(local.data[VAULT_KEY],undefined);assert.equal(await vault.getKey('two'),'second');
});
test('failed persistent write never silently downgrades to plaintext',async()=>{
  const local=area(),session=area(),vault=createKeyVault({local,session});
  await vault.setKey('one',fakeKey);local.set=async()=>{throw Error('quota');};
  await assert.rejects(vault.create(pass));assert.deepEqual(local.data,{});
});
test('an oversized session collection is rejected without corrupting existing keys',async()=>{
 const local=area(),session=area(),vault=createKeyVault({local,session});
 for(let i=0;i<7;i++)await vault.setKey(`fixture-${i}`,'x'.repeat(8192));
 await assert.rejects(vault.setKey('too-large','x'.repeat(8192)),/too large/);
 assert.equal((await vault.getKey('fixture-0')).length,8192);assert.equal(await vault.getKey('too-large'),null);
});
