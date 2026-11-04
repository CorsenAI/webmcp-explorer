// The bundled demo page.
//
// It exists for one reason: someone who installs Explorer from the Store on a Chrome without
// the WebMCP flag would otherwise meet a screen saying "not available" and a diagnostic table,
// and would uninstall. The demo lets them use the whole product in one click.
//
// It is a page inside the extension, so Explorer already has access to it and asks for no
// permission to inspect it. And it is honest about itself: it supplies its own implementation
// of the API, flagged as a polyfill, so every screen reports that rather than claiming native
// support (D-049).

export function demoUrl() {
  return chrome.runtime.getURL('demo/index.html');
}

export function isDemoPage(url) {
  if (typeof url !== 'string') return false;
  // Compared without the query or the hash, so a reload with a fragment still counts.
  const base = url.split('#')[0].split('?')[0];
  return base === demoUrl();
}

export async function openDemo() {
  const tab = await chrome.tabs.create({ url: demoUrl() });
  return tab;
}

// Chrome hides a tab's URL from the panel without the `tabs` permission, even for the
// extension's own pages, and that permission would put "read your browsing history" on the
// install prompt. The demo page therefore announces itself to the service worker, which is
// the only thing that ever learns its tab id.
export async function isDemoTab(tabId) {
  if (tabId === null || tabId === undefined) return false;
  try {
    const out = await chrome.runtime.sendMessage({ type: 'demo-tabs' });
    return (out?.tabs ?? []).includes(tabId);
  } catch {
    return false;
  }
}
