// Imported by the worker and serialised into ISOLATED. The transferred port is telemetry
// only, not page authentication. It cannot carry commands or expose extension state.
export function relayInPage(channel) {
  if (window.__webmcpExplorerRelay?.channel === channel) return;
  window.__webmcpExplorerRelay?.stop?.();
  let port = null, count = 0, second = 0;
  const connect = event => {
    if (event.source !== window || event.data?.__webmcpExplorerPort !== channel || event.ports.length !== 1) return;
    if (port) { event.ports[0].close(); return; }
    port = event.ports[0];
    port.onmessage = event => {
      const now = Math.floor(Date.now()/1000);
      if (now !== second) { second=now;count=0; }
      if (++count > 60) return;
      const p=event.data;
      if (!p || !['snapshot','activated','cancelled','dom-changed'].includes(p.kind)) return;
      const payload={kind:p.kind,at:Date.now()};
      if(p.kind==='snapshot') {
        if(!Array.isArray(p.names)||p.names.length>2000||p.names.some(n=>typeof n!=='string'||n.length>200))return;
        payload.names=p.names;
        // Fingerprints and the sequence number are optional: without them the worker still
        // diffs the names. The worker checks their form again; this only bounds what is sent.
        if(Array.isArray(p.digests)&&p.digests.length===p.names.length
          &&p.digests.every(d=>d===null||(typeof d==='string'&&d.length===194)))payload.digests=p.digests;
        if(Number.isSafeInteger(p.seq)&&p.seq>0)payload.seq=p.seq;
      } else if(p.kind!=='dom-changed') {
        if(typeof p.toolName!=='string'||p.toolName.length>200)return;
        payload.toolName=p.toolName;
      }
      chrome.runtime.sendMessage({type:'live-event',payload}).catch(()=>{});
    };
    port.start();
  };
  window.addEventListener('message',connect);
  window.__webmcpExplorerRelay={channel,stop(){window.removeEventListener('message',connect);port?.close();}};
}
