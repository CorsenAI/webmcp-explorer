// Chrome origin-trial tokens: what a token says, whether Chrome would honour it on a page, and
// whether Chrome's key signed it. Format and rules read on 2026-11-09 in Chromium
// (third_party/blink/common/origin_trials/trial_token.cc and trial_token_validator.cc,
// components/embedder_support/origin_trials/origin_trial_policy_impl.cc):
//   base64( version[1] | Ed25519 signature[64] | payload length[4, big-endian] | JSON payload )
// The signature covers version + length + payload. A first-party token is honoured on its own
// origin, or on its subdomains when isSubdomain is set (same scheme and port); a third-party token
// is matched against the origins of the scripts on the stack when a script adds its meta element
// (core/loader/http_equiv.cc), so one delivered in a response header or written in the served
// markup has no script origin and is refused; an expired token is ignored ("Chrome ignores invalid
// or expired tokens", developer.chrome.com/docs/web-platform/origin-trials). Each token is validated
// on its own and a trial keeps the latest expiry among its valid tokens
// (core/origin_trials/origin_trial_context.cc).
// Imperative and declarative WebMCP share one trial, named "WebMCP" (runtime_enabled_features.json5).
// Pure JavaScript: no chrome.* API, so it runs unchanged in Node and in the extension.

export const WEBMCP_TRIAL = 'WebMCP';
export const MAX_TOKEN_CHARS = 6144;
export const MAX_PAYLOAD_BYTES = 4096;
export const MAX_TOKENS = 20;
// Chrome's origin-trial public key (Ed25519, 32 bytes), as hexadecimal.
export const CHROME_TRIAL_PUBLIC_KEY = '7cc4b89a93ba6ee2d0fd031dfb3266c73b72fd543a07511466aa02534e33a115';

const HEADER_BYTES = 69; // version + signature + payload length
const DEFAULT_PORT = { 'https:': '443', 'http:': '80', 'wss:': '443', 'ws:': '80' };
const fail = (reason) => ({ ok: false, reason });

function bytesOf(text) {
  const clean = String(text ?? '').trim();
  if (!clean || clean.length > MAX_TOKEN_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  try { return Uint8Array.from(atob(clean), (c) => c.charCodeAt(0)); } catch { return null; }
}

export function decodeTrialToken(text) {
  const bytes = bytesOf(text);
  if (!bytes) return fail('not-base64');
  if (bytes.length < HEADER_BYTES) return fail('too-short');
  const version = bytes[0];
  if (version !== 2 && version !== 3) return fail('unknown-version');
  const length = new DataView(bytes.buffer, bytes.byteOffset + 65, 4).getUint32(0);
  if (length !== bytes.length - HEADER_BYTES || length > MAX_PAYLOAD_BYTES) return fail('bad-length');
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(HEADER_BYTES))); } catch { return fail('bad-payload'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('bad-payload');
  let origin;
  try { origin = new URL(String(typeof data.origin === 'string' ? data.origin : '')); } catch { return fail('bad-origin'); }
  if (origin.origin === 'null') return fail('bad-origin');
  if (data.isSubdomain !== undefined && typeof data.isSubdomain !== 'boolean') return fail('bad-payload');
  if (typeof data.feature !== 'string' || !data.feature) return fail('bad-feature');
  if (!Number.isInteger(data.expiry) || data.expiry <= 0 || data.expiry > 0x7fffffff) return fail('bad-expiry');
  let isThirdParty = false, usage = null;
  if (version === 3) {
    if (data.isThirdParty !== undefined && typeof data.isThirdParty !== 'boolean') return fail('bad-payload');
    isThirdParty = data.isThirdParty === true;
    if (data.usage !== undefined && data.usage !== '' && data.usage !== 'subset') return fail('bad-payload');
    usage = data.usage === 'subset' ? 'subset' : null;
  }
  const signed = new Uint8Array(1 + bytes.length - 65);
  signed[0] = version;
  signed.set(bytes.subarray(65), 1);
  return { ok: true, version, feature: data.feature, origin: origin.origin, isSubdomain: data.isSubdomain === true, isThirdParty, usage,
    expiry: data.expiry, signature: bytes.slice(1, 65), signed };
}

// TrialToken::ValidateOrigin: the same origin, or with isSubdomain the same scheme and port and a
// host that is the token's host or one of its subdomains.
export function matchesTokenOrigin(token, pageOrigin) {
  let page, own;
  try { page = new URL(pageOrigin); own = new URL(token.origin); } catch { return false; }
  if (!token.isSubdomain) return page.origin === own.origin;
  const port = (u) => u.port || DEFAULT_PORT[u.protocol] || '';
  const host = page.hostname.toLowerCase().replace(/\.$/, ''), base = own.hostname.toLowerCase().replace(/\.$/, '');
  return page.protocol === own.protocol && port(page) === port(own) && (host === base || host.endsWith(`.${base}`));
}

function secureOrigin(origin) {
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' || u.protocol === 'wss:' || u.hostname === 'localhost' || u.hostname.endsWith('.localhost')
      || /^127(?:\.\d{1,3}){3}$/.test(u.hostname) || u.hostname === '[::1]';
  } catch { return false; }
}

