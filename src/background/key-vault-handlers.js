// Wired only into the extension-page message router. No read-key handler exists.
import { keyVault } from '../storage/key-vault.js';
import { setKey, clearKey, keyStatus } from '../storage/agent-config.js';
const changed = async operation => {
  const result = await operation();
  chrome.runtime.sendMessage({type:'agent-config-changed'}).catch(()=>{});
  return result;
};
export const keyVaultHandlers = {
  'agent-vault-status': () => keyVault().status(),
  'agent-vault-create': msg => changed(()=>keyVault().create(msg.passphrase)),
  'agent-vault-unlock': msg => changed(()=>keyVault().unlock(msg.passphrase)),
  'agent-vault-lock': () => changed(()=>keyVault().lock()),
  'agent-vault-session': msg => changed(()=>keyVault().useSession(msg.passphrase)),
  'agent-vault-reset': () => changed(()=>keyVault().reset()),
  'agent-key-set': msg => changed(()=>setKey(msg.providerId,msg.key,msg.passphrase)),
  'agent-key-clear': msg => changed(()=>clearKey(msg.providerId,msg.passphrase)),
  'agent-key-status': msg => keyStatus(msg.providerId),
};
