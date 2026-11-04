import test from 'node:test';import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';import { createServer as tcpServer, connect } from 'node:net';
import { randomBytes } from 'node:crypto';import { readFileSync } from 'node:fs';
import { createRelay } from '../packages/webmcp-bridge/relay.js';
import { importSecret, proof, verifyProof, channel, randomHex } from '../packages/webmcp-bridge/protocol.js';
const extensionId='a'.repeat(32);
async function port(){const s=tcpServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
function masked(text,{fin=true,op=1,mask=true,rsv=0}={}){
 const b=Buffer.from(text),h=Buffer.alloc(b.length<126?2:4);h[0]=(fin?128:0)|rsv|op;h[1]=(mask?128:0)|(b.length<126?b.length:126);if(b.length>=126)h.writeUInt16BE(b.length,2);
 if(!mask)return Buffer.concat([h,b]);const m=randomBytes(4),v=Buffer.from(b);for(let i=0;i<v.length;i++)v[i]^=m[i%4];return Buffer.concat([h,m,v]);
}
async function client(p,{origin=`chrome-extension://${extensionId}`,host=`127.0.0.1:${p}`}={}){
 const s=connect(p,'127.0.0.1');let buffer=Buffer.alloc(0),header=null,frames=[];const waiting=[];
 const flush=()=>{while(waiting.length&&frames.length)waiting.shift()(frames.shift());};
 s.on('data',b=>{buffer=Buffer.concat([buffer,b]);if(header===null){const at=buffer.indexOf('\r\n\r\n');if(at<0)return;header=buffer.subarray(0,at).toString();buffer=buffer.subarray(at+4);}
 while(buffer.length>=2){let n=buffer[1]&127,k=2;if(n===126){if(buffer.length<4)return;n=buffer.readUInt16BE(2);k=4;}if(n===127){if(buffer.length<10)return;n=Number(buffer.readBigUInt64BE(2));k=10;}if(buffer.length<k+n)return;frames.push({op:buffer[0]&15,data:buffer.subarray(k,k+n)});buffer=buffer.subarray(k+n);flush();}});
 s.on('error',()=>{});
 await new Promise(r=>s.once('connect',r));
 s.write(`GET /webmcp-bridge HTTP/1.1\r\nHost: ${host}\r\nOrigin: ${origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n\r\n`);
 for(let i=0;i<100&&header===null;i++)await new Promise(r=>setTimeout(r,5));
 return {s,get header(){return header},send:(text,opts)=>s.write(masked(text,opts)),next:()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Test socket timeout')),1500);waiting.push(f=>{clearTimeout(timer);resolve(f);});flush();})};
}
async function setup(t){const input=new PassThrough(),output=new PassThrough(),messages=[];let out='';const token=randomHex(32),p=await port();
 output.on('data',b=>{out+=b;let n;while((n=out.indexOf('\n'))>=0){messages.push(JSON.parse(out.slice(0,n)));out=out.slice(n+1);}});
 const relay=createRelay({token,extensionId,port:p,input,output});await relay.start();t.after(()=>relay.stop());
 const request=m=>input.write(JSON.stringify(m)+'\n');
 async function response(id){for(let i=0;i<300;i++){const m=messages.find(x=>x.id===id);if(m)return m;await new Promise(r=>setTimeout(r,5));}throw Error('Test stdio timeout');}
 return {relay,token,p,input,output,messages,request,response};}
async function authenticate(c,token){const key=await importSecret(token),challenge=JSON.parse((await c.next()).data.toString()),nonce=randomHex(32);
 assert.equal(await verifyProof(key,challenge.proof,'server',extensionId,challenge.sessionId,challenge.nonce,''),true);
 c.send(JSON.stringify({type:'authenticate',sessionId:challenge.sessionId,nonce,proof:await proof(key,'client',extensionId,challenge.sessionId,challenge.nonce,nonce)}));
 const ready=JSON.parse((await c.next()).data.toString());assert.equal(await verifyProof(key,ready.proof,'ready',extensionId,challenge.sessionId,challenge.nonce,nonce),true);
 return channel(key,'client',extensionId,challenge.sessionId,challenge.nonce,nonce);
}
const initialize=s=>{s.request({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}});s.request({jsonrpc:'2.0',method:'notifications/initialized'});};
test('the packaged protocol is byte-identical to the extension protocol',()=>assert.equal(readFileSync(new URL('../src/core/bridge/protocol.js',import.meta.url),'utf8'),readFileSync(new URL('../packages/webmcp-bridge/protocol.js',import.meta.url),'utf8')));
test('stdio initialization is standard JSON-RPC, empty until authenticated, and stdout contains no secret',async t=>{
 const s=await setup(t);assert.equal(s.relay.server.address().address,'127.0.0.1');
 s.request({jsonrpc:'2.0',id:0,method:'tools/list'});assert.equal((await s.response(0)).error.code,-32002);
 initialize(s);assert.equal((await s.response(1)).result.protocolVersion,'2025-11-25');
 s.request({jsonrpc:'2.0',id:2,method:'tools/list'});assert.deepEqual((await s.response(2)).result,{tools:[]});
 assert.equal(JSON.stringify(s.messages).includes(s.token),false);
});
test('wrong browser Origin, rebinding Host and missing token fail without taking over the relay',async t=>{
 const s=await setup(t);
 for(const options of [{origin:'https://evil.test'},{host:`evil.test:${s.p}`}]){const c=await client(s.p,options);assert.match(c.header,/403/);c.s.destroy();}
 const bad=await client(s.p);const challenge=JSON.parse((await bad.next()).data.toString());
 bad.send(JSON.stringify({type:'authenticate',sessionId:challenge.sessionId,nonce:randomHex(32),proof:'0'.repeat(64)}));assert.equal((await bad.next()).op,8);bad.s.destroy();
 const good=await client(s.p);await authenticate(good,s.token);good.s.destroy();
});
test('authenticated roundtrip, list_changed and duplicate IDs cause at most one forwarded request',async t=>{
 const s=await setup(t);initialize(s);const c=await client(s.p),auth=await authenticate(c,s.token);t.after(()=>c.s.destroy());
 assert.ok(s.messages.some(m=>m.method==='notifications/tools/list_changed'));
 const req={jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'test',arguments:{n:1}}};s.request(req);s.request(req);
 const forwarded=await auth.decode(JSON.parse((await c.next()).data.toString()));assert.equal(forwarded.request.id,3);
 c.send(JSON.stringify(await auth.encode({type:'response',response:{jsonrpc:'2.0',id:3,result:{content:[{type:'text',text:'once'}]}}})));
 assert.equal((await s.response(3)).result.content[0].text,'once');
 s.request(req);await new Promise(r=>setTimeout(r,30));assert.ok(s.messages.some(m=>m.id===3&&m.error?.code===-32600));
 const before=s.messages.length;c.send(JSON.stringify(await auth.encode({type:'tools-changed'})));await new Promise(r=>setTimeout(r,30));assert.equal(s.messages[before].method,'notifications/tools/list_changed');
});
test('masked fragmentation is accepted; unmasked, RSV and invalid UTF-8 frames are closed',async t=>{
 const s=await setup(t);initialize(s);
 const c=await client(s.p),auth=await authenticate(c,s.token);
 const payload=JSON.stringify(await auth.encode({type:'ping'}));c.send(payload.slice(0,10),{fin:false});c.send(payload.slice(10),{op:0});
 assert.equal((await auth.decode(JSON.parse((await c.next()).data.toString()))).type,'pong');c.s.destroy();await new Promise(r=>setTimeout(r,20));
 for(const opts of [{mask:false},{rsv:64}]){const x=await client(s.p);await x.next();x.send('{}',opts);assert.equal((await x.next()).op,8);x.s.destroy();}
 const y=await client(s.p);await y.next();y.send(Buffer.from([0xff]));assert.equal((await y.next()).op,8);y.s.destroy();
});
test('lost response is reported unknown and is not replayed on a replacement connection',async t=>{
 const s=await setup(t);initialize(s);const c=await client(s.p),auth=await authenticate(c,s.token);
 s.request({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'pay',arguments:{}}});await auth.decode(JSON.parse((await c.next()).data.toString()));c.s.destroy();
 const r=await s.response(4);assert.equal(r.result._meta['corsen/effectState'],'unknown');
 const other=await client(s.p);await authenticate(other,s.token);other.s.destroy();
 assert.equal(s.messages.filter(m=>m.id===4).length,1);
});

test('a lost tools/list response is a protocol error, not a tool-call result',async t=>{
 const s=await setup(t);initialize(s);const c=await client(s.p),auth=await authenticate(c,s.token);
 s.request({jsonrpc:'2.0',id:8,method:'tools/list'});await auth.decode(JSON.parse((await c.next()).data.toString()));c.s.destroy();
 const r=await s.response(8);assert.equal(r.error?.code,-32001);assert.equal(Object.hasOwn(r,'result'),false);
});
