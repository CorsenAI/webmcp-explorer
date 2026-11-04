import { el, t } from '../dom.js';
import { hasOrigin } from '../../shared/permissions.js';
const send=async message=>{const r=await chrome.runtime.sendMessage(message);if(r?.error)throw Error(r.error);return r;};
const exact=value=>JSON.stringify(value,null,2).replace(/[\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);

export async function renderBridgeSettings(root) {
  const copied=el('p',{class:'field-note',role:'status',hidden:''});
  const status=el('p',{class:'field-desc',role:'status'}),error=el('p',{class:'field-note error',role:'status',hidden:''});
  const port=el('input',{id:'bridge-port',dir:'ltr',type:'number',min:'1024',max:'65535',title:t('bridge_portHelp'),'aria-label':t('bridge_port')});
  const timeout=el('input',{id:'bridge-timeout',dir:'ltr',type:'number',min:'5',max:'60',title:t('bridge_timeoutHelp'),'aria-label':t('bridge_timeout')});
  const path=el('input',{id:'bridge-path',dir:'ltr',type:'text',title:t('bridge_pathHelp'),'aria-label':t('bridge_path'),placeholder:t('bridge_pathPlaceholder')});
  const auto=el('input',{id:'bridge-auto-read',type:'checkbox',title:t('bridge_autoHelp')});
  const tabs=el('select',{id:'bridge-tab',dir:'ltr',title:t('bridge_shareHelp'),'aria-label':t('bridge_tab')});
  const shares=el('div',{});let state={enabled:false},disposed=false;
  const field=(label,input)=>el('label',{class:'bridge-field'},[el('span',{text:label}),input]);
  const perform=async fn=>{error.textContent='';error.hidden=true;copied.hidden=true;try{await fn();await refresh();}catch(e){error.hidden=false;error.textContent=String(e.message);}};
  const save=()=>send({type:'local-bridge-configure',patch:{port:Number(port.value),approvalMs:Number(timeout.value)*1000,autoReadOnly:auto.checked,companionPath:path.value.trim()}});
  const toggle=el('button',{id:'bridge-toggle',text:t('bridge_enable'),title:t('bridge_enableHelp')});
  toggle.addEventListener('click',()=>perform(async()=>{await save();await send({type:'local-bridge-configure',patch:{enabled:!state.enabled}});}));
  const copy=el('button',{id:'bridge-copy-config',text:t('bridge_copyConfig'),title:t('bridge_copyHelp')});
  copy.addEventListener('click',()=>perform(async()=>{await save();const config=await send({type:'local-bridge-client-config'});await navigator.clipboard.writeText(JSON.stringify(config,null,2));copied.textContent=t('bridge_copied');copied.hidden=false;}));
  const apply=el('button',{id:'bridge-save',text:t('bridge_save'),title:t('bridge_saveHelp')});apply.addEventListener('click',()=>perform(save));
  const share=el('button',{id:'bridge-share',text:t('bridge_share'),title:t('bridge_shareHelp')});share.addEventListener('click',()=>perform(()=>send({type:'local-bridge-share',tabId:Number(tabs.value),on:true})));
  const reset=el('button',{id:'bridge-reset',text:t('bridge_reset'),title:t('bridge_resetHelp')});reset.addEventListener('click',()=>perform(()=>send({type:'local-bridge-reset'})));
  const resume=el('button',{id:'bridge-resume',text:t('bridge_resume'),title:t('bridge_resumeHelp')});resume.addEventListener('click',()=>perform(()=>send({type:'local-bridge-resume'})));
  root.replaceChildren(el('h2',{class:'field-group',text:t('bridge_title')}),el('p',{class:'field-desc',text:t('bridge_intro')}),
    status,el('p',{class:'field-desc nn-notice',text:t('bridge_pairingNote')}),field(t('bridge_port'),port),field(t('bridge_timeout'),timeout),
    field(t('bridge_path'),path),el('label',{class:'bridge-check'},[auto,el('span',{text:t('bridge_auto')})]),
    el('p',{class:'field-desc',text:t('bridge_autoHelp')}),el('div',{class:'row-inline'},[toggle,apply,copy,reset,resume]),
    copied,field(t('bridge_tab'),tabs),el('div',{class:'row-inline'},[share]),shares,error);
  async function refresh(initial=false) {
    const next=await send({type:'local-bridge-state'});if(disposed)return;const previous=state;state=next;
    if(initial||['port','approvalMs','companionPath','autoReadOnly'].some(k=>previous[k]!==state[k])){port.value=String(state.port);timeout.value=String(state.approvalMs/1000);path.value=state.companionPath;auto.checked=state.autoReadOnly;}
    status.textContent=t('bridge_status',[t(`bridge_status_${state.status.replaceAll('-', '_')}`)]);
    if(state.blocked)status.textContent+=' '+t('bridge_unknown');
    toggle.textContent=t(state.enabled?'bridge_disable':'bridge_enable');copy.disabled=!state.enabled;
    resume.hidden=!state.blocked;share.disabled=state.status!=='connected'||state.blocked;
    const selected=tabs.value,available=[];
    for(const tab of await chrome.tabs.query({}))if(tab.url&&/^https?:/.test(tab.url)&&await hasOrigin(tab.url))available.push(tab);
    if(disposed)return;
    tabs.replaceChildren(...available.map(tab=>el('option',{value:String(tab.id),text:`#${tab.id} · ${new URL(tab.url).origin}`})));
    if(available.some(tab=>String(tab.id)===selected))tabs.value=selected;
    else if(available.some(tab=>tab.active))tabs.value=String(available.find(tab=>tab.active).id);
    share.disabled=share.disabled||!available.length;
    shares.replaceChildren(...state.shares.map(s=>{
      const stop=el('button',{text:t('bridge_unshare'),title:t('bridge_unshareHelp')});
      stop.addEventListener('click',()=>perform(()=>send({type:'local-bridge-share',tabId:s.tabId,on:false})));
      return el('div',{class:'row-inline bridge-shared'},[el('span',{dir:'ltr',text:`#${s.tabId} · ${s.origin} · ${s.count}`}),stop]);
    }));
  }
  const changed=m=>{if(m?.type==='local-bridge-changed')refresh().catch(()=>{});};chrome.runtime.onMessage.addListener(changed);
  root.closest('#view')?.addEventListener('explorer:teardown',()=>{disposed=true;chrome.runtime.onMessage.removeListener(changed);},{once:true});
  try {await refresh(true);} catch(e) {error.hidden=false;error.textContent=String(e.message);}
}

export function mountBridgeApprovals(root) {
  const nodes=new Map();let updating=false,again=false;
  async function update() {
    if(updating){again=true;return;}updating=true;
    try {
      const state=await send({type:'local-bridge-state'}),ids=new Set(state.pending.map(p=>p.id));
      for(const [id,entry] of nodes)if(!ids.has(id)){entry.card.remove();nodes.delete(id);}
      for(const p of state.pending)if(!nodes.has(p.id)) {
        const status=el('p',{class:'field-note',role:'status'});
        const approve=el('button',{text:t('bridge_approve'),title:t('bridge_approveHelp'),'data-bridge-approve':p.id});
        const deny=el('button',{text:t('bridge_deny'),title:t('bridge_denyHelp'),'data-bridge-deny':p.id});
        const decide=async approved=>{approve.disabled=true;deny.disabled=true;try{const r=await send({type:'local-bridge-decide',id:p.id,approved});if(!r.accepted&&approved)status.textContent=t('bridge_expired');await update();}catch{status.textContent=t('bridge_expired');}};
        approve.addEventListener('click',()=>decide(true));deny.addEventListener('click',()=>decide(false));
        const clock=el('p',{class:'field-note'});
        const card=el('section',{class:'bridge-approval card','aria-label':t('bridge_approvalTitle'),'data-approval-id':p.id},[
          el('h2',{class:'field-group',text:t('bridge_approvalTitle')}),
          el('p',{class:'bridge-exact',dir:'ltr',text:exact(p.toolName)}),
          el('p',{class:'bridge-exact',dir:'ltr',text:p.origin}),
          el('p',{class:'field-desc',text:t('bridge_reasons',[p.reasons.map(r=>t(`bridge_reason_${r.replaceAll('-','_')}`)).join(', ')])}),
          el('pre',{class:'sec-evidence bridge-arguments',dir:'ltr',text:exact(p.args)}),clock,
          el('div',{class:'row-inline'},[deny,approve]),status,
        ]);nodes.set(p.id,{card,clock,approve,deny,expires:p.expiresAt});root.append(card);
      }
      root.hidden=nodes.size===0;tick();
    } catch {root.hidden=nodes.size===0;}finally{updating=false;if(again){again=false;void update();}}
  }
  function tick(){for(const x of nodes.values()){const remaining=Math.max(0,Math.ceil((x.expires-Date.now())/1000));x.clock.textContent=t('bridge_deadline',[String(remaining)]);if(!remaining)x.approve.disabled=true;}}
  const listener=m=>{if(m?.type==='local-bridge-changed')void update();};chrome.runtime.onMessage.addListener(listener);
  setInterval(tick,500);void update();return (retranslate=false)=>{if(retranslate){nodes.clear();root.replaceChildren();}return update();};
}
