import { jsData, toolContract } from './safe.js';
import { slug } from './text.js';
import { argumentValue, recipeInputs, recipeProblems } from '../recipes.js';
import { parseFieldJson } from '../json-pointer.js';
import { PLAYWRIGHT_RUNTIME } from './playwright-runtime.js';

const header = `/// <reference types="node" />
// WebMCP Explorer — reviewed reproduction, @playwright/test, Chrome for Testing 155.
// Install @playwright/test and @types/node in your test project. Use a single project/worker where possible.
// CHROME=/path/to/chrome WEBMCP_REPRO_RUN_ID=reviewed-1 npx playwright test FILE.spec.ts
// A new explicit run ID starts NEW work. Inspect prior effects before choosing one.
// Default headful; use Xvfb in CI. WEBMCP_HEADLESS=1 is an explicit alternative.
// Host-only launch flags (e.g. --no-sandbox in a disposable lab) go in CHROME_EXTRA_FLAGS.
// One local exclusive receipt covers this plan/run ID, including retries and worker restarts.
// Receipts live in the OS temp directory; they cannot coordinate different machines or survive its deletion.
import { test, expect, chromium, type Frame, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, openSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
`;
const expectation = outcome => outcome ? {kind:'recorded',ok:outcome.ok===true,result:outcome.result??null,error:outcome.error??outcome.code??null} : {kind:'ok'};
function generate(plan) {
  for(const step of plan.steps){
    if(!step.schema||typeof step.schema!=='object'||Array.isArray(step.schema))plan.blocked.push('A recorded input schema is missing. Review a live contract or make a new recipe run.');
    if(step.inventoryOnly||step.engine&&step.engine!=='native')plan.blocked.push('This standalone export requires a native executable tool.');
    if(step.overridden)plan.blocked.push('A local override is not a native contract.');
  }
  plan.blocked=[...new Set(plan.blocked)];
  return header+'\nconst PLAN = '+jsData(plan)+';\n'+PLAYWRIGHT_RUNTIME;
}
export function playwrightSpec({tool,args={},outcome=null,frame=null,page=null,override=null}) {
  const contract=toolContract(tool);contract.engine??=outcome?.engine??null;
  if(frame)contract.frame={top:frame.isTopLevel??contract.frame.top,url:frame.url??contract.frame.url,indexPath:frame.indexPath??contract.frame.indexPath};
  return generate({version:2,kind:'single',url:page?.url??tool.origin,inputs:{},
    blocked:outcome?.mocked||override?['Local mock/override evidence cannot assert the real tool.']:outcome?.resultTruncated?['A truncated result cannot become a complete assertion.']:[],
    steps:[{...contract,id:'call',args,bindings:[],expect:expectation(outcome)}]});
}
export function recipeSpec({definition,run=null,tools=[]}) {
  definition=definition??run?.definition;
  const blocked=definition?recipeProblems(definition):['No recipe definition'];
  if(run&&(run.status!=='completed'||run.pending))blocked.push('This run is incomplete or uncertain. Export a reviewed definition for a new run.');
  if(run?.overrides?.length)blocked.push('The recorded run used local overrides.');
  let inputs={};try{inputs=argumentValue(recipeInputs(definition,run?.inputValues??{}));}catch{blocked.push('Named inputs cannot be reproduced.');}
  const steps=(definition?.steps??[]).map((step,index)=>{
    const matches=tools.filter(t=>t.logicalId===step.tool.logicalId&&t.contractFp===step.tool.contractFp&&t.name===step.tool.name&&t.origin===step.tool.origin&&t.frameKey===step.tool.frameKey&&JSON.stringify(t.frameIndexPath??[])===JSON.stringify(step.tool.frameIndexPath));
    const live=matches.length===1?matches[0]:null;
    const contract=run?.contracts?.[index]??(live?toolContract(live):{...step.tool,schema:null,frame:{top:step.tool.frameKey==='top',indexPath:step.tool.frameIndexPath}});
    const recorded=run?.results?.find(r=>r.stepId===step.id);
    if(recorded?.outcome?.mocked||recorded?.outcome?.resultTruncated)blocked.push('Mocked or truncated results cannot become complete assertions.');
    let args={};try{args=argumentValue(parseFieldJson(step.argsJson));}catch{blocked.push('Arguments cannot be represented without changing their values.');}
    return {...contract,id:step.id,args,bindings:step.bindings??[],expect:step.expect??expectation(recorded?.outcome)};
  });
  return generate({version:2,kind:'recipe',url:run?.pageUrl??definition?.sourceUrl,inputs,steps,blocked});
}
export const specFilename = tool => `reproduce-${slug(tool?.name,'tool')}.spec.ts`;
