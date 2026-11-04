// Watches a tab for the two events that make an in-flight tool call unanswerable: the tab
// navigating to a new document, and the tab closing.
//
// Measured on Chrome 152 (e2e/inflight.mjs, C5): when the page navigates away while a tool
// injected by chrome.scripting.executeScript is still running, the injection promise is
// never settled — neither resolved nor rejected. Without this watch the call would stay
// "Running…" forever. A removed iframe, by contrast, does settle (no result), so this only
// needs to cover the tab itself.

const GRACE_MS = 300;

// Resolves with 'navigated' or 'removed'. The navigation case waits a moment first: a tool
// that answers and then navigates has its answer on the way, and the injection must be given
// the chance to win the race.
export function untilTabGone(tabId, tabs = chrome.tabs, grace = GRACE_MS) {
  let settle = () => {};
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  const onUpdated = (id, change) => {
    if (id !== tabId || change?.status !== 'loading') return;
    setTimeout(() => settle('navigated'), grace);
  };
  const onRemoved = (id) => {
    if (id === tabId) settle('removed');
  };
  tabs.onUpdated.addListener(onUpdated);
  tabs.onRemoved.addListener(onRemoved);
  const stop = () => {
    tabs.onUpdated.removeListener(onUpdated);
    tabs.onRemoved.removeListener(onRemoved);
  };
  return { promise, stop };
}

export function goneOutcome(reason) {
  return reason === 'removed'
    ? { ok: false, code: 'tab-closed', error: 'The tab was closed while the tool was running.' }
    : {
      ok: false,
      code: 'navigated',
      error: 'The page navigated away while the tool was running; whatever it was about to answer is gone.',
    };
}
