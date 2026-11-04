// The demo page answers for itself.
//
// Chrome refuses chrome.scripting.executeScript on an extension's own pages — it wants a host
// permission, and a chrome-extension:// URL cannot be one. So the demo page opens a port and
// runs the probe itself, on request.
//
// The important consequence is what does NOT change: the demo runs the same probe function,
// the same registry, the same views. It is the transport that differs, not the code being
// demonstrated, so a demo that works proves the product works.

const ports = new Map();
let nextId = 1;
const pending = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'webmcp-explorer-demo') return;
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined) return;

  ports.set(tabId, port);
  port.onMessage.addListener((msg) => {
    const entry = pending.get(msg?.id);
    if (!entry) return;
    pending.delete(msg.id);
    entry.resolve(msg.payload);
  });
  port.onDisconnect.addListener(() => {
    if (ports.get(tabId) === port) ports.delete(tabId);
  });
});

export function isDemoTabId(tabId) {
  return ports.has(tabId);
}

export function demoTabIds() {
  return [...ports.keys()];
}

// A demo page that stops answering must not hang the panel for ever.
function ask(tabId, request, timeoutMs = 5000) {
  const port = ports.get(tabId);
  if (!port) return Promise.resolve(null);

  const id = nextId += 1;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      resolve(null);
    }, timeoutMs);
    const settle = (value) => { clearTimeout(timer); resolve(value); };
    pending.set(id, { resolve: settle });
    try {
      port.postMessage({ id, ...request });
    } catch {
      pending.delete(id);
      settle(null);
    }
  });
}

// Shaped exactly like one entry of chrome.scripting.executeScript's result, so the caller does
// not need a second code path.
export async function demoProbe(tabId) {
  const result = await ask(tabId, { type: 'probe' });
  if (!result) return null;
  return [{ frameId: 0, documentId: `demo-${tabId}`, result }];
}

export function demoExecute(tabId, toolName, toolOrigin, argsJson, callId = null) {
  return ask(tabId, { type: 'execute', toolName, toolOrigin, argsJson, callId }, 30000);
}

// Aborts a call the demo page is running. Answers { found } like cancelToolInPage does.
export function demoCancel(tabId, callId) {
  return ask(tabId, { type: 'cancel', callId }, 3000);
}
