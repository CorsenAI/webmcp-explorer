#!/usr/bin/env node
import { createRelay } from './relay.js';
let relay;
try {
  relay=createRelay({token:process.env.WEBMCP_BRIDGE_TOKEN,extensionId:process.env.WEBMCP_EXTENSION_ID,
    port:process.env.WEBMCP_BRIDGE_PORT?Number(process.env.WEBMCP_BRIDGE_PORT):18971,
    log:message=>process.stderr.write(message+'\n')});
  await relay.start();
} catch(error) {
  // Never log environment values, request bodies or pairing material.
  process.stderr.write(error?.code==='EADDRINUSE'?'Bridge port is in use; refusing to adopt another relay.\n':'Cannot start bridge. Use the session configuration exported by WebMCP Explorer.\n');
  process.exit(1);
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>relay.stop().then(()=>process.exit(0)));
