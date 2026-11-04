import { el,t } from '../dom.js';
import { hasOrigin,requestOrigin,originPattern } from '../../shared/permissions.js';
export function emulationControl(url,tabId,{compact=false}={}) {
  const note=el('p',{class:'field-note',role:'status'});
  const button=el('button',{id:'emulation-toggle',text:t('emulation_enable'),title:t('emulation_help')});
  const reload=el('button',{id:'emulation-reload',text:t('emulation_reloadButton'),title:t('emulation_reload'),hidden:true});
  let enabled=false;
  chrome.runtime.sendMessage({type:'emulation-state'}).then(out=>{
    enabled=(out?.origins??[]).includes(originPattern(url));
    button.textContent=t(enabled?'emulation_disable':'emulation_enable');
  }).catch(()=>{});
  button.addEventListener('click',async()=>{
    button.disabled=true;
    try {
      if(!enabled&&!await hasOrigin(url)) {
        if(!await requestOrigin(url))return;
      }
      const out=await chrome.runtime.sendMessage({type:'emulation-set',url,on:!enabled});
      if(out?.error){note.textContent=out.error;return;}
      enabled=out.on;button.textContent=t(enabled?'emulation_disable':'emulation_enable');
      note.textContent=t('emulation_reload');reload.hidden=!Number.isInteger(tabId);
    } catch {note.textContent=t('discoveryFailed');}
    finally {button.disabled=false;}
  });
  reload.addEventListener('click',()=>chrome.tabs.reload(tabId));
  return el('div',{class:compact?'diagnostic-emulation':'field'},[...(compact?[]:[el('p',{class:'field-desc',text:t('emulation_help')})]),
    el('div',{class:'form-actions'},[button,reload]),note]);
}
