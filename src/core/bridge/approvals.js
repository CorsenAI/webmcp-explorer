// Only the trusted UI handler may call decide. An approval never authorizes a second request.
export function createApprovals({now=Date.now,onChange=()=>{}}={}) {
  const pending=new Map();
  const finish=(id,approved,reason)=>{
    const entry=pending.get(id);if(!entry)return false;
    pending.delete(id);clearTimeout(entry.timer);
    const expired=now()>=entry.value.expiresAt;
    entry.resolve({approved:approved&&!expired,reason:expired?'approval-timeout':reason});onChange();return approved&&!expired;
  };
  return {
    request(value) {
      if(pending.has(value.id)||pending.size>=16)return Promise.resolve({approved:false,reason:'approval-capacity'});
      return new Promise(resolve=>{
        const entry={value:structuredClone(value),resolve};pending.set(value.id,entry);
        entry.timer=setTimeout(()=>finish(value.id,false,'approval-timeout'),Math.max(0,value.expiresAt-now()));onChange();
      });
    },
    list:()=>[...pending.values()].map(e=>structuredClone(e.value)),
    decide:(id,approved)=>finish(id,approved===true,approved?'approved':'denied'),
    denyTab(tabId,reason='binding-invalidated'){for(const [id,e] of pending)if(e.value.tabId===tabId)finish(id,false,reason);},
    clear(reason='bridge-disconnected'){for(const id of pending.keys())finish(id,false,reason);},
  };
}
