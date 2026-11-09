// The demo page's side of the bridge.
//
// It imports the very same probe and execute functions the extension injects into real pages,
// so what the demo demonstrates is the product's own code and not a stand-in written to make
// the demo look good.

import { probeMainWorld } from '../page/probe.js';
import { CALLBACK_PATTERNS, TRACE_PATTERN } from '../core/security/callback-source.js';
import { executeToolInPage, cancelToolInPage } from '../page/execute.js';

let port = null;
let reconnectTimer = null;

function connectBridge() {
  if (port || !chrome.runtime?.id) return;
  try {
    const connected = chrome.runtime.connect({ name: 'webmcp-explorer-demo' });
    port = connected;
    connected.onMessage.addListener(msg => answer(connected, msg));
    connected.onDisconnect.addListener(() => {
      // Read lastError in the callback where Chrome exposes it. A worker suspension is
      // normal; an extension reload instead invalidates this page's runtime context.
      void chrome.runtime.lastError;
      if (port !== connected) return;
      port = null;
      if (!document.hidden && chrome.runtime?.id) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectBridge, 200);
      }
    });
  } catch {
    // Removed/reloaded extension: this document must be reloaded too. Do not spin retries.
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) connectBridge();
});
connectBridge();

async function answer(connected, msg) {
  if (!msg || typeof msg.id !== 'number') return;

  try {
    if (msg.type === 'probe') {
      const payload = await probeMainWorld(null, [...CALLBACK_PATTERNS, TRACE_PATTERN].map(({ label, source, flags }) => ({ label, source, flags })));
      connected.postMessage({ id: msg.id, payload });
      return;
    }
    if (msg.type === 'execute') {
      const payload = await executeToolInPage(msg.toolName, msg.toolOrigin, msg.argsJson,
        msg.callId ?? null);
      connected.postMessage({ id: msg.id, payload });
      return;
    }
    if (msg.type === 'cancel') {
      connected.postMessage({ id: msg.id, payload: cancelToolInPage(msg.callId) });
      return;
    }
    connected.postMessage({ id: msg.id, payload: null });
  } catch (error) {
    // The panel must see a failure, not a silence it cannot explain.
    try {
      connected.postMessage({
        id: msg.id,
        payload: { ok: false, code: 'demo-bridge-failed', error: String(error?.message ?? error) },
      });
    } catch { /* A disconnected caller is handled by the worker's bounded timeout. */ }
  }
}
