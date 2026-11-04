import { el, t } from '../dom.js';
import { recipeSpec } from '../../core/export/playwright.js';
import { slug } from '../../core/export/text.js';
import { recipeButton, recipeDisclosure, recipeField, rt } from '../components/recipe-controls.js';
import { saveText } from '../components/export-bar.js';
import { parseRecipe, recipeDefinitionText } from '../../core/recipes.js';
import { recipeRunMarkdown } from '../../core/export/recipe.js';

export function recipeExport({ definition, run, tools = [], fail }) {
  const box=recipeDisclosure(run?'exportRun':'exportRecipe');
  const area=el('textarea',{rows:'8',class:'mono recipe-export-preview'});
  const options={includeArguments:true,includeResults:true};
  const specButtons=[];
  const refresh=()=>{area.value=run?recipeRunMarkdown(run,options):recipeDefinitionText(definition());for(const b of specButtons)b.disabled=!!run&&(!options.includeArguments||!options.includeResults);};
  if(run){
    for(const [key,label] of [['includeArguments','includeArguments'],['includeResults','includeResults']]){
      const input=el('input',{type:'checkbox'});input.checked=true;
      input.addEventListener('change',()=>{options[key]=input.checked;refresh();});box.append(recipeField(label,input));
    }
  }
  const text=()=>run?area.value:recipeDefinitionText(parseRecipe(area.value));
  box.append(el('p',{class:'field-desc',text:rt('exportNotice')}),recipeField('exportPreview',area),
    el('div',{class:'row-inline'},[
      recipeButton('copyExport',async()=>{await navigator.clipboard.writeText(text());fail(rt('copied'));},fail),
      recipeButton('downloadExport',()=>{saveText(run?'webmcp-recipe-run':'webmcp-recipe',text(),run?'markdown':'json');},fail),
      recipeButton('refreshExport',refresh,fail),
    ]));
  const spec = () => {if(run&&(!options.includeArguments||!options.includeResults))throw Error(t('export_specNeedsData'));return recipeSpec({ definition:run?undefined:parseRecipe(area.value),run,tools });};
  const action = (label, work) => {
    const button=el('button',{text:t(label),title:t('export_playwrightHelp'),class:'recipe-playwright'});specButtons.push(button);
    button.addEventListener('click',async()=>{try{await work();}catch(error){fail(error.message);}});return button;
  };
  box.append(el('div',{class:'row-inline'},[
    action('export_copySpec',async()=>{await navigator.clipboard.writeText(spec());fail(rt('copied'));}),
    action('export_saveSpec',()=>{saveText('recipe-'+slug(run?.name??definition().name),spec(),'playwright');}),
  ]));
  let prepared=false;
  box.addEventListener('toggle',()=>{if(box.open&&!prepared){try{refresh();prepared=true;}catch(error){fail(error.message);box.open=false;}}});
  return box;
}
