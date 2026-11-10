// Explicit Scan Origin only. Conventions, not W3C requirements. No credentials, redirects,
// business tool execution or response body storage. Each distinct URL is requested at most once.
import { finding } from '../core/security/catalog.js';
import { hasOrigin } from '../shared/permissions.js';
import { reviewTrialTokens, splitTokenHeader, MAX_TOKENS, MAX_TOKEN_CHARS } from '../core/origin-trial.js';

export const CONVENTION_PATHS = ['/.well-known/webmcp', '/.well-known/webmcp.json', '/llms.txt'];
const TIMEOUT_MS = 8000;
const MAX_BYTES = 65536;

async function fetchCapped(url, { headersOnly = false } = {}) {
  if (!(await hasOrigin(url))) return { url, status: null, ok: false, error: 'origin-not-granted' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', cache: 'no-store', redirect: 'manual', credentials: 'omit', signal: controller.signal });
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel?.();
      return { url, status: response.status || null, ok: false, error: 'redirect-not-followed' };
    }
    const headers = {};
    const truncatedHeaders = [];
    for (const name of ['content-type', 'permissions-policy', 'origin-agent-cluster', 'content-security-policy', 'access-control-allow-origin', 'access-control-allow-credentials']) {
      const value = response.headers.get(name);
      if (value) {
        headers[name] = value.slice(0, 2048);
        if (value.length > 2048) truncatedHeaders.push(name);
      }
    }
    // Origin-trial tokens sent as a header: a content script cannot see them in the page (L-38).
    // Kept apart from the header list, which is shown and exported: the token text goes no further
    // than the decoder below.
    const originTrialHeader = (response.headers.get('origin-trial') ?? '').slice(0, MAX_TOKENS * (MAX_TOKEN_CHARS + 4)) || null;
    let text = null, size = 0, truncated = false;
    if (!headersOnly && response.ok && response.body?.getReader) {
      const reader = response.body.getReader(), chunks = [];
      try {
        while (size < MAX_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          const part = value.subarray(0, MAX_BYTES - size);
          chunks.push(part); size += part.byteLength;
          if (size >= MAX_BYTES) { truncated = true; break; }
        }
      } finally { try { await reader.cancel(); } catch { /* aborted/closed */ } }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
      text = new TextDecoder().decode(bytes);
    } else {
      try { await response.body?.cancel?.(); } catch { /* nothing to cancel */ }
      if (!headersOnly && response.ok) text = '';
    }
    return { url, status: response.status, ok: response.ok, headers, truncatedHeaders, text, size, truncated, originTrialHeader };
  } catch (error) {
    return { url, status: null, ok: false, error: error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error).slice(0, 200) };
  } finally { clearTimeout(timer); }
}

export async function fetchDiscovery({ pageUrl }) {
  let parsed;
  try { parsed = new URL(pageUrl); } catch { return { error: 'A valid HTTP(S) page is required.' }; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return { error: 'A credential-free HTTP(S) URL is required.' };
  parsed.hash = '';
  const origin = parsed.origin;
  pageUrl = parsed.href;
  if (!(await hasOrigin(pageUrl))) return { error: 'origin-not-granted', code: 'origin-not-granted' };
  const requests = new Map();
  const once = (url, options) => {
    if (!requests.has(url)) requests.set(url, fetchCapped(url, options));
    return requests.get(url);
  };
  const files = await Promise.all(CONVENTION_PATHS.map(path => once(`${origin}${path}`)));
  const page = await once(pageUrl, { headersOnly: true });
  const findings = [];
  const evidence = (path, excerpt) => ({ field: 'convention', path, excerpt });
  const unavailable = (path, result) => findings.push(finding('convention-unavailable', {
    evidence: evidence(path, result.error ?? (result.truncated ? 'body-size-limit' : `HTTP ${result.status}`)),
    detail: { path, status: result.status, error: result.error ?? null, truncated: Boolean(result.truncated), requiredByWebMCP: false } }));
  for (const file of files) {
    const path = new URL(file.url).pathname;
    if (!file.ok || file.truncated) { unavailable(path, file); continue; }
    if (path.startsWith('/.well-known/webmcp')) {
      let manifest;
      try { manifest = JSON.parse(file.text ?? ''); } catch { manifest = null; }
      const valid = manifest && typeof manifest === 'object' && !Array.isArray(manifest);
      const count = valid && Array.isArray(manifest.tools) ? manifest.tools.length : null;
      findings.push(finding(valid ? 'convention-manifest-present' : 'convention-manifest-invalid', {
        evidence: evidence(path, `${file.status} ${file.headers['content-type'] ?? ''} · ${valid ? count === null ? 'JSON object; no tools array' : `${count} tools listed` : 'not a JSON object'}`),
        detail: { path, status: file.status, tools: count, size: file.size, syntaxOnly: true, requiredByWebMCP: false } }));
    } else {
      const lines = String(file.text ?? '').split('\n').filter(l => l.trim()).length;
      findings.push(finding('convention-llms-txt-present', { evidence: evidence(path, `${file.status} · ${lines} non-empty lines`), detail: { path, status: file.status, lines, size: file.size } }));
    }
  }
  if (!page.ok) unavailable('page headers', page);
  else {
    const policy = page.headers['permissions-policy'] ?? null;
    findings.push(finding(policy && /\btools\s*=/.test(policy) ? 'convention-permissions-policy' : 'convention-permissions-policy-absent', {
      evidence: evidence('Permissions-Policy', policy ?? 'no header on this credential-free response'), detail: { header: policy, effectivePolicy: 'not-verified' } }));
    const csp = page.headers['content-security-policy'] ?? null;
    findings.push(finding('convention-csp', { evidence: evidence('Content-Security-Policy', csp ?? 'no header on this credential-free response'),
      detail: { present: Boolean(csp), metaPolicy: 'not-inspected', effectivePolicy: 'not-verified' } }));
  }
  for (const r of [...files, ...(files.includes(page) ? [] : [page])]) {
    if (!r.ok) continue;
    const allowOrigin = r.headers['access-control-allow-origin'] ?? null;
    const credentials = r.headers['access-control-allow-credentials'] ?? null;
    const invalidCredentialsWildcard = allowOrigin === '*' && credentials?.toLowerCase() === 'true';
    findings.push(finding('convention-cors', { severity: invalidCredentialsWildcard ? 'medium' : 'info',
      evidence: evidence(new URL(r.url).pathname, `Access-Control-Allow-Origin: ${allowOrigin ?? 'absent'}; Access-Control-Allow-Credentials: ${credentials ?? 'absent'}`),
      detail: { allowOrigin, credentials, invalidCredentialsWildcard, browserCorsTested: false } }));
  }
  // The page's Origin-Trial header, decoded and checked like the meta tokens: records only.
  const originTrials = page.ok && page.originTrialHeader
    ? await reviewTrialTokens(splitTokenHeader(page.originTrialHeader).map((token) => ({ source: 'header', token })), { pageOrigin: origin })
    : [];
  return { origin, pageUrl, files: files.map(({ text, originTrialHeader, ...rest }) => rest),
    page: { url: page.url, status: page.status, headers: page.headers ?? {}, truncatedHeaders: page.truncatedHeaders ?? [], error: page.error ?? null,
      originTrials: page.ok ? originTrials : null }, findings, at: Date.now() };
}
