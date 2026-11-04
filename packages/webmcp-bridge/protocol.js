// Shared verbatim with the zero-dependency companion. No Chrome or Node-only API.
export const WIRE_VERSION = 1;
export const MAX_MESSAGE = 1048576;
export const plainObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export function randomHex(bytes = 32) { return hex(crypto.getRandomValues(new Uint8Array(bytes))); }
const hex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const unhex = s => Uint8Array.from(s.match(/../g) ?? [],b=>parseInt(b,16));
export function validSecret(s) { return typeof s === 'string' && /^[a-f0-9]{64}$/.test(s); }
export async function importSecret(secret) {
  if (!validSecret(secret)) throw Error('Invalid pairing secret');
  return crypto.subtle.importKey('raw',unhex(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
export async function proof(key,role,extensionId,sessionId,serverNonce,clientNonce='') {
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes(['corsen-local-bridge',WIRE_VERSION,role,extensionId,sessionId,serverNonce,clientNonce]))));
}
export async function verifyProof(key,mac,...tuple) {
  return validSecret(mac) && crypto.subtle.verify('HMAC',key,unhex(mac),bytes(['corsen-local-bridge',WIRE_VERSION,...tuple]));
}
export function channel(key,side,extensionId,sessionId,serverNonce,clientNonce) {
  let sent=0, received=0;
  const transcript=(role,seq,payload)=>['corsen-local-data',WIRE_VERSION,role,extensionId,sessionId,serverNonce,clientNonce,seq,payload];
  return {
    async encode(payload) {
      const seq=++sent, body=bytes(transcript(side,seq,payload));
      if(body.length>MAX_MESSAGE-512)throw Error('Bridge message limit');
      const mac=hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,body)));
      return {v:WIRE_VERSION,sessionId,seq,payload,mac};
    },
    async decode(packet) {
      if(!plainObject(packet)||packet.v!==WIRE_VERSION||packet.sessionId!==sessionId||packet.seq!==received+1)throw Error('Invalid bridge sequence');
      const body=bytes(transcript(side==='client'?'server':'client',packet.seq,packet.payload));
      if(body.length>MAX_MESSAGE||!validSecret(packet.mac)||!await crypto.subtle.verify('HMAC',key,unhex(packet.mac),body))throw Error('Bridge authentication failed');
      received=packet.seq;return packet.payload;
    },
  };
}