// What Chrome would do with a decoded token on a page of this origin, in Chrome's own order:
// origin first, then expiry, then the secure-context requirement (which also applies to the page
// for a third-party token). A third-party token is matched against the injecting script's origin,
// which a document alone does not show: it is reported as third-party, expired or insecure.
// staticOnly: every copy of the token came in a response header or in the served markup; no script
// added it, so a third-party token has nothing to be matched against ('not-injected').
export function assessTrialToken(token, { pageOrigin, now = Date.now(), staticOnly = false } = {}) {
  const expiresMs = token.expiry * 1000;
  const expired = expiresMs <= now;
  const secure = secureOrigin(pageOrigin);
  let status;
  if (token.isThirdParty) status = staticOnly ? 'not-injected' : expired ? 'expired' : (secure ? 'third-party' : 'insecure-origin');
  else if (!matchesTokenOrigin(token, pageOrigin)) status = 'wrong-origin';
  else if (expired) status = 'expired';
  else if (!secure) status = 'insecure-origin';
  else status = 'valid';
  return { status, expiresAt: new Date(expiresMs).toISOString(), daysLeft: Math.floor((expiresMs - now) / 86_400_000) };
}

const hexBytes = (hex) => Uint8Array.from(String(hex).match(/../g) ?? [], (h) => parseInt(h, 16));

// 'valid' when one of the keys signed the token, 'invalid' when none did (another browser's trial,
// or a forged token), 'not-checked' when this runtime has no Ed25519 (Chrome before 137).
export async function verifyTrialToken(token, { publicKeys = [CHROME_TRIAL_PUBLIC_KEY], subtle = globalThis.crypto?.subtle } = {}) {
  if (!token?.ok) return 'invalid';
  if (!subtle) return 'not-checked';
  try {
    for (const hex of publicKeys) {
      const key = await subtle.importKey('raw', hexBytes(hex), { name: 'Ed25519' }, false, ['verify']);
      if (await subtle.verify('Ed25519', key, token.signature, token.signed)) return 'valid';
    }
    return 'invalid';
  } catch { return 'not-checked'; }
}

// An Origin-Trial header carries one token or a comma-separated list, each optionally quoted.
export function splitTokenHeader(value) {
  return String(value ?? '').split(/[,\n]/).map((part) => part.trim().replace(/^["']|["']$/g, '').trim()).filter(Boolean).slice(0, MAX_TOKENS);
}

// entries: [{ source, token }]. source says how a copy of the token reached the page: 'header'
// (response header), 'markup' (a meta element in the HTML as served), 'script' (a meta element
// added after parsing) or 'meta' (a meta element whose provenance is not known, which is all an
// extension sees). One plain record per distinct token, never the token text: sources joined by
// "+", feature, origin, flags, expiry, status and signature result.
const SOURCES = ['header', 'markup', 'script', 'meta'];
export async function reviewTrialTokens(entries = [], { pageOrigin, now = Date.now(), publicKeys, subtle } = {}) {
  const seen = new Map();
  for (const entry of entries) {
    const text = String(entry?.token ?? '').trim();
    if (!text) continue;
    const source = SOURCES.includes(entry.source) ? entry.source : 'meta';
    if (seen.has(text)) { if (!seen.get(text).includes(source)) seen.get(text).push(source); continue; }
    if (seen.size < MAX_TOKENS) seen.set(text, [source]);
  }
  const out = [];
  for (const [text, sources] of seen) {
    const source = sources.join('+');
    const token = decodeTrialToken(text);
    if (!token.ok) { out.push({ source, status: 'malformed', reason: token.reason, feature: null, webmcp: false, signature: 'invalid' }); continue; }
    const staticOnly = sources.every((s) => s === 'header' || s === 'markup');
    out.push({
      source, feature: token.feature.slice(0, 100), webmcp: token.feature === WEBMCP_TRIAL, origin: token.origin,
      isSubdomain: token.isSubdomain, isThirdParty: token.isThirdParty, usage: token.usage,
      ...assessTrialToken(token, { pageOrigin, now, staticOnly }),
      signature: await verifyTrialToken(token, { ...(publicKeys ? { publicKeys } : {}), ...(subtle !== undefined ? { subtle } : {}) }),
    });
  }
  return out;
}

// The WebMCP token that matters on a page. Chrome enables the trial as long as one token is
// honoured and keeps the latest expiry, so among honoured tokens the one that lasts longest counts:
// a first-party token before a third-party one, which only covers the script that adds it. When
// none is honoured, the token closest to working says why: one Chrome signed before one it did not,
// then expired, insecure page, another origin, third-party not added by a script. Ties keep the
// first token in page order.
const NEAREST = { expired: 0, 'insecure-origin': 1, 'wrong-origin': 2, 'not-injected': 3 };
export function webmcpTrialOf(tokens = []) {
  const own = tokens.filter((t) => t.webmcp);
  const honoured = own.filter((t) => (t.status === 'valid' || t.status === 'third-party') && t.signature !== 'invalid');
  const latest = (list) => list.reduce((best, t) => (best && Date.parse(best.expiresAt) >= Date.parse(t.expiresAt) ? best : t), null);
  const active = latest(honoured.filter((t) => t.status === 'valid')) ?? latest(honoured);
  const rank = (t) => (t.signature === 'invalid' ? 10 : 0) + (NEAREST[t.status] ?? 5);
  const nearest = own.reduce((best, t) => (best && rank(best) <= rank(t) ? best : t), null);
  return { present: own.length > 0, active: Boolean(active), token: active ?? nearest, count: own.length };
}
