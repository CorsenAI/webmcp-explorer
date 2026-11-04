// Observation only: no registration, execution, or native API patching. Port payloads remain
// untrusted page claims; the worker supplies the real sender document/frame identity.
export async function watchMainWorld(channel) {
  if (window.__webmcpExplorerWatch?.channel === channel) return {attached:true};
  window.__webmcpExplorerWatch?.stop?.();
  let contexts=[];
  try {
    const d=document.modelContext,n=navigator.modelContext;
    contexts=[d,n].filter((v,i)=>v&&(i===0||v!==d));
  } catch { /* an inaccessible API does not stop HTML inventory observation */ }
  const pipe=new MessageChannel();
  window.postMessage({__webmcpExplorerPort:channel}, location.origin==='null'?'*':location.origin,[pipe.port2]);
  const post=payload=>pipe.port1.postMessage(payload);
  const listeners=[], roots=new WeakSet();
  let timer=null, domDirty=false, stopped=false;
  const snapshot=async()=>{
    const names=[];
    for(const mc of contexts) {
      try {for(const tool of await mc.getTools?.()??[])if(tool.window===window)names.push(tool.name);}
      catch { /* native refusal is never bypassed */ }
    }
    return [...new Set(names)].slice(0,2000);
  };
  const schedule=(dom=false)=>{
    domDirty ||= dom;
    if(timer||stopped)return;
    timer=setTimeout(async()=>{
      timer=null;
      if(stopped)return;
      if(domDirty){domDirty=false;post({kind:'dom-changed'});}
      scan(document,0);
    },100);
  };
  const observer=new MutationObserver(()=>schedule(true));
  const scan=(root,depth)=>{
    if(!root||depth>6)return;
    if(!roots.has(root)) {
      roots.add(root);
      observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:[
        'toolname','tooldescription','toolautosubmit','toolparamtitle','toolparamdescription','name',
        'type','required','pattern','min','max','minlength','maxlength','multiple','disabled','form','value',
      ]});
      if(root!==document)schedule(true);
    }
    for(const element of root.querySelectorAll('*'))if(element.shadowRoot)scan(element.shadowRoot,depth+1);
  };
  const listen=(target,type,handler)=>{
    try {target.addEventListener(type,handler);listeners.push(()=>target.removeEventListener(type,handler));}catch{}
  };
  const seen=new WeakSet();
  for(const type of ['toolactivated','toolcancel']) {
    const handler=event=>{if(seen.has(event))return;seen.add(event);post({kind:type==='toolactivated'?'activated':'cancelled',toolName:event.toolName??''});};
    for(const target of [window,...contexts])listen(target,type,handler);
  }
  for(const mc of contexts)listen(mc,'toolchange',()=>{
    snapshot().then(names=>{if(!stopped)post({kind:'snapshot',names});});
  });
  const baseline=await snapshot();
  scan(document,0);
  // attachShadow() on an already-present host does not mutate the document's light tree.
  const rootPoll=setInterval(()=>scan(document,0),2000);
  window.__webmcpExplorerWatch={channel,stop(){stopped=true;clearTimeout(timer);clearInterval(rootPoll);observer.disconnect();pipe.port1.close();listeners.forEach(off=>off());}};
  return {attached:true,names:baseline,origin:location.origin};
}
