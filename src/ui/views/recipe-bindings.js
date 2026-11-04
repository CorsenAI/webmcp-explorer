import { el } from '../dom.js';
import { rt, recipeButton, recipeField, recipeDisclosure } from '../components/recipe-controls.js';
import { readableValue } from '../components/readable-value.js';
import { parseFieldJson } from '../../core/json-pointer.js';

export function recipeBindings({ recipe, step, index, draft, outcomeFor, changed, fail }) {
  draft.binding ??= { path:'', source:'input', input:'', stepId:'', pointer:'' };
  const edit=draft.binding;
  const box=recipeDisclosure('bindings');
  const list=el('div');
  const path=el('input',{type:'text',class:'mono recipe-binding-path'});path.value=edit.path;
  const source=el('select',{class:'recipe-binding-source'});
  source.append(el('option',{value:'',text:rt('chooseSource')}));
  for(const input of recipe.inputs)source.append(el('option',{value:'input:'+input.name,text:rt('inputSource',[input.name])}));
  for(const [i,prior] of recipe.steps.slice(0,index).entries())source.append(el('option',{value:'step:'+prior.id,text:rt('stepSource',[i+1,prior.tool.name])}));
  source.value=edit.source==='input'?'input:'+edit.input:'step:'+edit.stepId;
  const pointer=el('input',{type:'text',class:'mono recipe-binding-pointer'});pointer.value=edit.pointer;
  const pointerField=recipeField('resultPath',pointer);
  const picker=recipeDisclosure('pickBinding');
  const sample=el('div');picker.append(sample);
  const sync=()=>{
    pointerField.hidden=edit.source!=='step';picker.hidden=edit.source!=='step';
    sample.replaceChildren();
    const prior=outcomeFor(edit.stepId);
    try {
      if(!prior?.ok || prior.resultTruncated)throw Error(rt('noCompleteResult'));
      sample.append(readableValue(parseFieldJson(prior.result),0,{onSelect:path=>{
        edit.pointer=pointer.value=path;changed();picker.open=false;pointer.focus();
      }}));
    } catch(error){sample.append(el('p',{class:'field-desc',text:error.message}));}
  };
  path.addEventListener('input',()=>{edit.path=path.value;changed();});
  pointer.addEventListener('input',()=>{edit.pointer=pointer.value;changed();});
  source.addEventListener('change',()=>{
    const [kind,...rest]=source.value.split(':');edit.source=kind;edit.input=kind==='input'?rest.join(':'):'';
    edit.stepId=kind==='step'?rest.join(':'):'';changed();sync();
  });
  const paint=()=>list.replaceChildren(...step.bindings.map((binding,i)=>el('div',{class:'recipe-binding'},[
    el('p',{class:'field-note',text:rt('bindingDescription',[binding.path||rt('root'),binding.source==='input'
      ?rt('inputSource',[binding.input]):rt('bindingResult',[recipe.steps.findIndex(s=>s.id===binding.stepId)+1,binding.pointer||rt('root')])])}),
    recipeButton('removeBinding',()=>{step.bindings.splice(i,1);changed();paint();},fail),
  ])));
  box.append(el('p',{class:'field-desc',text:rt('bindingsIntro')}),list,
    recipeField('argumentPath',path),recipeField('bindingSource',source),pointerField,picker,
    recipeButton('addBinding',()=>{
      if(!source.value)throw Error(rt('chooseSource'));
      if(step.bindings.length>=50)throw Error(rt('bindingLimit'));
      step.bindings.push({path:edit.path,source:edit.source,...(edit.source==='input'?{input:edit.input}:{stepId:edit.stepId,pointer:edit.pointer})});
      changed();paint();
    },fail,{class:'recipe-add-binding'}));
  paint();sync();return box;
}
