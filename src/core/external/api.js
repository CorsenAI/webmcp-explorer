// The external agent API (F11/D-114): the one surface a third-party agent may use, and the
// only place its shape is decided.
//
// Rules this file encodes:
//  - Nothing is exposed by default. The worker refuses every request until the user turns
//    "Agent access" on for the requesting origin (src/storage/external-access.js), and the
//    bridge is never even present until the user also granted that site's host permission.
//  - The message schema is validated here, field by field, before any handler sees it. A
//    request that carries an unexpected field is refused, not ignored: a silent default is
//    how a widened surface hides.
//  - The answer carries only what discovery already shows the user in the panel. WebMCP page
//    content is untrusted input: like every other view, external traffic never turns page
//    text into instructions (anti prompt-injection rule), and this API does not execute page
//    content either — it lists and calls the page's own declared tools.
//  - Versioned protocol: `api` must match. When the shape changes, an old agent gets a clear
//    refusal instead of a half-understood request.
//
// Why a content-script bridge and not externally_connectable: measured 2026-09-16 on Chrome
// 153 (headless and headful, with a minimal control extension), a page's own scripts no
// longer reach an extension through externally_connectable — the message never arrives, while
// the same request from the content-script world answers correctly. The bridge
// (src/content/agent-bridge.js) relays; the worker decides; the page never learns anything
// the user has not switched on.

export const EXTERNAL_API = 'wmp-explorer/1';

// The sites the bridge can be turned on for. Exact origins only — no wildcards, no
// subdomains. This constant is the single source of truth: the Settings screen, the host
// permission request, the bridge registration and the worker's gate all read it, so they can
// never disagree. A test build rewrites exactly this line to point at the fixture origin
// (tools/build-test-extension.mjs); the production bundle ships what you see here.
export const AGENT_ORIGINS = ['https://corsen.ai', 'https://www.corsen.ai'];

// Match patterns for the host permission and the bridge registration, derived from the list so
// the two can never disagree. An origin that already spells a pattern (a test build may add
// `http://localhost:8777/*`) passes through — appending `/*` again would make a broken pattern.
export function agentPatterns(origins = AGENT_ORIGINS) {
  return origins.map((o) => (o.endsWith('/*') ? o : `${o}/*`));
}

export function isAllowedAgentOrigin(url, origins = AGENT_ORIGINS) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ''));
  } catch {
    return false;
  }
  // The match is host+scheme, port aside: registerContentScripts matches the exact host and
  // Chrome ignores ports in permission patterns, so a stricter rule here would only refuse a
  // page Chrome itself let the bridge into. The scheme is not negotiable: https (or the
  // fixture origin in a test build) and nothing else.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return origins.some((allowed) => {
    try {
      const base = new URL(allowed);
      return base.protocol === parsed.protocol && base.hostname === parsed.hostname;
    } catch {
      return false;
    }
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedString(value, max = 4000) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

// Validates one external request. Returns { ok, request } or { ok: false, error } — the error
// is safe to send back: it names fields, never internals.
export function validateExternalRequest(msg) {
  if (!isPlainObject(msg)) return { ok: false, error: 'A request must be an object.' };
  if (msg.api !== EXTERNAL_API) {
    return { ok: false, error: `This build speaks ${EXTERNAL_API}; the request asked for something else.` };
  }
  if (typeof msg.command !== 'string') return { ok: false, error: 'A request needs a "command" string.' };

  const extraKeys = (allowed) =>
    Object.keys(msg).filter((k) => !['api', 'command', ...allowed].includes(k));

  switch (msg.command) {
    case 'ping': {
      if (extraKeys([]).length) return { ok: false, error: 'ping carries no other fields.' };
      return { ok: true, request: { command: 'ping' } };
    }
    case 'list-tools': {
      if (extraKeys([]).length) return { ok: false, error: 'list-tools carries no other fields.' };
      return { ok: true, request: { command: 'list-tools' } };
    }
    case 'execute-tool': {
      const bad = extraKeys(['tool', 'args', 'requestId']);
      if (bad.length) return { ok: false, error: `execute-tool does not accept: ${bad.join(', ')}.` };
      if (!isBoundedString(msg.tool, 200)) {
        return { ok: false, error: 'execute-tool needs a "tool" name (string, 200 characters at most).' };
      }
      if (!isPlainObject(msg.args)) {
        return { ok: false, error: 'execute-tool needs "args" as a JSON object.' };
      }
      // Keys are bounded, values are not rewritten: arguments are passed to the page's own
      // declared tool, which validates them the way it validates the panel's.
      if (Object.keys(msg.args).length > 50) {
        return { ok: false, error: 'execute-tool accepts at most 50 arguments.' };
      }
      if (msg.requestId !== undefined && !isBoundedString(msg.requestId,200)) return {ok:false,error:'Invalid request id.'};
      return { ok: true, request: { command: 'execute-tool', tool: msg.tool, args: msg.args, ...(msg.requestId ? {requestId:msg.requestId}: {}) } };
    }
    default:
      return { ok: false, error: `Unknown command: ${String(msg.command).slice(0, 60)}` };
  }
}

// The answers, fixed shape, so an agent can parse them without guessing.
export function externalReply(kind, fields = {}) {
  return { api: EXTERNAL_API, kind, ...fields };
}
