// Session-only pairing. This key is intentionally absent from settings exports and the API vault.
import { bridgeUrl, DEFAULT_PORT } from '../core/bridge/policy.js';
import { randomHex, validSecret } from '../core/bridge/protocol.js';
const KEY='localMcpBridge';let writes=Promise.resolve();
const defaults=()=>({enabled:false,port:DEFAULT_PORT,autoReadOnly:false,approvalMs:30000,token:null,companionPath:'',inflight:[],blocked:false});
export async function loadBridgeConfig() {
  await writes;const raw=(await chrome.storage.session.get(KEY))[KEY];
  if(!raw)return defaults();bridgeUrl(raw.port);
  if(raw.enabled&&!validSecret(raw.token))throw Error('Invalid bridge pairing state');
  return {...defaults(),...raw};
}
export function updateBridgeConfig(change) {
  const next=writes.catch(()=>{}).then(async()=>{
    const raw=(await chrome.storage.session.get(KEY))[KEY]??defaults();
    const value=change({...defaults(),...raw});bridgeUrl(value.port);
    if(!Number.isInteger(value.approvalMs)||value.approvalMs<5000||value.approvalMs>60000)throw Error('Approval timeout must be 5–60 seconds');
    await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
    await chrome.storage.session.set({[KEY]:value});return value;
  });writes=next.then(()=>{},()=>{});return next;
}
export async function configureBridge(patch={}) {
  return updateBridgeConfig(c=>{
    for(const field of ['enabled','autoReadOnly'])if(Object.hasOwn(patch,field)){
      if(typeof patch[field]!=='boolean')throw Error('Invalid bridge switch');c[field]=patch[field];
    }
    if(Object.hasOwn(patch,'port'))c.port=patch.port;
    if(Object.hasOwn(patch,'approvalMs'))c.approvalMs=patch.approvalMs;
    if(Object.hasOwn(patch,'companionPath')){
      if(typeof patch.companionPath!=='string'||patch.companionPath.length>2000||/[\r\n\0]/.test(patch.companionPath))throw Error('Invalid companion path');
      if(patch.companionPath&&!/^(?:\/(?!\/)|[A-Za-z]:[\\/])/.test(patch.companionPath))throw Error('Use an absolute local companion script path');
      c.companionPath=patch.companionPath;
    }
    if(c.enabled&&!validSecret(c.token))c.token=randomHex(32);
    return c;
  });
}
export async function bridgeClientConfig(extensionId) {
  const c=await loadBridgeConfig();if(!c.enabled||!validSecret(c.token))throw Error('Enable this browser session first');
  return {mcpServers:{'webmcp-explorer':{command:c.companionPath?'node':'webmcp-bridge',args:c.companionPath?['--',c.companionPath]:[],
    env:{WEBMCP_BRIDGE_PORT:String(c.port),WEBMCP_EXTENSION_ID:extensionId,WEBMCP_BRIDGE_TOKEN:c.token}}}};
}
export function resetBridgeConfig(blocked=false) {
  return updateBridgeConfig(()=>({...defaults(),blocked}));
}
