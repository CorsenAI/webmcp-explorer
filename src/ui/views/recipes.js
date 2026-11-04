import { el } from '../dom.js';
import { rt, recipeButton, recipeField, recipeMessage, recipeDisclosure } from '../components/recipe-controls.js';
import { createRecipe, parseRecipe, recipeStep, recipeProblems } from '../../core/recipes.js';
import { sampleArguments } from '../../core/schema/sample.js';
import { recipeStepEditor } from './recipe-step.js';
import { renderRecipeRun } from './recipe-run.js';
import { recipeExport } from './recipe-export.js';
import { validateFieldExpectation } from '../../core/field-checks.js';

export function recipeHub({ discovery, draft, onOpen }) {
  const host=recipeDisclosure('siteRecipes');host.classList.add('recipe-hub');
  const fail=text=>{notice.textContent=text;};
  const notice=el('p',{class:'field-note',role:'status'});
  host.append(el('p',{class:'field-desc',text:rt('intro')}),
    recipeButton(draft?'continueDraft':'newRecipe',()=>onOpen(draft??{recipe:createRecipe({
      name:'',topOrigin:discovery.topOrigin,sourceUrl:discovery.url??'',steps:[]})}),fail),
    notice);
  const importArea=el('textarea',{rows:'5',class:'mono recipe-import'});
  const imported=recipeDisclosure('importRecipe',[
    el('p',{class:'field-desc',text:rt('importNotice')}),recipeField('importText',importArea),
    recipeButton('openImport',()=>{
      const recipe=parseRecipe(importArea.value);
      if(draft&&!draft.saved)throw Error(rt('keepDraft'));
      onOpen({recipe:{...recipe,id:crypto.randomUUID()},imported:true});
    },fail),
  ]);
  host.append(imported);
  const saved=el('div',{class:'recipe-saved-list'});host.append(saved);
  Promise.all([recipeMessage('recipe-list'),recipeMessage('recipe-runs')]).then(([definitions,runs])=>{
    for(const recipe of definitions.filter(item=>item.topOrigin===discovery.topOrigin)){
      saved.append(el('div',{class:'recipe-saved-row'},[
        el('span',{text:recipe.name}),recipeButton('openSaved',()=>{
          if(draft&&!draft.saved&&draft.recipe.id!==recipe.id)throw Error(rt('keepDraft'));
          onOpen({recipe:structuredClone(recipe),saved:true});
        },fail),
      ]));
    }
    for(const run of runs.filter(item=>item.topOrigin===discovery.topOrigin).slice(0,3)){
      const row=el('div',{class:'recipe-saved-row'},[
        el('span',{text:rt('recentRun',[run.name,run.status])}),
        recipeButton('openRun',()=>onOpen({...(draft??{recipe:structuredClone(run.definition),saved:true}),run,showRun:true}),fail),
      ]);saved.append(row);
    }
  }).catch(error=>fail(error.message));
  return host;
}

