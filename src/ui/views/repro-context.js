// The facts about where a call ran that a reproduction needs and only the panel knows: the
// page, the frame the tool lives in, the browser, Explorer's version. Pure DOM-side glue.

export function reproContext({ tool, url = null, topOrigin = null }) {
  // The registry gives each owned tool its frame's full URL and index path (core/registry.js);
  // a tool nobody claimed has neither, and the report says so.
  const top = tool.frameKey === 'top' || tool.frameId === 0;
  return {
    page: { url: url ?? topOrigin ?? tool.origin ?? null, topOrigin: topOrigin ?? null },
    frame: { origin: tool.origin ?? null, url: tool.frameUrl ?? null, indexPath: tool.frameIndexPath ?? null, isTopLevel: top },
    browser: { userAgent: navigator.userAgent, product: null },
    extensionVersion: chrome.runtime.getManifest().version,
  };
}
