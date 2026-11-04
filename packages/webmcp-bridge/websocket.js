// RFC 6455 server framing, no extensions/compression. UTF-8 text only, bounded messages.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { MAX_MESSAGE } from './protocol.js';
export function upgradeAllowed(req,port,extensionId) {
  return req.method==='GET'&&req.url==='/webmcp-bridge'
    &&['127.0.0.1'].includes(req.socket.remoteAddress)
    &&[`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)
    &&req.headers.origin===`chrome-extension://${extensionId}`
    &&req.headers.upgrade?.toLowerCase()==='websocket'
    &&req.headers.connection?.toLowerCase().split(',').map(s=>s.trim()).includes('upgrade')
    &&req.headers['sec-websocket-version']==='13'
    &&/^[A-Za-z0-9+/]{22}==$/.test(req.headers['sec-websocket-key']??'')
    &&Buffer.from(req.headers['sec-websocket-key'],'base64').length===16;
}
function frame(opcode,data) {
  const b=Buffer.from(data),head=Buffer.alloc(b.length<126?2:b.length<65536?4:10);
  head[0]=0x80|opcode;head[1]=b.length<126?b.length:b.length<65536?126:127;
  if(head.length===4)head.writeUInt16BE(b.length,2);if(head.length===10)head.writeBigUInt64BE(BigInt(b.length),2);
  return Buffer.concat([head,b]);
}
export function acceptWebSocket(req,socket,head=Buffer.alloc(0)) {
  const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);const peer=new EventEmitter();let buffer=Buffer.alloc(0),parts=[],partBytes=0,fragmented=false,closed=false;
  let rateAt=Date.now(),frames=0;
  const notify=()=>{if(!closed){closed=true;peer.emit('close');}};
  peer.close=(code=1000)=>{
    if(closed)return;const b=Buffer.alloc(2);b.writeUInt16BE(code);socket.end(frame(8,b));notify();
    const timer=setTimeout(()=>socket.destroy(),250);timer.unref();
  };
  peer.send=value=>{
    if(closed)throw Error('WebSocket closed');const data=Buffer.from(value);
    if(data.length>MAX_MESSAGE||socket.writableLength>2*MAX_MESSAGE){peer.close(1009);throw Error('WebSocket capacity');}
    socket.write(frame(1,data));
  };
  socket.on('close',notify);socket.on('end',()=>{socket.destroy();notify();});socket.on('error',()=>{socket.destroy();notify();});
  function receive(chunk) {
    if(closed)return;
    if(buffer.length+chunk.length>MAX_MESSAGE+65536){peer.close(1009);return;}
    buffer=Buffer.concat([buffer,chunk]);
    while(buffer.length>=2&&!closed) {
      const first=buffer[0],opcode=first&15,fin=!!(first&128);let len=buffer[1]&127,offset=2;
      if((first&112)||!(buffer[1]&128)||![0,1,2,8,9,10].includes(opcode)){peer.close(1002);return;}
      if(len===126){if(buffer.length<4)return;len=buffer.readUInt16BE(2);offset=4;if(len<126){peer.close(1002);return;}}
      else if(len===127){if(buffer.length<10)return;const n=buffer.readBigUInt64BE(2);if(n>BigInt(MAX_MESSAGE)){peer.close(1009);return;}len=Number(n);offset=10;if(len<65536){peer.close(1002);return;}}
      if(opcode>=8&&(!fin||len>125)){peer.close(1002);return;}
      if(len>MAX_MESSAGE){peer.close(1009);return;}if(buffer.length<offset+4+len)return;
      if(Date.now()-rateAt>1000){rateAt=Date.now();frames=0;}if(++frames>200){peer.close(1008);return;}
      const mask=buffer.subarray(offset,offset+4),data=Buffer.from(buffer.subarray(offset+4,offset+4+len));
      buffer=buffer.subarray(offset+4+len);for(let i=0;i<len;i++)data[i]^=mask[i%4];
      if(opcode===8){
        if(len===1){peer.close(1002);return;}
        if(len>=2){const code=data.readUInt16BE();if(!([1000,1001,1002,1003,1007,1008,1009,1010,1011,1012,1013,1014].includes(code)||code>=3000&&code<=4999)){peer.close(1002);return;}}
        try {new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(2));}catch{peer.close(1007);return;}
        peer.close();return;
      }
      if(opcode===9){socket.write(frame(10,data));continue;}if(opcode===10)continue;
      if(opcode===2){peer.close(1003);return;}
      if(opcode===0&&!fragmented||opcode===1&&fragmented){peer.close(1002);return;}
      partBytes+=len;if(partBytes>MAX_MESSAGE){peer.close(1009);return;}parts.push(data);
      if(!fin){fragmented=true;continue;}
      try {
        const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));parts=[];partBytes=0;fragmented=false;peer.emit('message',text);
      }catch{peer.close(1007);return;}
    }
  }
  socket.on('data',receive);if(head.length)queueMicrotask(()=>receive(head));return peer;
}
