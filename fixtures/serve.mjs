import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname, normalize, sep, resolve } from 'node:path';
import { isMockPath, handleMock } from './mock-llm.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// The fixtures must exercise the very code the extension injects, never a copy, so /src is
// mounted from the project root alongside the fixtures themselves.
const PROJECT = resolve(ROOT, '..');

// Anything under /csp/ is the same fixture file served with a strict Content-Security-Policy,
// so a page can be tested with and without the policy without duplicating it (F5).
const STRICT_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; "
  + "object-src 'none'; base-uri 'none'; frame-ancestors 'self'";

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  let path = decodeURIComponent(url.pathname);

  // A fake OpenAI-compatible endpoint, so the agent loop is testable without a key.
  if (isMockPath(path)) return handleMock(req, res, url);

  const strict = path === '/csp' || path.startsWith('/csp/');
  if (strict) path = path.slice('/csp'.length) || '/';

  // Anything under /oac0/ is the same fixture served with `Origin-Agent-Cluster: ?0`, so the
  // platform probe can measure whether WebMCP still appears on a document that opted out of
  // origin-keyed agent clustering. The specification dropped that requirement on 2026-09-30
  // (webmachinelearning/webmcp#330); Chrome's documentation still listed it in September.
  const oac0 = path === '/oac0' || path.startsWith('/oac0/');
  if (oac0) path = path.slice('/oac0'.length) || '/';

  // Anything under /policy/ is the same fixture served with a Permissions-Policy header that
  // names the tools feature, so the discovery-convention check (S4) has a header to read.
  const policy = path === '/policy' || path.startsWith('/policy/');
  if (policy) path = path.slice('/policy'.length) || '/';

  const underSrc = path === '/src' || path.startsWith('/src/');
  const base = underSrc ? PROJECT : ROOT;
  const file = join(base, normalize(path === '/' ? '/index.html' : path));
  if (!file.startsWith(base + sep) && file !== base) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    const headers = {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    };
    if (strict) headers['content-security-policy'] = STRICT_CSP;
    if (oac0) headers['origin-agent-cluster'] = '?0';
    if (policy) headers['permissions-policy'] = 'tools=(self)';
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

for (const port of [8777, 8788]) {
  createServer(handler).listen(port, () => console.log(`listening http://localhost:${port}/`));
}
console.log('cross-origin pair: http://localhost:8777 and http://127.0.0.1:8788');
