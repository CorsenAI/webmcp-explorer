import { el } from '../dom.js';
import { rt, recipeButton, recipeField, recipeDisclosure } from '../components/recipe-controls.js';
import { recipeBindings } from './recipe-bindings.js';
import { recipeStep } from '../../core/recipes.js';
import { buildFormModel } from '../../core/schema/model.js';
import { renderForm, readForm } from '../components/schema-form.js';
import { renderSchemaTree } from '../components/schema-tree.js';
import { fieldCheckEditor } from '../components/field-check-editor.js';
import { argumentValue } from '../../core/recipes.js';
import { parseFieldJson } from '../../core/json-pointer.js';

export function recipeStepEditor({ recipe, step, index, tools, draft, outcomeFor, changed, repaint, fail }) {
  const current=()=>tools.find(tool=>tool.logicalId===step.tool.logicalId&&tool.frameKey===step.tool.frameKey
    &&JSON.stringify(tool.frameIndexPath??[])===JSON.stringify(step.tool.frameIndexPath));
  const select=el('select',{class:'recipe-tool'});
  select.append(el('option',{value:'',text:rt('chooseTool')}));
  tools.forEach((tool,i)=>select.append(el('option',{value:String(i),text:rt('toolOption',[tool.name,tool.origin,JSON.stringify(tool.frameIndexPath??[])])})));
  const selected=tools.indexOf(current());select.value=selected<0?'':String(selected);
  const box=el('details',{class:'recipe-step'});
  box.open=draft.open??index===0;
  box.addEventListener('toggle',()=>{draft.open=box.open;});
  const heading=el('summary',{text:rt('stepHeading',[index+1,step.tool.name||rt('chooseTool')]),title:rt('stepHeadingHelp')});
  const body=el('div',{class:'recipe-step-body'});
  box.append(heading,body);
  select.addEventListener('change',()=>{
    const tool=tools[Number(select.value)];if(select.value===''||!tool)return;
    step.tool=recipeStep(tool,{}).tool;draft.argsMode=null;draft.formRaw=null;changed();repaint(step.id);
  });
  const order=el('div',{class:'row-inline'},[
    recipeButton('up',()=>move(-1),fail,{disabled:index===0?'':null}),
    recipeButton('down',()=>move(1),fail,{disabled:index===recipe.steps.length-1?'':null}),
    recipeButton('removeStep',()=>{recipe.steps.splice(index,1);changed();repaint();},fail),
  ]);
  body.append(recipeField('tool',select),el('p',{class:'field-desc',text:rt('identity',[step.tool.origin,JSON.stringify(step.tool.frameIndexPath),step.tool.contractFp])}),order);
  const tool=current();
  if(tool)body.append(recipeDisclosure('schema',[renderSchemaTree(tool.inputSchema),
    recipeButton('acceptContract',()=>{step.tool=recipeStep(tool,{}).tool;changed();repaint(step.id);},fail)]));
  else body.append(el('p',{class:'field-note',text:rt('toolMissing')}));
  const model=tool?buildFormModel(tool.inputSchema):null;
  let parsed=null;
  try{parsed=argumentValue(parseFieldJson(step.argsJson));}catch{/* Keep malformed JSON editable. */}
  draft.argsMode??=model?.renderable&&parsed?'form':'json';
  const argsHost=el('div',{class:'recipe-arguments'});
  const toggle=recipeButton('toggleArguments',()=>{
    if(draft.formErrors?.length)throw Error(draft.formErrors.map(error=>error.message).join('; '));
    if(draft.argsMode==='json')argumentValue(parseFieldJson(step.argsJson));
    draft.argsMode=draft.argsMode==='json'&&model?.renderable?'form':'json';draft.formRaw=null;repaint(step.id);
  },fail);
  toggle.disabled=!model?.renderable;toggle.title=!model?.renderable?rt('jsonOnly'):rt('toggleArgumentsHelp');
  body.append(el('p',{class:'field-label',text:rt('arguments')}),toggle,argsHost);
  if(draft.argsMode==='form'&&model?.renderable&&parsed){
    renderForm(argsHost,model,parsed);
    // Multiple step forms may expose the same argument names. Keep labels and radio groups
    // scoped to this step; readForm itself uses data-path within argsHost.
    for(const control of argsHost.querySelectorAll('[id]')){
      const old=control.id;control.id='recipe-'+step.id+'-'+old;
      for(const label of argsHost.querySelectorAll('label[for]'))if(label.htmlFor===old)label.htmlFor=control.id;
      if(control.name)control.name='recipe-'+step.id+'-'+control.name;
    }
    const fields=[...argsHost.querySelectorAll('input,select,textarea')];
    draft.formRaw?.forEach((raw,i)=>{if(fields[i]){fields[i].value=raw.value;fields[i].checked=raw.checked;}});
    // Retain omitted original fields until an actual argument edit, as in P1 saved editing.
    const update=()=>{
      draft.formRaw=fields.map(node=>({value:node.value,checked:node.checked}));
      const next=readForm(argsHost,model);draft.formErrors=next.errors;
      for(const node of argsHost.querySelectorAll('[data-control="number"],[data-control="json"]')){
        if(!node.value.trim())continue;
        try{argumentValue(parseFieldJson(node.value));}catch(error){draft.formErrors.push({message:error.message});}
      }
      if(!draft.formErrors.length)step.argsJson=JSON.stringify(next.values);changed();
    };
    argsHost.addEventListener('input',update);argsHost.addEventListener('change',update);
  }else{
    const area=el('textarea',{rows:'5',class:'mono recipe-args','aria-label':rt('arguments'),title:rt('argumentsHelp')});area.value=step.argsJson;
    area.addEventListener('input',()=>{step.argsJson=area.value;draft.formErrors=[];changed();});argsHost.append(area);
  }
  body.append(recipeBindings({recipe,step,index,draft,outcomeFor,changed,fail}));
  const checkMode=el('select',{class:'recipe-check-mode'},['none','ok','fields','keep'].map(value=>
    el('option',{value,text:rt('check_'+value)})));
  draft.checkMode??=step.expect?.kind==='fields'?'fields':step.expect?.kind==='ok'?'ok':step.expect?'keep':'none';
  draft.fields??={rules:structuredClone(step.expect?.rules??[])};
  checkMode.value=draft.checkMode;
  const checkHost=el('div');
  const renderCheck=()=>{
    checkHost.replaceChildren();draft.checkEditor=null;
    if(draft.checkMode==='fields'){
      draft.checkEditor=fieldCheckEditor({draft:draft.fields,outcome:outcomeFor(step.id)});
      checkHost.append(draft.checkEditor.element);
    }else if(draft.checkMode==='keep')checkHost.append(el('pre',{class:'mono',text:JSON.stringify(step.expect,null,2)}));
  };
  checkMode.addEventListener('change',()=>{draft.checkMode=checkMode.value;changed();renderCheck();});
  checkHost.addEventListener('input',changed);checkHost.addEventListener('click',changed);
  body.append(recipeField('check',checkMode),checkHost);renderCheck();
  return box;
  function move(delta){const other=index+delta;if(other<0||other>=recipe.steps.length)return;
    [recipe.steps[index],recipe.steps[other]]=[recipe.steps[other],recipe.steps[index]];changed();repaint(step.id);}
}
