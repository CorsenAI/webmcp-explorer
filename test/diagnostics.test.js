import test from 'node:test';import assert from 'node:assert/strict';
import {diagnosticState} from '../src/core/diagnostics.js';
test('diagnostics distinguish native, legacy, emulation and missing/refused APIs without inventing tool provenance',()=>{
 const result={env:{state:'native',checks:{apiAvailability:'available'}},tools:[{registrationType:'imperative'},{registrationType:'declarative'},{registrationType:'unknown'}]};
 assert.deepEqual(diagnosticState(result),{runtime:'native',imperative:1,declarative:1,unknown:1,canOfferEmulation:false});
 result.env.legacyHost=true;assert.equal(diagnosticState(result).runtime,'legacy');
 result.env.state='compat-polyfill';assert.equal(diagnosticState(result).runtime,'emulated');
 result.tools[2].executionContract={engine:'emulated'};assert.equal(diagnosticState(result).imperative,2);
 result.tools[2].inventoryOnly=true;assert.equal(diagnosticState(result).imperative,1);
 result.env={state:'unavailable',reason:'api-absent',checks:{apiAvailability:'missing'}};
 assert.equal(diagnosticState(result).canOfferEmulation,true);
 result.env={state:'native',reason:'tools-policy-blocked',checks:{apiAvailability:'refused'}};
 assert.equal(diagnosticState(result).runtime,'refused');assert.equal(diagnosticState(result).canOfferEmulation,false);
});