export function renderRecipe(root, { draft, discovery, tabId, onBack, onDiscard }) {
  const recipe=draft.recipe;draft.stepDrafts??=Object.create(null);draft.inputs??=Object.create(null);
  draft.open=true;
  const notice=el('p',{class:'field-note recipe-notice',role:'status',tabindex:'-1'});
  const activeNotice=el('p',{class:'field-desc',hidden:'',text:rt('activeRunEdit')});
  const fail=text=>{notice.textContent=text;};
  const runHost=el('section',{class:'recipe-run-host'});
  const reviewHost=el('section',{class:'recipe-review'});
  const steps=el('div',{class:'recipe-steps'});
  let lastRunRender=null;
  const inputsHost=el('div',{class:'recipe-inputs'});
  const runInputsHost=el('div',{class:'recipe-run-inputs'});
  const name=el('input',{type:'text',maxlength:'120',class:'recipe-name'});name.value=recipe.name;
  const changed=()=>{draft.saved=false;draft.review=null;reviewHost.replaceChildren();};
  name.addEventListener('input',()=>{recipe.name=name.value;changed();});
  const back=recipeButton('back',onBack,fail);
  const heading=el('div',{class:'detail-title'},[back,el('h2',{text:rt('title')})]);
  const editor=el('fieldset',{class:'recipe-editor'});
  editor.append(recipeField('name',name),el('p',{class:'field-desc',text:rt('site',[recipe.topOrigin])}),
    recipeDisclosure('guide',[el('p',{class:'field-desc',text:rt('guideBody')})]),inputsHost,steps,
    recipeButton('addStep',()=>{
      if(recipe.steps.length>=20)throw Error(rt('stepLimit'));
      const tool=discovery.tools[0];if(!tool)throw Error(rt('toolMissing'));
      const step=recipeStep(tool,sampleArguments(tool.inputSchema,{requiredOnly:true,includeOptionalDefaults:true}));
      recipe.steps.push(step);draft.stepDrafts[step.id]={open:true};changed();paintSteps(step.id);
    },fail,{class:'recipe-add-step'}));
  const review=recipeButton('review',async()=>{
    collect();draft.review=await recipeMessage('recipe-review',{tabId,recipe,inputs:draft.inputs});paintReview();
    reviewHost.scrollIntoView({block:'nearest'});
  },fail,{class:'recipe-review-button'});
  const save=recipeButton('save',async()=>{
    collect();const saved=await recipeMessage('recipe-save',{recipe});Object.assign(recipe,saved);draft.saved=true;fail(rt('saved'));
  },fail,{class:'recipe-save'});
  const remove=recipeButton('deleteRecipe',async()=>{
    if(!draft.deleteArmed){draft.deleteArmed=true;remove.textContent=rt('confirmDelete');return;}
    await recipeMessage('recipe-delete',{id:recipe.id});onDiscard();
  },fail);
  root.replaceChildren(el('div',{class:'recipe-view'},[
    heading,el('p',{class:'field-desc',text:rt('intro')}),notice,activeNotice,editor,runInputsHost,
    el('div',{class:'row-inline'},[save,review,recipeButton('discard',()=>{
      if(!draft.discardArmed){draft.discardArmed=true;fail(rt('confirmDiscard'));return;}onDiscard();
    },fail),remove]),reviewHost,runHost,
    recipeExport({definition:()=>{collect();return recipe;},tools:discovery.tools,fail}),
    el('p',{class:'field-desc',text:rt('retention')}),
  ]));
  function outcomeFor(id){return draft.run?.results?.find(result=>result.stepId===id)?.outcome??draft.seedResults?.[id]??null;}
  function paintSteps(focusId){
    steps.replaceChildren(...recipe.steps.map((step,index)=>recipeStepEditor({recipe,step,index,
      tools:discovery.tools,draft:draft.stepDrafts[step.id]??={},outcomeFor,changed,repaint:paintSteps,fail})));
    if(focusId){const index=recipe.steps.findIndex(step=>step.id===focusId);steps.children[index]?.querySelector('summary')?.focus();}
  }
  function paintInputs(){
    inputsHost.replaceChildren();const box=recipeDisclosure('inputs');inputsHost.append(box);
    for(const [index,input] of recipe.inputs.entries()){
      const name=el('input',{type:'text',class:'recipe-input-name'});name.value=input.name;
      const value=el('textarea',{rows:'2',class:'recipe-input-value'});
      let asText=false;try{asText=typeof JSON.parse(input.defaultJson)==='string';}catch{/* Preserve invalid draft. */}
      const format=el('select',{class:'recipe-input-format'},['text','json'].map(value=>el('option',{value,text:rt('format_'+value)})));
      format.value=asText?'text':'json';value.value=asText?JSON.parse(input.defaultJson):input.defaultJson;
      const row=el('div',{class:'recipe-input-row'},[
        recipeField('inputName',name),recipeField('inputFormat',format),recipeField('inputDefault',value),
        recipeButton('removeInput',()=>{delete draft.inputs[input.name];recipe.inputs.splice(index,1);changed();paintInputs();paintSteps();paintRunInputs();},fail),
      ]);box.append(row);
      const update=()=>{input.defaultJson=format.value==='text'?JSON.stringify(value.value):value.value;changed();};
      name.addEventListener('input',()=>{delete draft.inputs[input.name];input.name=name.value;changed();});
      name.addEventListener('change',()=>{paintSteps();paintRunInputs();});
      value.addEventListener('input',update);format.addEventListener('change',update);
      value.addEventListener('change',paintRunInputs);format.addEventListener('change',paintRunInputs);
    }
    box.append(recipeButton('addInput',()=>{
      if(recipe.inputs.length>=20)throw Error(rt('inputLimit'));
      recipe.inputs.push({name:'input'+(recipe.inputs.length+1),defaultJson:'""'});changed();paintInputs();
      paintSteps();paintRunInputs();
      inputsHost.querySelector('details').open=true;
    },fail));
  }
  function paintRunInputs(){
    runInputsHost.replaceChildren();if(!recipe.inputs.length)return;
    const box=recipeDisclosure('runInputs');box.open=true;runInputsHost.append(box);
    for(const input of recipe.inputs){
      const field=el('input',{type:'text',class:'recipe-run-input','data-name':input.name});
      let isText=false;try{isText=typeof JSON.parse(input.defaultJson)==='string';}catch{/* Validation reports an invalid default. */}
      const value=draft.inputs[input.name]??input.defaultJson;
      try{field.value=isText?JSON.parse(value):value;}catch{field.value=value;}
      field.addEventListener('input',()=>{draft.inputs[input.name]=isText?JSON.stringify(field.value):field.value;draft.review=null;reviewHost.replaceChildren();});
      const label=recipeField('runInputValue',field);label.firstChild.textContent=input.name;field.setAttribute('aria-label',input.name);
      box.append(label);
    }
  }
  function collect(){
    for(const step of recipe.steps){const sd=draft.stepDrafts[step.id];if(!sd)continue;
      if(sd.formErrors?.length)throw Error(sd.formErrors.map(error=>error.message).join('; '));
      if(sd.checkMode==='fields'){
        if(sd.fields?.dirty)throw Error(rt('pendingRule'));
        step.expect={kind:'fields',version:1,rules:structuredClone(sd.fields?.rules??[])};
        const error=validateFieldExpectation(step.expect);if(error)throw Error(error);
      }else if(sd.checkMode==='ok')step.expect={kind:'ok'};
      else if(sd.checkMode==='none')step.expect=null;
    }
    const problems=recipeProblems(recipe);if(problems.length)throw Error(problems.join('\n'));
  }
  function paintReview(){
    const reviewed=draft.review;if(!reviewed){reviewHost.replaceChildren();return;}
    reviewHost.replaceChildren(el('h3',{text:rt('reviewHeading')}),
      el('p',{class:'field-desc',text:rt('reviewNotice',[reviewed.pageUrl])}),
      el('ol',{},reviewed.targets.map((target,i)=>el('li',{text:rt('reviewStep',[i+1,target.tool.name,target.tool.origin,JSON.stringify(target.tool.frameIndexPath??[])])+
        (target.tool.mockMode&&target.tool.mockMode!=='off'?' · '+rt('mocked')+' ('+target.tool.mockMode+')':'')}))),
      recipeDisclosure('reviewOverrides',[el('pre',{class:'mono',text:JSON.stringify(reviewed.overrides,null,2)})]),
      el('div',{class:'row-inline'},['next','remaining'].map((key,i)=>recipeButton(key,async()=>{
        const started=await recipeMessage('recipe-start',{tabId,token:reviewed.token,mode:i?'all':'next'});
        draft.review=null;reviewHost.replaceChildren();showRun(started.run);
      },fail,{class:'recipe-start-'+key}))));
  }
  function showRun(run){
    if(run.recipeId!==recipe.id&&!draft.showRun)return;
    draft.run=run;
    const key=[run.id,run.updatedAt,run.status,run.reason,run.results.length,run.pending?.callId].join('|');
    if(key===lastRunRender)return;
    if(runHost.contains(document.activeElement)&&document.activeElement.matches('.recipe-export-preview')){
      document.activeElement.addEventListener('blur',()=>showRun(draft.run),{once:true});return;
    }
    lastRunRender=key;renderRecipeRun(runHost,run,{tabId,fail,refresh:refreshRun});
    const active=['running','paused','ready'].includes(run.status);
    activeNotice.hidden=!active;
    editor.disabled=active;review.disabled=active;save.disabled=active;
    if(active)review.title=rt('activeRunEdit');else review.title=rt('reviewHelp');
  }
  const listener=msg=>{if(msg?.type==='recipe-progress'&&msg.tabId===tabId)showRun(msg.run);};
  chrome.runtime.onMessage.addListener(listener);
  let reading=false,disposed=false;
  async function refreshRun(){if(reading||disposed)return;reading=true;
    try{const {run}=await recipeMessage('recipe-state',{tabId});if(run&&!disposed)showRun(run);}catch(error){if(!disposed)fail(error.message);}finally{reading=false;}
  }
  // Poll only while a call sequence is running and the panel is visible. This reveals a
  // worker interruption; paused runs do not keep the worker awake merely for this view.
  const timer=setInterval(()=>{if(!document.hidden&&['ready','running'].includes(draft.run?.status))refreshRun();},2000);
  root.addEventListener('explorer:teardown',()=>{disposed=true;clearInterval(timer);chrome.runtime.onMessage.removeListener(listener);},{once:true});
  paintInputs();paintSteps();paintRunInputs();paintReview();
  if(draft.run)showRun(draft.run);
  refreshRun();
}
