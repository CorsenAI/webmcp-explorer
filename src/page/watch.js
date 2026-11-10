// Observation only: no registration, execution, or native API patching. Port payloads remain
// untrusted page claims; the worker supplies the real sender document/frame identity.
//
// A snapshot is the tool names and, per tool, three SHA-256 fingerprints: description, input
// schema, annotations, computed like contractParts() in core/identity.js. A tool replaced under
// its own name is listed at every `toolchange` (measured on Chrome 155 with no gap, a microtask or
// a task between the removal and the new registration, and for a declarative form whose
// attributes are rewritten: tools/e2e/probe-live-swap.mjs), so names cannot show a replacement;
// fingerprints can. Names, fingerprints and a sequence number are all that is posted.
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
  // The canonical forms of core/identity.js, restated: this function is serialised into the page
  // and cannot import.
  const canon=value=>{
    if(value===null||typeof value!=='object')return JSON.stringify(value)??'null';
    if(Array.isArray(value))return '['+value.map(canon).join(',')+']';
    return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
  };
  const hints=annotations=>{
    const out={};
    if(annotations&&typeof annotations==='object')for(const key of Object.keys(annotations).sort()){
      const value=annotations[key];
      out[key]=typeof value==='boolean'?value:value??null;
    }
    return out;
  };
  const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),
    byte=>byte.toString(16).padStart(2,'0')).join('');
  // Fingerprints of the last snapshot by name: an unchanged contract is not hashed again.
  let memo=new Map(), sequence=0;
  const snapshot=async()=>{
    const found=new Map();
    for(const mc of contexts) {
      try {for(const tool of await mc.getTools?.()??[])if(tool.window===window&&!found.has(tool.name))found.set(tool.name,tool);}
      catch { /* native refusal is never bypassed */ }
    }
    const names=[...found.keys()].slice(0,2000), digests=[], next=new Map();
    for(const name of names) {
      let entry=null;
      try {
        const tool=found.get(name);
        const parts=[String(tool.description??''),canon(tool.inputSchema??null),canon(hints(tool.annotations))];
        const source=parts.join('\u0000');
        entry=memo.get(name);
        if(entry?.source!==source)entry={source,value:(await Promise.all(parts.map(sha))).join('.')};
      } catch { entry=null; /* a contract that cannot be read or hashed is posted as not comparable */ }
      if(entry)next.set(name,entry);
      digests.push(entry?.value??null);
    }
    memo=next;
    // Increasing for the life of the document, across a watcher that replaces this one: the
    // worker uses it to drop a snapshot that arrives after a newer one.
    sequence=Math.max(sequence+1,Math.round(performance.now()*1000));
    return {names,digests,seq:sequence};
  };
  // Hashing is asynchronous: two snapshots in flight could be posted out of order and the worker
  // would diff an older tool set against a newer one. One runs at a time; a change that arrives
  // meanwhile asks for exactly one more. The baseline below is the first one in flight.
  let busy=true, again=false;
  const refresh=async()=>{
    if(busy){again=true;return;}
    busy=true;
    try {
      do {
        again=false;
        const state=await snapshot();
        if(!stopped)post({kind:'snapshot',...state});
      } while(again&&!stopped);
    } finally {busy=false;}
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
  for(const mc of contexts)listen(mc,'toolchange',()=>{refresh();});
  const baseline=await snapshot();
  busy=false;
  if(again)refresh();
  scan(document,0);
  // attachShadow() on an already-present host does not mutate the document's light tree.
  const rootPoll=setInterval(()=>scan(document,0),2000);
  window.__webmcpExplorerWatch={channel,stop(){stopped=true;clearTimeout(timer);clearInterval(rootPoll);observer.disconnect();pipe.port1.close();listeners.forEach(off=>off());}};
  return {attached:true,...baseline,origin:location.origin};
}
