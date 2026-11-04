// WebCrypto-only authenticated encryption. The caller owns storage; neither passphrases nor
// derived CryptoKeys are returned or retained. The KDF cost is fixed for this envelope version.
export const VAULT_VERSION = 1;
export const VAULT_ITERATIONS = 600000;
const MAX_BYTES = 65536;
const bytes = text => new TextEncoder().encode(text);
const encode = data => btoa(String.fromCharCode(...new Uint8Array(data)));
function decode(text, max) {
  if (typeof text !== 'string' || text.length > Math.ceil(max / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw Error('Invalid vault envelope.');
  const value = Uint8Array.from(atob(text), char => char.charCodeAt(0));
  if (value.length > max || encode(value) !== text) throw Error('Invalid vault envelope.');
  return value;
}
export function validateKeys(keys) {
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw Error('Invalid key collection.');
  const out = Object.create(null);
  for (const [provider, key] of Object.entries(keys)) {
    if (!provider || provider.length > 200 || ['__proto__','constructor','prototype'].includes(provider)
      || typeof key !== 'string' || key.length > 8192) throw Error('Invalid provider key.');
    out[provider] = key;
  }
  if (bytes(JSON.stringify(out)).length > MAX_BYTES) throw Error('Key collection is too large.');
  return out;
}
export function validatePassphrase(passphrase) {
  if (typeof passphrase !== 'string' || [...passphrase].length < 12 || bytes(passphrase).length > 4096 || !passphrase.trim()) {
    throw Error('Use a passphrase of at least 12 characters.');
  }
}
function envelopeData(envelope) {
  if (!envelope || Object.keys(envelope).sort().join(',') !== 'ciphertext,iterations,iv,salt,version'
    || envelope.version !== VAULT_VERSION || envelope.iterations !== VAULT_ITERATIONS) throw Error('Unsupported vault envelope.');
  const salt = decode(envelope.salt,16), iv = decode(envelope.iv,12), ciphertext = decode(envelope.ciphertext,MAX_BYTES+16);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw Error('Invalid vault envelope.');
  return { salt, iv, ciphertext };
}
async function derive(passphrase, salt, crypto) {
  validatePassphrase(passphrase);
  const material = await crypto.subtle.importKey('raw', bytes(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name:'PBKDF2', hash:'SHA-256', iterations:VAULT_ITERATIONS, salt },
    material, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
}
const additionalData = bytes(`webmcp-explorer-key-vault:${VAULT_VERSION}:${VAULT_ITERATIONS}`);
export async function encryptKeys(keys, passphrase, crypto = globalThis.crypto) {
  const payload = bytes(JSON.stringify(validateKeys(keys)));
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(passphrase,salt,crypto);
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData,tagLength:128},key,payload);
  payload.fill(0);
  return { version:VAULT_VERSION, iterations:VAULT_ITERATIONS, salt:encode(salt), iv:encode(iv), ciphertext:encode(ciphertext) };
}
export async function decryptKeys(envelope, passphrase, crypto = globalThis.crypto) {
  try {
    const {salt,iv,ciphertext} = envelopeData(envelope);
    const key = await derive(passphrase,salt,crypto);
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData,tagLength:128},key,ciphertext));
    try { return validateKeys(JSON.parse(new TextDecoder().decode(plaintext))); }
    finally { plaintext.fill(0); }
  } catch { throw Error('The vault could not be unlocked. Check the passphrase and vault integrity.'); }
}
