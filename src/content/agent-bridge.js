// The third-party agent bridge (F11/D-114). Runs as a content script in the ISOLATED world of
// an origin the user switched on in Settings; it is registered at runtime, never declared in
// the manifest, so installing Explorer asks for nothing.
//
// Why a bridge: on the Chrome line this shipped on (measured 2026-09-16, Chrome 153, headless
// and headful), a page's own scripts can no longer reach an extension over
// externally_connectable — the connection never arrives. The isolated world still reaches the
// worker, so this file is the translator between the two, and it is deliberately dumb:
//
//  - it relays a request from the page to the worker and the answer back, by message id;
//  - it validates nothing — every gate (origin, user grant, schema) runs in the worker, the
//    only place with an authority to enforce them;
//  - it speaks only to its own frame, and the worker re-checks the sender on every message;
//  - a revoked origin is refused by the worker on the NEXT message: the bridge holds no
//    session, no token and no memory of an accepted request.
//
// Page content is never interpreted here: the relay is a string through a pipe, and the tool
// answers are data, exactly as the panel renders them.
(() => {
  const BRIDGE = 'wmp-explorer/1';
  // Only the agent page on its own document asks; anything else is noise relayed nowhere.
  const pending = new Set();
  // Present so the page can tell "no bridge" from "bridge refusing this ask" — a difference
  // the user and the tests both need to see. Not a capability: the worker still gates
  // everything, and a page can spoof this flag about itself all it likes.
  window.__wmpAgentBridge = BRIDGE;

  window.addEventListener('message', (event) => {
    // A page->bridge message must come from this window itself, carry our envelope, and be
    // addressed to no one else. Everything else is dropped without replying.
    if (event.source !== window || event.data?.api !== BRIDGE) return;
    const { id, payload } = event.data;
    if (typeof id !== 'string' || !id || id.length > 200 || !payload || typeof payload !== 'object') return;
    if (pending.has(id)) return; // replay of an id already in flight: refuse, never answer twice
    if (pending.size >= 16) return; // one agent on a page does not get 17 asks in flight

    pending.add(id);
    chrome.runtime.sendMessage({ ...payload, api: BRIDGE, ...(payload.command === 'execute-tool' ? { requestId: id } : {}) }, (reply) => {
      pending.delete(id);
      // chrome.runtime.lastError is read here or Chrome logs an unhandled rejection.
      const answer = chrome.runtime.lastError
        ? { api: BRIDGE, kind: 'error', error: 'Explorer is not reachable from this page.' }
        : reply;
      event.source.postMessage({ api: BRIDGE, id, reply: answer ?? { api: BRIDGE, kind: 'error', error: 'No answer.' } }, event.origin);
    });
  });
})();
