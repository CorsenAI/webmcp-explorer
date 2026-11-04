import { mdCode } from './safe.js';
const line = mdCode;
const block = value => {
  const text=typeof value==='string'?value:JSON.stringify(value,null,2);
  const fence='`'.repeat(Math.max(3,...([...text.matchAll(/`+/g)].map(match=>match[0].length+1))));
  return `${fence}\n${text}\n${fence}`;
};
export function recipeRunMarkdown(run, { includeArguments = true, includeResults = true } = {}) {
  const lines=[`# Recipe run: ${line(run.name)}`, '', `Status: ${line(run.status)}`,
    `Page: ${line(run.pageUrl)}`, `Run ID: ${line(run.id)}`, '', line(run.reason), '',
    'This report is observed evidence. It does not transfer site access or authentication, resume the run, or undo page actions.', ''];
  if(includeArguments) lines.push('## Named inputs', block(run.inputValues??{}), '');
  lines.push('## Reviewed local overrides',block(run.overrides??[]),'');
  for(const result of run.results??[]){
    lines.push(`## Step ${result.index+1}: ${line(result.name)}`,`Outcome: ${result.outcome.ok?'success':'error'}${result.outcome.mocked?' (local mock)':''}`);
    if(includeArguments)lines.push('Arguments:',block(result.args));
    if(result.check)lines.push(`Check: ${line(result.check.verdict)} — ${line(result.check.reason)}`,block(result.check));
    if(includeResults)lines.push('Result / error:',block(result.outcome.result??result.outcome.error??result.outcome.code??''));
    if(result.outcome.resultTruncated)lines.push(`Stored result is an excerpt: ${result.outcome.result.length} of ${result.outcome.resultLength} characters. It cannot reproduce a complete JSON document.`);
    if(result.unchecked?.length)lines.push('Schema keywords not checked automatically:',block(result.unchecked));
    lines.push('');
  }
  if(run.pending)lines.push('## Pending step',`Step ${run.pending.index+1}; call ${line(run.pending.callId)}. Its action may have happened. Do not assume a retry is harmless.`,
    ...(includeArguments?[block(run.pending.args)]:[]),'');
  if(!includeArguments)lines.push('Argument and input sections were omitted by the exporter.');
  if(!includeResults)lines.push('Raw result sections were omitted by the exporter.');
  lines.push('The selected report sections can still contain data echoed in checks, overrides or errors. Inspect the entire preview before sharing.');
  return lines.join('\n')+'\n';
}
