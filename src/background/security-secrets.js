// WMCP-SEC-013 on request, on a site the person declared they control: the top document's inline
// scripts and its same-origin script files are read once, in memory, and searched for provider key
// formats. Only the provider, key type, count and length leave findSecrets; the text and any value
// are dropped when this function returns. Nothing is stored, no tool is called, no cookie is sent,
// and scripts from other origins are not fetched.

import { reviewSecrets, MAX_SECRET_SCAN_CHARS } from '../core/security/secrets.js';
import { withRule } from '../core/security/rules.js';
import { isControlled } from '../storage/security.js';
import { hasOrigin } from '../shared/permissions.js';

export const MAX_INLINE_SCRIPTS = 200;
export const MAX_SCRIPT_FILES = 20;
const TIMEOUT_MS = 8000;

// Runs in the page's isolated world: script text and same-origin script URLs, nothing else.
function pageScripts(maxChars, maxInline, maxFiles) {
  const inline = [], files = [], other = [];
  document.querySelectorAll('script').forEach((s, index) => {
    if (s.src) {
      try {
        const u = new URL(s.src, location.href);
        (u.origin === location.origin ? files : other).push(u.origin === location.origin ? u.href : u.origin);
      } catch { /* an unparsable src is not a script we can read */ }
    } else if (s.textContent) inline.push({ index, text: s.textContent.slice(0, maxChars) });
  });
  return { url: location.href, inline: inline.slice(0, maxInline), files: [...new Set(files)].slice(0, maxFiles), otherOrigins: [...new Set(other)].length };
}

async function readScript(url) {
  if (!(await hasOrigin(url))) return { error: 'origin-not-granted' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', cache: 'no-store', redirect: 'manual', credentials: 'omit', signal: controller.signal });
    if (!response.ok) { try { await response.body?.cancel?.(); } catch { /* closed */ } return { error: `http-${response.status || 'redirect'}` }; }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let text = '';
    try {
      while (text.length < MAX_SECRET_SCAN_CHARS) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    } finally { try { await reader.cancel(); } catch { /* closed */ } }
    return { text: text.slice(0, MAX_SECRET_SCAN_CHARS) };
  } catch (error) {
    return { error: error?.name === 'AbortError' ? 'timeout' : 'unreadable' };
  } finally { clearTimeout(timer); }
}

export async function scanSecrets({ tabId, topOrigin }) {
  if (!Number.isInteger(tabId) || !topOrigin) return { error: 'A tab and its origin are required.' };
  if (!(await isControlled(topOrigin))) return { error: 'consent-required', code: 'consent-required' };
  if (!(await hasOrigin(topOrigin))) return { error: 'origin-not-granted', code: 'origin-not-granted' };
  let page;
  try {
    [{ result: page } = {}] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: pageScripts,
      args: [MAX_SECRET_SCAN_CHARS, MAX_INLINE_SCRIPTS, MAX_SCRIPT_FILES] });
  } catch (error) {
    return { error: String(error?.message ?? error).slice(0, 200), code: 'unreadable' };
  }
  if (!page?.url || new URL(page.url).origin !== topOrigin) return { error: 'The page changed origin.', code: 'origin-changed' };
  const sources = page.inline.map((s) => ({ kind: 'inline-script', label: `inline script #${s.index + 1}`, text: s.text }));
  let skipped = 0;
  for (const url of page.files) {
    const out = await readScript(url);
    if (out.error) { skipped += 1; continue; }
    const u = new URL(url);
    sources.push({ kind: 'script', label: u.pathname, text: out.text });
  }
  // Mapped to WMCP-SEC-013 here so the card shows its rule; the review's mapping is idempotent.
  const findings = reviewSecrets(sources).map(withRule);
  return { findings, scanned: { inline: page.inline.length, files: page.files.length - skipped, skipped, otherOrigins: page.otherOrigins } };
}
