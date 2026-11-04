// Chrome's own permission grant is the only source of truth. Explorer never keeps its own
// notion of "allowed sites" (D-014).
//
// chrome.permissions.request must be called from a user gesture, so it runs in the side
// panel, never in the service worker.

export function originPattern(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return `${parsed.protocol}//${parsed.host}/*`;
}

export async function hasOrigin(url) {
  const pattern = originPattern(url);
  if (!pattern) return false;
  return chrome.permissions.contains({ origins: [pattern] });
}

export async function requestOrigin(url) {
  const pattern = originPattern(url);
  if (!pattern) return false;
  return chrome.permissions.request({ origins: [pattern] });
}

export async function requestOrigins(urls) {
  const origins = urls.map(originPattern).filter(Boolean);
  if (origins.length === 0) return false;
  return chrome.permissions.request({ origins });
}

export async function requestAllSites() {
  return chrome.permissions.request({ origins: ['https://*/*', 'http://*/*'] });
}

export async function removeOrigins(origins) {
  const result = await chrome.runtime.sendMessage({ type: 'permissions-remove', origins });
  if (result?.error) throw new Error(result.error);
  return result?.removed === true;
}
