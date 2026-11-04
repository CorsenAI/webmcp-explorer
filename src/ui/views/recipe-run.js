import { el, badge } from '../dom.js';
import { rt, recipeButton, recipeMessage, recipeDisclosure } from '../components/recipe-controls.js';
import { recipeExport } from './recipe-export.js';
import { readableValue } from '../components/readable-value.js';
import { parseFieldJson } from '../../core/json-pointer.js';

export function renderRecipeRun(root, run, { tabId, fail, refresh = () => {} }) {
  const focused=root.contains(document.activeElement)?document.activeElement?.dataset.recipeAction:null;
  const expanded=new Set([...root.querySelectorAll('.recipe-step-result[open]')].map(box=>box.dataset.stepId));
  root.replaceChildren();if(!run)return;
  root.append(el('h3',{text:rt('runHeading',[run.name])}),
    el('p',{class:'recipe-run-state',role:'status',text:rt('runStatus',[run.status,run.results.length,run.definition?.steps.length??'?'])}),
    el('p',{class:run.status==='completed'?'field-desc':'field-note',text:run.reason}));
  const own=run.tabId===tabId;
  const controls=el('div',{class:'row-inline recipe-run-controls'});
  for(const [key,type,enabled] of [
    ['next','recipe-next',own&&run.status==='paused'],
    ['remaining','recipe-remaining',own&&run.status==='paused'],
    ['pause','recipe-pause',own&&run.status==='running'],
    ['stop','recipe-stop',own&&['running','paused','ready'].includes(run.status)],
  ]){
    const button=recipeButton(key,async()=>{try{await recipeMessage(type,{tabId});}finally{await refresh();}},fail);
    button.disabled=!enabled;button.title+=!enabled?' '+rt('unavailableRunControl'):'';controls.append(button);
  }
  root.append(controls);
  for(const result of run.results){
    const box=el('details',{class:'recipe-step-result','data-step-id':result.stepId},[
      el('summary',{text:rt('resultHeading',[result.index+1,result.name,result.check?.verdict==='fail'?rt('checkFailed'):result.outcome.ok?rt('success'):rt('failure')]),title:rt('resultHeadingHelp')}),
    ]);
    if(result.outcome.mocked)box.append(badge(rt('mocked'),'warn',rt('mockedHelp')));
    if(result.check)box.append(el('p',{class:result.check.verdict==='fail'?'field-note error':'field-note',text:result.check.reason}));
    if(result.check?.rules)box.append(el('pre',{class:'mono',text:JSON.stringify(result.check.rules,null,2)}));
    box.append(recipeDisclosure('usedArguments',[el('pre',{class:'mono',text:JSON.stringify(result.args,null,2)})]));
    try{
      if(!result.outcome.ok||result.outcome.resultTruncated)throw Error('raw');
      box.append(readableValue(parseFieldJson(result.outcome.result)));
    }catch{box.append(el('pre',{class:'mono result-body',text:result.outcome.result??result.outcome.error??''}));}
    if(result.outcome.resultTruncated)box.append(el('p',{class:'field-note',text:rt('resultExcerpt',[result.outcome.result.length,result.outcome.resultLength])}));
    box.open=expanded.has(result.stepId)||result.check?.verdict==='fail';
    root.append(box);
  }
  if(run.pending)root.append(el('p',{class:'field-note',text:rt('pending',[run.pending.index+1,run.pending.callId])}));
  root.append(recipeExport({run,fail}));
  if(focused){const next=root.querySelector(`[data-recipe-action="${focused}"]`);
    if(next&&!next.disabled)next.focus({preventScroll:true});
    else {const status=root.querySelector('.recipe-run-state');status.tabIndex=-1;status.focus({preventScroll:true});}
  }
}
