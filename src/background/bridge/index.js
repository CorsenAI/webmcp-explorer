import { createLocalBridge } from './service.js';
export const localBridge=createLocalBridge();
export const bridgeHandlers={
  'local-bridge-state':()=>localBridge.state(),
  'local-bridge-configure':m=>localBridge.configure(m.patch??{}),
  'local-bridge-share':m=>localBridge.share(m.tabId,m.on===true),
  'local-bridge-decide':m=>localBridge.decide(m.id,m.approved===true),
  'local-bridge-resume':()=>localBridge.resume(),
  'local-bridge-reset':()=>localBridge.reset(),
  'local-bridge-client-config':()=>localBridge.exportConfig(),
};
// Top-level listeners wake MV3 and synchronously invalidate before asynchronous work.
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status==='loading'||change.url)localBridge.invalidate(id,'navigation');});
chrome.tabs.onRemoved.addListener(id=>localBridge.invalidate(id,'tab-closed'));
chrome.permissions.onRemoved.addListener(()=>localBridge.permissionsRemoved());
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='local-mcp-bridge-reconnect')localBridge.wake().catch(()=>{});});
