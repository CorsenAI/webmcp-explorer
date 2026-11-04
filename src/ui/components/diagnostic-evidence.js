import { el,t } from '../dom.js';
import { exportBar } from './export-bar.js';
import { fence } from '../../core/export/text.js';

// A fixed observation, explicitly previewed before using the existing copy/download path.
// Opening it performs no discovery, invocation, permission request or instrumentation.
export function diagnosticEvidence(facts) {
  const capturedAt=new Date().toISOString();
  const record={kind:'webmcp-explorer/diagnostic',version:1,capturedAt,...facts};
  const preview=el('textarea',{class:'mono diagnostic-preview',rows:'7',
    'aria-label':t('diagnosticPreview'),title:t('diagnosticPreviewHelp')});
  preview.value=JSON.stringify(record,null,2);
  const error=el('p',{class:'field-note error',role:'status'});
  const box=exportBar({label:t('diagnosticExport'),note:t('diagnosticExportNote'),build:()=>{
    try{
      const json=JSON.parse(preview.value);error.textContent='';
      return {filename:'webmcp-diagnostic',json,markdown:'# WebMCP diagnostic\n\n'+fence(JSON.stringify(json,null,2),'json')+'\n'};
    }catch{error.textContent=t('diagnosticInvalid');return null;}
  }});
  box.classList.add('diagnostic-evidence');
  box.querySelector('summary').after(el('p',{class:'field-desc',text:t('diagnosticPreviewHelp')}),preview,error);
  return box;
}
