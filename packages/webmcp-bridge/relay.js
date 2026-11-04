import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { randomHex, importSecret, proof, verifyProof, channel, plainObject, MAX_MESSAGE } from './protocol.js';
import { acceptWebSocket, upgradeAllowed } from './websocket.js';
const jsonrpc='2.0';
const validId=id=>typeof id==='string'&&id.length<=128||Number.isSafeInteger(id);
export function createRelay({token,extensionId,port=18971,input=process.stdin,output=process.stdout,log=()=>{}}) {
  if(!/^[a-p]{32}$/.test(extensionId??'')||!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid bridge configuration');
  const keyPromise=importSecret(token),sessionId=randomHex(16),peers=new Set(),pending=new Map(),seen=new Map();
  let active=null,initialized=false,negotiated=false,closed=false,buffer=Buffer.alloc(0);
  const write=obj=>{if(closed)return;if(output.writableLength>4*MAX_MESSAGE){void stop();return;}output.write(JSON.stringify(obj)+'\n');};
  const error=(id,code,message)=>write({jsonrpc,id,error:{code,message}});
  const changed=()=>{if(initialized)write({jsonrpc,method:'notifications/tools/list_changed'});};
  const lost=(id,message,method)=>method!=='tools/call'?{jsonrpc,id,error:{code:-32001,message:'Browser connection lost while listing tools; discovery was not replayed.'}}:({jsonrpc,id,result:{isError:true,content:[{type:'text',text:message}],_meta:{'corsen/dispatchState':'unknown','corsen/effectState':'unknown','corsen/replayed':false}}});
  function disconnect(peer) {
    peers.delete(peer);
    if(active!==peer)return;active=null;
    for(const [id,p] of pending){clearTimeout(p.timer);write(lost(p.id,'Bridge disconnected. Effects may be unknown; the request was not replayed.',p.method));pending.delete(id);}
    changed();
  }
  function send(peer,payload) {
    peer.out=peer.out.then(async()=>peer.send(JSON.stringify(await peer.auth.encode(payload)))).catch(()=>peer.close(1008));
  }
  const server=createServer((_req,res)=>{res.writeHead(404,{'connection':'close'});res.end();});
  server.maxConnections=32;server.maxHeadersCount=24;server.headersTimeout=5000;server.requestTimeout=5000;server.keepAliveTimeout=1000;
  server.on('upgrade',(req,socket,head)=>{
    if(closed||active||peers.size>=4||!upgradeAllowed(req,port,extensionId)){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
    const peer=acceptWebSocket(req,socket,head);peers.add(peer);peer.in=Promise.resolve();peer.out=Promise.resolve();
    const nonce=randomHex(32);let stage='challenge';const timer=setTimeout(()=>peer.close(1008),5000);
    peer.on('close',()=>{clearTimeout(timer);disconnect(peer);});
    keyPromise.then(async key=>{if(peers.has(peer))peer.send(JSON.stringify({type:'challenge',v:1,sessionId,nonce,proof:await proof(key,'server',extensionId,sessionId,nonce)}));}).catch(()=>peer.close(1008));
    peer.on('message',text=>{
      peer.in=peer.in.then(async()=>{
        const value=JSON.parse(text),key=await keyPromise;
        if(stage==='challenge'){
          if(!plainObject(value)||value.type!=='authenticate'||value.sessionId!==sessionId||!/^([a-f0-9]{64})$/.test(value.nonce??'')||!await verifyProof(key,value.proof,'client',extensionId,sessionId,nonce,value.nonce)||active||!peers.has(peer))throw Error('Authentication failed');
          clearTimeout(timer);peer.auth=channel(key,'server',extensionId,sessionId,nonce,value.nonce);active=peer;stage='ready';
          peer.send(JSON.stringify({type:'ready',sessionId,proof:await proof(key,'ready',extensionId,sessionId,nonce,value.nonce)}));changed();return;
        }
        const payload=await peer.auth.decode(value);
        if(payload?.type==='ping'){send(peer,{type:'pong'});return;}
        if(payload?.type==='tools-changed'){changed();return;}
        if(payload?.type!=='response'||!plainObject(payload.response)||payload.response.jsonrpc!==jsonrpc)throw Error('Invalid bridge response');
        const response=payload.response,p=pending.get(JSON.stringify(response.id));
        if(!p)return; // late response to a cancelled/timed-out request is discarded, never replayed
        if(Object.hasOwn(response,'result')===Object.hasOwn(response,'error'))throw Error('Invalid response envelope');
        clearTimeout(p.timer);pending.delete(JSON.stringify(response.id));write(response);
      }).catch(()=>peer.close(1008));
    });
  });
  function onRequest(message) {
    if(!plainObject(message)||message.jsonrpc!==jsonrpc||typeof message.method!=='string'||message.params!==undefined&&!plainObject(message.params)){
      error(validId(message?.id)?message.id:null,-32600,'Invalid JSON-RPC request');return;
    }
    if(!Object.hasOwn(message,'id')){
      if(message.method==='notifications/initialized'&&negotiated)initialized=true;
      if(message.method==='notifications/cancelled'&&initialized){
        const key=JSON.stringify(message.params?.requestId),p=pending.get(key);
        if(p){clearTimeout(p.timer);pending.delete(key);if(active)send(active,{type:'cancel',id:p.id});write(lost(p.id,'Request cancelled; any dispatched effect is unknown and will not be replayed.',p.method));}
      }
      return;
    }
    const id=message.id,k=JSON.stringify(id),fingerprint=createHash('sha256').update(JSON.stringify(message)).digest('hex');
    if(!validId(id)){error(null,-32600,'Invalid request id');return;}
    if(seen.has(k)){
      if(seen.get(k)===fingerprint&&pending.has(k))return;
      error(id,-32600,'Request id already used in this stdio session; never replayed');return;
    }
    if(seen.size>=10000){error(id,-32000,'Session request limit reached');return;}seen.set(k,fingerprint);
    if(message.method==='initialize'){
      if(negotiated){error(id,-32600,'Already initialized');return;}
      if(typeof message.params?.protocolVersion!=='string'||!plainObject(message.params?.capabilities)||!plainObject(message.params?.clientInfo)){error(id,-32602,'Invalid initialization');return;}
      negotiated=true;
      write({jsonrpc,id,result:{protocolVersion:['2025-11-25','2025-06-18'].includes(message.params.protocolVersion)?message.params.protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:true}},serverInfo:{name:'webmcp-explorer-bridge',version:'0.1.0'}}});return;
    }
    if(message.method==='ping'){write({jsonrpc,id,result:{}});return;}
    if(!initialized){error(id,-32002,'Initialize and send notifications/initialized first');return;}
    if(!['tools/list','tools/call'].includes(message.method)){error(id,-32601,'Method not supported');return;}
    if(message.method==='tools/list'&&message.params?.cursor!==undefined){error(id,-32602,'No pagination cursor is supported');return;}
    if(message.method==='tools/call'&&(typeof message.params?.name!=='string'||!plainObject(message.params.arguments??{}))){error(id,-32602,'Tool name and object arguments are required');return;}
    if(!active){if(message.method==='tools/list')write({jsonrpc,id,result:{tools:[]}});else error(id,-32001,'No authenticated browser connection');return;}
    if(pending.size>=16){error(id,-32000,'Too many pending requests');return;}
    const peer=active,timer=setTimeout(()=>{
      pending.delete(k);send(peer,{type:'cancel',id});write(lost(id,'Bridge response timed out; effects are unknown and will not be replayed.',message.method));
    },message.method==='tools/call'?95000:15000);
    pending.set(k,{id,timer,method:message.method});send(peer,{type:'request',request:message});
  }
  const data=chunk=>{
    if(closed)return;buffer=Buffer.concat([buffer,Buffer.from(chunk)]);
    let nl;
    while((nl=buffer.indexOf(10))>=0){
      const line=buffer.subarray(0,nl);buffer=buffer.subarray(nl+1);
      if(line.length>MAX_MESSAGE){error(null,-32600,'Input size limit');void stop();return;}
      if(!line.toString().trim())continue;
      try{onRequest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line)));}catch{error(null,-32700,'Invalid JSON');}
    }
    if(buffer.length>MAX_MESSAGE){error(null,-32600,'Input size limit');void stop();}
  };
  input.on('data',data);input.once('end',()=>void stop());input.once('error',()=>void stop());
  output.on('error',()=>void stop());
  async function stop(){if(closed)return;closed=true;for(const p of pending.values())clearTimeout(p.timer);pending.clear();for(const peer of peers)peer.close();input.off('data',data);input.pause();await new Promise(resolve=>server.close(()=>resolve()));}
  return {sessionId,server,stop,start:async()=>{
    await keyPromise;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
    log(`Local MCP bridge listening on 127.0.0.1:${port}. Pairing material is never logged.`);
  }};
}
