import { discover } from '../discover.js';
import { hasOrigin } from '../../shared/permissions.js';
import { sha256Hex, canonicalJson } from '../../core/identity.js';
// Only tabIds explicitly shared from the extension UI can enter this registry.
export function createBridgeRegistry({onInvalidate=()=>{},onChanged=()=>{}}={}) {
  const tabs=new Map();let sequence=0;
  const publicTool=b=>({name:b.name,title:`${b.tool.name} · ${b.tool.origin}`,description:b.tool.description,inputSchema:b.tool.inputSchema,
    annotations:{readOnlyHint:b.tool.annotations?.readOnlyHint===true,
      ...(b.tool.annotations?.destructiveHint===true||b.tool.annotations?.consequentialHint===true?{destructiveHint:true}:{})},
    _meta:{'corsen/origin':b.tool.origin,'corsen/toolName':b.tool.name,'corsen/tabId':b.tabId}});
  function invalidate(tabId,reason='binding-invalidated') {
    if(!tabs.has(tabId))return;tabs.delete(tabId);sequence++;onInvalidate(tabId,reason);onChanged();
  }
  async function refresh(tabId) {
    const share=tabs.get(tabId);if(!share)return false;
    const epoch=share.epoch,tab=await chrome.tabs.get(tabId).catch(()=>null);
    if(!tab?.url||tab.status==='loading'||new URL(tab.url).origin!==share.origin||!await hasOrigin(tab.url)){invalidate(tabId,'site-access-changed');return false;}
    let discovery;try{discovery=await discover(tabId,tab.url);}catch{invalidate(tabId,'discovery-unavailable');return false;}
    if(tabs.get(tabId)!==share||share.epoch!==epoch)return false;
    let identities;
    try { identities=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'ISOLATED',func:()=>({origin:location.origin})}); }
    catch {invalidate(tabId,'document-identity-unavailable');return false;}
    const top=identities.find(f=>f.frameId===0);
    if(!top?.documentId||share.documentId&&share.documentId!==top.documentId){invalidate(tabId,'document-changed');return false;}
    const bindings=[];let bytes=0;
    for(const tool of discovery.tools??[]) {
      if(tool.notInjected||tool.inventoryOnly||tool.overridden||!tool.documentId||!tool.executionContract||!Number.isInteger(tool.frameId)||!tool.inputSchema)continue;
      const frame=identities.find(f=>f.frameId===tool.frameId&&f.documentId===tool.documentId);
      if(!frame||frame.result?.origin!==tool.origin||!await hasOrigin(frame.result.origin))continue;
      const identity=canonicalJson([tabId,tool.documentId,tool.frameId,tool.runtimeId,tool.name,tool.origin,tool.contractFp,tool.title,tool.annotationsObserved,tool.autoSubmit,tool.schemaComplete,tool.executionContract]);
      const digest=await sha256Hex(identity),name=`tab_${tabId}_${digest.slice(0,24)}_${tool.name.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,60)}`;
      const binding={name,tabId,origin:share.origin,documentId:top.documentId,tool,identity,epoch};
      const size=new TextEncoder().encode(JSON.stringify(publicTool(binding))).length;
      if(size>65536||bytes+size>65536||bindings.length>=200)continue;bytes+=size;bindings.push(binding);
    }
    // Chrome supplies the tab identity; a navigation/revocation during discovery wins.
    if(tabs.get(tabId)!==share||share.epoch!==epoch||!await hasOrigin(tab.url))return false;
    const current=await chrome.tabs.get(tabId).catch(()=>null);
    if(!current?.url||new URL(current.url).origin!==share.origin){invalidate(tabId,'navigation');return false;}
    if(tabs.get(tabId)!==share)return false;
    share.documentId=top.documentId;const signature=JSON.stringify(bindings.map(b=>b.identity));
    const changed=signature!==share.signature;share.bindings=bindings;share.signature=signature;
    if(changed)onChanged();return true;
  }
  return {
    invalidate,clear(reason){for(const id of [...tabs.keys()])invalidate(id,reason);},
    shares:()=>[...tabs.values()].map(s=>({tabId:s.tabId,origin:s.origin,count:s.bindings.length})),
    async share(tabId){
      if(!Number.isInteger(tabId)||tabId<0)throw Error('Invalid tab');
      const tab=await chrome.tabs.get(tabId);if(!tab.url||!await hasOrigin(tab.url))throw Error('Grant this site access before sharing');
      if(tabs.size>=8&&!tabs.has(tabId))throw Error('Share at most eight tabs');
      invalidate(tabId,'replaced');tabs.set(tabId,{tabId,origin:new URL(tab.url).origin,epoch:++sequence,bindings:[]});
      if(!await refresh(tabId))throw Error('The tab changed while sharing');return this.shares();
    },
    async list(){for(const id of [...tabs.keys()])await refresh(id);return [...tabs.values()].flatMap(s=>s.bindings.map(publicTool)).sort((a,b)=>a.name.localeCompare(b.name));},
    async resolve(name){
      const before=[...tabs.values()].flatMap(s=>s.bindings).find(b=>b.name===name);if(!before)return null;
      if(!await refresh(before.tabId))return null;
      return tabs.get(before.tabId)?.bindings.find(b=>b.name===name&&b.identity===before.identity)??null;
    },
    current(binding){const s=tabs.get(binding.tabId);return !!s&&s.epoch===binding.epoch&&s.bindings.some(b=>b.name===binding.name&&b.identity===binding.identity);},
  };
}
