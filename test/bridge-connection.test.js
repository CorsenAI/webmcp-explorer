import test from 'node:test';import assert from 'node:assert/strict';
import {createBridgeConnection} from '../src/background/bridge/connection.js';
import {importSecret,proof,channel,randomHex} from '../src/core/bridge/protocol.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await wait(2);}throw Error('test condition timeout');}
for(const tampered of [false,true])test(`a ${tampered?'rejected':'valid'} MAC finishing after reconnect cannot affect the replacement session`,async t=>{
 const sockets=[],received=[];const original=globalThis.WebSocket;
 class Socket {static OPEN=1;constructor(url){this.url=url;this.readyState=1;this.bufferedAmount=0;this.sent=[];sockets.push(this);}send(v){this.sent.push(JSON.parse(v));}close(){this.readyState=3;this.onclose?.();}deliver(v){this.onmessage?.({data:JSON.stringify(v)});}}
 globalThis.WebSocket=Socket;t.after(()=>{globalThis.WebSocket=original});
 const ext='a'.repeat(32),token=randomHex(32),key=await importSecret(token);
 let lastState;const connection=createBridgeConnection({extensionId:ext,onMessage:(p,s)=>received.push({p,s}),onState:s=>{lastState=s}});t.after(()=>connection.stop());
 async function connect(sid){await connection.start({port:18971,token});const socket=sockets.at(-1),nonce=randomHex(32);
  socket.deliver({type:'challenge',v:1,sessionId:sid,nonce,proof:await proof(key,'server',ext,sid,nonce)});
  await until(()=>socket.sent.length>0);const auth=socket.sent[0];
  socket.deliver({type:'ready',sessionId:sid,proof:await proof(key,'ready',ext,sid,nonce,auth.nonce)});
  await until(()=>connection.connected());return {socket,wire:channel(key,'server',ext,sid,nonce,auth.nonce)};
 }
 const first=await connect('1'.repeat(32));
 const verify=crypto.subtle.verify.bind(crypto.subtle);let release,delay=true;
 t.mock.method(crypto.subtle,'verify',(...args)=>delay?new Promise(resolve=>{release=()=>verify(...args).then(resolve)}):verify(...args));
 const packet=await first.wire.encode({type:'request',request:{id:9,method:'tools/call'}});if(tampered)packet.mac='0'.repeat(64);first.socket.deliver(packet);
 await until(()=>!!release);delay=false;connection.stop();await connect('1'.repeat(32));release();await wait(10);
 assert.deepEqual(received,[]);assert.equal(connection.session(),'1'.repeat(32));assert.equal(lastState,'connected');
});
