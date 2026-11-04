import { bridgeUrl } from '../../core/bridge/policy.js';
import { importSecret, proof, verifyProof, randomHex, channel, MAX_MESSAGE } from '../../core/bridge/protocol.js';
// Reconnect only the authenticated transport. Requests and tab bindings are never resumed.
export function createBridgeConnection({extensionId,onReady=()=>{},onMessage=()=>{},onClose=()=>{},onState=()=>{}}) {
  let socket=null,config=null,retry=null,heartbeat=null,handshake=null,attempt=0,generation=0,lastPong=0;
  let auth=null,sessionId=null,outgoing=Promise.resolve(),incoming=Promise.resolve();
  const state=value=>onState(value);
  function stop() {
    config=null;generation++;clearTimeout(retry);clearTimeout(handshake);clearInterval(heartbeat);retry=null;
    const old=socket;socket=null;auth=null;sessionId=null;if(old)old.close();state('disabled');onClose('disconnected');
  }
  function send(payload) {
    const current=socket,gen=generation;
    if(!auth||current?.readyState!==WebSocket.OPEN)return Promise.reject(Error('Bridge not authenticated'));
    const encoder=auth;
    const sent=outgoing.then(async()=>{
      const packet=await encoder.encode(payload);
      if(gen!==generation||socket!==current||current.readyState!==WebSocket.OPEN)throw Error('Connection changed');
      if(current.bufferedAmount>2*MAX_MESSAGE)throw Error('Bridge backpressure limit');
      current.send(JSON.stringify(packet));
    });outgoing=sent.catch(()=>{if(current===socket)current.close();});return sent;
  }
  async function dial() {
    if(!config||socket)return;clearTimeout(retry);retry=null;
    const gen=++generation,key=await importSecret(config.token);if(gen!==generation||!config)return;
    const ws=new WebSocket(bridgeUrl(config.port));socket=ws;auth=null;outgoing=Promise.resolve();incoming=Promise.resolve();
    let nonce=null,clientNonce=null;state('connecting');
    handshake=setTimeout(()=>ws.close(),5000);
    ws.onmessage=event=>{
      incoming=incoming.then(async()=>{
        if(socket!==ws||gen!==generation)return;
        if(typeof event.data!=='string'||new TextEncoder().encode(event.data).length>MAX_MESSAGE)throw Error('Message limit');
        const m=JSON.parse(event.data);
        if(!nonce){
          if(m.type!=='challenge'||m.v!==1||!/^[a-f0-9]{32}$/.test(m.sessionId??'')||!/^[a-f0-9]{64}$/.test(m.nonce??'')
            ||!await verifyProof(key,m.proof,'server',extensionId,m.sessionId,m.nonce,''))throw Error('Server proof rejected');
          if(socket!==ws||gen!==generation)return;
          sessionId=m.sessionId;nonce=m.nonce;clientNonce=randomHex(32);
          ws.send(JSON.stringify({type:'authenticate',sessionId,nonce:clientNonce,proof:await proof(key,'client',extensionId,sessionId,nonce,clientNonce)}));return;
        }
        if(!auth){
          if(m.type!=='ready'||m.sessionId!==sessionId||!await verifyProof(key,m.proof,'ready',extensionId,sessionId,nonce,clientNonce))throw Error('Ready proof rejected');
          if(socket!==ws||gen!==generation)return;
          auth=channel(key,'client',extensionId,sessionId,nonce,clientNonce);clearTimeout(handshake);attempt=0;lastPong=Date.now();state('connected');
          heartbeat=setInterval(()=>{if(Date.now()-lastPong>45000){ws.close();return;}void send({type:'ping'}).catch(()=>{});},20000);
          onReady(sessionId);return;
        }
        const payload=await auth.decode(m);if(socket!==ws||gen!==generation)return;
        if(payload?.type==='pong'){lastPong=Date.now();return;}
        onMessage(payload,sessionId);
      }).catch(()=>{if(socket===ws&&gen===generation){state('authentication-failed');ws.close();}});
    };
    ws.onerror=()=>{};
    ws.onclose=()=>{
      if(socket!==ws)return;socket=null;auth=null;sessionId=null;generation++;clearTimeout(handshake);clearInterval(heartbeat);onClose('connection-lost');
      if(config){state('reconnecting');retry=setTimeout(()=>void dial().catch(()=>state('error')),Math.min(30000,1000*2**Math.min(attempt++,5)));}
    };
  }
  return {send,stop,epoch:()=>generation,session:()=>sessionId,connected:()=>!!auth,
    async start(next){stop();config=next;await dial();},
    async wake(){if(config&&!socket)await dial();},
  };
}
