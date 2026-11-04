// The only persistent credential representation is authenticated ciphertext. All operations
// serialize in the worker; restarting it discards no needed passphrase or derived key.
import { encryptKeys, decryptKeys, validateKeys } from '../core/key-vault.js';
import { sha256Hex } from '../core/identity.js';
export const VAULT_KEY = 'agentKeyVault';
export const SESSION_KEYS = 'agentKeys';
const MARKER = 'agentKeyVaultSession';

export function createKeyVault({ local, session, crypto = globalThis.crypto }) {
  let queue = Promise.resolve(), protectedStorage = null;
  function serial(work) {
    const result = queue.then(async () => {
      protectedStorage ??= Promise.all([local,session].map(area => area.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'})));
      await protectedStorage;
      return work();
    });
    queue = result.catch(() => {});
    return result;
  }
  const envelope = async () => (await local.get(VAULT_KEY))[VAULT_KEY] ?? null;
  const cache = async () => validateKeys((await session.get(SESSION_KEYS))[SESSION_KEYS] ?? {});
  const stamp = env => sha256Hex(env.ciphertext);
  async function unlocked(env) {
    return !env || (await session.get(MARKER))[MARKER] === await stamp(env);
  }
  async function cacheKeys(keys, env) {
    await session.set({ [SESSION_KEYS]: validateKeys(keys), [MARKER]: env ? await stamp(env) : null });
  }
  async function save(keys, passphrase) {
    const env = await encryptKeys(keys,passphrase,crypto);
    await local.set({ [VAULT_KEY]:env });
    // A partial cache write leaves the new envelope locked: marker mismatch blocks readers.
    await cacheKeys(keys,env);
  }
  const service = {
    protect: () => serial(async () => true),
    status: () => serial(async () => {
      const env=await envelope();return {mode:env?'encrypted':'session',locked:Boolean(env)&&!await unlocked(env)};
    }),
    keyStatus: provider => serial(async () => {
      const env=await envelope(), locked=Boolean(env)&&!await unlocked(env);
      const hasKey=!locked&&Boolean((await cache())[provider]);
      return {hasKey,scope:hasKey?(env?'encrypted':'session'):null,mode:env?'encrypted':'session',locked};
    }),
    getKey: provider => serial(async () => {
      const env=await envelope();return await unlocked(env)?(await cache())[provider]??null:null;
    }),
    setKey: (provider,key,passphrase) => serial(async () => {
      validateKeys({[provider]:key});
      const env=await envelope();const keys=env?await decryptKeys(env,passphrase,crypto):await cache();
      keys[provider]=key;
      if(env)await save(keys,passphrase);else await cacheKeys(keys,null);
      return {stored:true,scope:env?'encrypted':'session'};
    }),
    clearKey: (provider,passphrase) => serial(async () => {
      const env=await envelope();const keys=env?await decryptKeys(env,passphrase,crypto):await cache();
      delete keys[provider];if(env)await save(keys,passphrase);else await cacheKeys(keys,null);
      return {cleared:true};
    }),
    create: passphrase => serial(async () => {
      if(await envelope())throw Error('A vault already exists. Unlock it to change its keys.');
      await save(await cache(),passphrase);return {mode:'encrypted',locked:false};
    }),
    unlock: passphrase => serial(async () => {
      const env=await envelope();if(!env)throw Error('No encrypted vault exists.');
      const keys=await decryptKeys(env,passphrase,crypto);await cacheKeys(keys,env);
      return {mode:'encrypted',locked:false};
    }),
    lock: () => serial(async () => { await session.remove([SESSION_KEYS,MARKER]);return {locked:true}; }),
    useSession: passphrase => serial(async () => {
      const env=await envelope();const keys=env?await decryptKeys(env,passphrase,crypto):await cache();
      await cacheKeys(keys,env);await local.remove(VAULT_KEY);await session.remove(MARKER);
      return {mode:'session',locked:false};
    }),
    reset: () => serial(async () => {
      await session.remove([SESSION_KEYS,MARKER]);await local.remove(VAULT_KEY);return {reset:true};
    }),
  };
  return service;
}
let service;
export function keyVault() {
  return service ??= createKeyVault({local:chrome.storage.local,session:chrome.storage.session});
}
