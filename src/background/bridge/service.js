import { createBridgeConnection } from './connection.js';
import { createBridgeRegistry } from './registry.js';
import { createApprovals } from '../../core/bridge/approvals.js';
import { guardDecision, boundedArguments, bridgeMetadata, bridgeOutcome } from '../../core/bridge/policy.js';
import { loadBridgeConfig, configureBridge, updateBridgeConfig, bridgeClientConfig, resetBridgeConfig } from '../../storage/bridge.js';
import { createInvocationGuard } from '../../storage/invocations.js';
import { sha256Hex, canonicalJson } from '../../core/identity.js';
import { plainObject } from '../../core/bridge/protocol.js';
import { hasOrigin } from '../../shared/permissions.js';
import { validateArguments } from '../../core/schema/validate.js';
import { walkSchema } from '../../core/security/schema-walk.js';
import { getOverride } from '../../storage/overrides.js';
import { runTool, cancelTool } from '../execute.js';

const notify=()=>{chrome.runtime.sendMessage({type:'local-bridge-changed'}).catch(()=>{});};
const ALARM='local-mcp-bridge-reconnect';
const MAX_ARGS=32768;
export function createLocalBridge() {
  let config=null,transport='disabled',ready=false,poll=null,statusNote=null;
  const envelopeGuard=createInvocationGuard(),active=new Map(),requests=new Map();
  const approvals=createApprovals({onChange:notify});
  let connection;
  function cancelItem(item) {
    item.cancelled=true;approvals.decide(item.approvalId,false);
    if(item.dispatched&&!item.cancelSent){item.cancelSent=true;void cancelTool(item.tabId,item.callId).catch(()=>{});}
  }
  const registry=createBridgeRegistry({
    onChanged:()=>{notify();if(connection?.connected())connection.send({type:'tools-changed'}).catch(()=>{});},
    onInvalidate:(tabId,reason)=>{
      approvals.denyTab(tabId,reason);
      for(const item of active.values())if(item.tabId===tabId){cancelItem(item);if(item.dispatched&&!config?.blocked)void suspend('effect-unknown').catch(()=>{});}
    },
  });
  function clearBindings(reason) {registry.clear(reason);approvals.clear(reason);statusNote=reason;notify();}
  async function suspend(reason) {
    if(config)config={...config,blocked:true};
    clearBindings(reason);
    await updateBridgeConfig(c=>({...c,blocked:true}));
  }
  connection=createBridgeConnection({extensionId:chrome.runtime.id,
    onState:s=>{transport=s;notify();},
    onReady:()=>{requests.clear();clearBindings('new-connection');connection.send({type:'tools-changed'}).catch(()=>{});},
    onClose:reason=>{
      const uncertain=[...requests.values()].some(x=>x.dispatched&&!x.replied);
      for(const item of requests.values())cancelItem(item);requests.clear();
      clearBindings(reason);
      if(uncertain||[...active.values()].some(a=>a.dispatched))void suspend('effect-unknown').catch(()=>{});
    },
    onMessage:(payload,sessionId)=>{
      if(payload?.type==='cancel'){
        const item=requests.get(`${sessionId}:${JSON.stringify(payload.id)}`);
        if(item){cancelItem(item);if(item.dispatched)void suspend('effect-unknown').catch(()=>{});}return;
      }
      if(payload?.type!=='request'||!plainObject(payload.request))return;
      const request=payload.request,epoch=connection.epoch();
      void answer(request,sessionId,epoch).then(async response=>{
        if(currentSession(sessionId,epoch)){await connection.send({type:'response',response});const item=requests.get(`${sessionId}:${JSON.stringify(request.id)}`);if(item)item.replied=true;}
      }).catch(()=>{if(currentSession(sessionId,epoch))connection.send({type:'response',response:{jsonrpc:'2.0',id:request.id,error:{code:-32603,message:'Bridge request failed closed'}}}).catch(()=>{});});
    },
  });
  const refusal=(code,error)=>({ok:false,code,error,attempts:0,dispatchState:'not-dispatched',effectState:'none'});
  const currentSession=(s,epoch)=>config?.enabled&&connection.connected()&&connection.session()===s&&(epoch===undefined||connection.epoch()===epoch);
  async function answer(request,sessionId,epoch) {
    const {id,method}=request,base={jsonrpc:'2.0',id};
    if(request.jsonrpc!=='2.0'||!(typeof id==='string'&&id.length<=128||Number.isSafeInteger(id)))return {...base,error:{code:-32600,message:'Invalid request'}};
    if(!currentSession(sessionId,epoch))return {...base,error:{code:-32001,message:'Disconnected'}};
    if(method==='tools/list')return {...base,result:{tools:config.blocked?[]:await registry.list()}};
    if(method!=='tools/call')return {...base,error:{code:-32601,message:'Unsupported method'}};
    const params=request.params;
    if(!plainObject(params)||typeof params.name!=='string'||!plainObject(params.arguments??{}))return {...base,error:{code:-32602,message:'Tool name and object arguments are required'}};
    const args=params.arguments??{};
    if(!boundedArguments(args)||new TextEncoder().encode(JSON.stringify(args)).length>MAX_ARGS)return {...base,error:{code:-32602,message:'Bridge argument size limit'}};
    const requestKey=`${sessionId}:${JSON.stringify(id)}`;
    if(requests.size>=10000&&!requests.has(requestKey))return {...base,error:{code:-32000,message:'Bridge session request limit'}};
    const item=requests.get(requestKey)??{tabId:null,callId:null,approvalId:crypto.randomUUID(),cancelled:false,dispatched:false,cancelSent:false,replied:false};
    requests.set(requestKey,item); // before the first await: cancellation cannot miss queued work
    const digest=await sha256Hex(canonicalJson([sessionId,id]));
    let outcome=await envelopeGuard({callId:`mcp-envelope:${digest}`,documentId:`mcp:${sessionId}`,name:params.name,args},()=>guarded(params.name,args,sessionId,id,digest,epoch,item));
    if(item.cancelled&&item.dispatched)outcome={...outcome,ok:false,effectState:'unknown',error:'Cancelled after dispatch; effect unknown, not replayed.'};
    if(outcome.effectState==='unknown')await suspend('effect-unknown');
    return {...base,result:bridgeOutcome(outcome)};
  }
  async function guarded(name,args,sessionId,id,digest,epoch,item) {
    if(item.cancelled||!currentSession(sessionId,epoch))return refusal('request-cancelled','The request belongs to an ended connection or was cancelled.');
    if(config.blocked)return refusal('bridge-paused','Review the previous unknown effect and resume from Explorer.');
    const binding=await registry.resolve(name);
    if(!binding||!currentSession(sessionId,epoch)||config.blocked)return refusal('binding-unavailable','The tab or tool binding is no longer shared.');
    if(active.size>=16)return refusal('bridge-busy','Bridge request limit');
    const key=`${sessionId}:${JSON.stringify(id)}`;item.tabId=binding.tabId;item.callId=`mcp-action:${digest}`;
    active.set(key,item);
    let dispatched=false;
    try {
      const tool=binding.tool;
      if(tool.logicalId&&await getOverride(tool.logicalId))return refusal('override-active','Disable local overrides before bridging this tool.');
      const schema=structuredClone(tool.inputSchema),walked=walkSchema(schema);let patterns=false;
      for(const {node} of walked.nodes)if(Object.hasOwn(node,'pattern')){delete node.pattern;patterns=true;}
      if(walked.limitations.length)return refusal('schema-incomplete','Schema exceeds bridge validation limits.');
      const validation=validateArguments(schema,args);
      if(patterns)validation.unchecked.push({reason:'pattern-not-run'});
      if(schema.additionalProperties===false&&Object.keys(args).some(k=>!Object.hasOwn(schema.properties??{},k)))return refusal('invalid-arguments','Undeclared arguments are forbidden by this schema.');
      if(!validation.valid)return refusal('invalid-arguments','Arguments fail the declared schema checks. Nothing was invoked.');
      const decision=guardDecision(tool,{autoReadOnly:config.autoReadOnly});
      // A partial validator cannot silently enable automatic invocation of an unchecked shape.
      if(validation.unchecked.length||validation.warnings.length){decision.approval=true;decision.reasons.push('unchecked-arguments');}
      if(item.cancelled||!currentSession(sessionId,epoch))return refusal('request-cancelled','Cancelled before approval.');
      if(decision.approval) {
        const approved=await approvals.request({id:item.approvalId,tabId:binding.tabId,toolName:tool.name,origin:tool.origin,topOrigin:binding.origin,
          args,expiresAt:Date.now()+config.approvalMs,reasons:decision.reasons,findings:decision.findings,grade:decision.score.grade});
        if(!approved.approved)return refusal(approved.reason,'Corsen Guard did not approve this request. Nothing was invoked.');
      }
      if(item.cancelled||!currentSession(sessionId,epoch)||config.blocked)return refusal('request-cancelled','The request was cancelled before dispatch.');
      const fresh=await registry.resolve(name);
      if(!fresh||fresh.identity!==binding.identity||!registry.current(binding)||!await hasOrigin(tool.origin)||!await hasOrigin(binding.origin))return refusal('binding-changed','The reviewed tool or its access changed. Nothing was invoked.');
      // Write-before-dispatch marker: a worker restart cannot silently permit a new-ID retry.
      config=await updateBridgeConfig(c=>({...c,inflight:[...new Set([...c.inflight,item.callId])]}));
      if(item.cancelled||config.blocked||!currentSession(sessionId,epoch)||!registry.current(binding))return refusal('binding-changed','The binding changed before dispatch.');
      item.dispatched=true;dispatched=true;
      const timeout=setTimeout(()=>{cancelItem(item);void suspend('effect-unknown').catch(()=>{});},30000);
      try {
        const outcome=await runTool(binding.tabId,{callId:item.callId,tool:{...fresh.tool,executionContract:{...fresh.tool.executionContract,reviewedMetadata:bridgeMetadata(fresh.tool),
          requireCapturedAnnotations:fresh.tool.annotationsObserved===true,reviewedDestructive:fresh.tool.annotations?.destructiveHint===true}},toolName:tool.name,frameId:tool.frameId,documentId:tool.documentId,
          origin:tool.origin,args,topOrigin:binding.origin,expectedOverride:null});
        if(!currentSession(sessionId,epoch)||item.cancelled){await suspend('effect-unknown');return {...outcome,ok:false,effectState:'unknown',error:'The bridge binding was lost after dispatch; effect unknown, not replayed.'};}
        if(outcome.effectState==='unknown')await suspend('effect-unknown');
        return outcome;
      } finally {clearTimeout(timeout);}
    } catch {
      if(dispatched)await suspend('effect-unknown');
      return dispatched?{...refusal('bridge-interrupted','Effect unknown; not replayed.'),dispatchState:'dispatched',effectState:'unknown',attempts:1}
        :refusal('bridge-preflight-failed','Preflight failed closed. Nothing was dispatched.');
    } finally {
      active.delete(key);
      try {config=await updateBridgeConfig(c=>({...c,inflight:c.inflight.filter(x=>x!==item.callId)}));}catch{clearBindings('storage-failed');}
    }
  }
  return {
    async init(){if(ready)return;ready=true;
      config=await loadBridgeConfig();if(config.inflight.length)config=await updateBridgeConfig(c=>({...c,blocked:true,inflight:[]}));
      if(config.enabled){await chrome.alarms.create(ALARM,{periodInMinutes:1});await connection.start(config);}
      poll=setInterval(()=>{if(connection.connected()&&!config?.blocked)registry.list().catch(()=>clearBindings('refresh-failed'));},5000);
    },
    async state(){return {enabled:!!config?.enabled,port:config?.port??18971,autoReadOnly:!!config?.autoReadOnly,approvalMs:config?.approvalMs??30000,
      companionPath:config?.companionPath??'',blocked:!!config?.blocked,status:transport,note:statusNote,shares:registry.shares(),pending:approvals.list()};},
    async configure(patch){
      const old=config;config=await configureBridge(patch);
      const reconnect=!old||config.enabled!==old.enabled||config.port!==old.port;
      if(reconnect){connection.stop();clearBindings('configuration-changed');if(config.enabled){await chrome.alarms.create(ALARM,{periodInMinutes:1});await connection.start(config);}else await chrome.alarms.clear(ALARM);}
      notify();return this.state();
    },
    async share(tabId,on){if(!on){registry.invalidate(tabId,'unshared');return this.state();}
      if(!config?.enabled||config.blocked||!connection.connected())throw Error('Connect and review bridge state before sharing a tab');
      const session=connection.session(),epoch=connection.epoch();await registry.share(tabId);
      if(!currentSession(session,epoch)){registry.invalidate(tabId,'connection-changed');throw Error('Connection changed; share the tab again');}
      return this.state();},
    async decide(id,approved){return {accepted:approvals.decide(id,approved)};},
    async resume(){if(active.size)throw Error('Wait for active requests to finish');config=await updateBridgeConfig(c=>({...c,blocked:false,inflight:[]}));statusNote=null;notify();return this.state();},
    async reset(){const uncertain=config?.blocked||[...active.values()].some(x=>x.dispatched)||[...requests.values()].some(x=>x.dispatched&&!x.replied);connection.stop();clearBindings('pairing-forgotten');config=await resetBridgeConfig(!!uncertain);await chrome.alarms.clear(ALARM);notify();return this.state();},
    exportConfig:()=>bridgeClientConfig(chrome.runtime.id),
    invalidate:(id,reason)=>registry.invalidate(id,reason),
    permissionsRemoved:()=>clearBindings('site-access-revoked'),
    wake:()=>connection.wake(),
    async close(){clearInterval(poll);connection.stop();clearBindings('disabled');},
  };
}
