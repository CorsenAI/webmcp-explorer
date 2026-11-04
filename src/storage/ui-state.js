// What the panel was showing, so closing it does not lose the user's place.
//
// Chrome unloads the side panel page when it is closed. Work already in flight survives —
// the agent loop and the eval runner live in the service worker — but everything the user had
// typed or navigated to was gone on reopen. Reported from real use: someone closes the panel
// to see the page at full width, comes back, and is on the wrong screen with an empty box.
//
// This is transient state, so it lives in chrome.storage.session: it is memory-backed, never
// written to disk, and gone when Chrome closes — which is exactly the lifetime a "where was
// I" note deserves.

const KEY = 'panelState';

// Keeps the record from growing for the life of a browser session. Twenty tabs is far more
// than anyone inspects at once, and the oldest entry to fall off is the least missed.
const MAX_TABS = 20;
let pending = Promise.resolve();

function update(change) {
  pending = pending.catch(() => {}).then(async () => write(await change(await read())));
  return pending;
}

async function read() {
  try {
    const stored = await chrome.storage.session.get(KEY);
    const value = stored?.[KEY];
    return value && typeof value === 'object' ? value : {};
  } catch {
    // A panel that cannot read its own note must still open.
    return {};
  }
}

export async function loadPanelState(tabId) {
  await pending;
  const state = await read();
  return {
    section: state.section ?? null,
    tab: state.tabs?.[tabId] ?? {},
  };
}

export async function savePanelSection(section) {
  return update(state => ({ ...state, section }));
}

// Per-tab, because a goal written against one page means nothing on another.
export async function savePanelTabState(tabId, patch) {
  return update(state => {
    const tabs = { ...(state.tabs ?? {}) };
    tabs[tabId] = { ...(tabs[tabId] ?? {}), ...patch, touchedAt: Date.now() };

    const ordered = Object.entries(tabs)
      .sort((a, b) => (b[1].touchedAt ?? 0) - (a[1].touchedAt ?? 0))
      .slice(0, MAX_TABS);

    return { ...state, tabs: Object.fromEntries(ordered) };
  });
}

export async function forgetPanelTab(tabId) {
  return update(state => {
    if (!state.tabs?.[tabId]) return state;
    const tabs = { ...state.tabs };
    delete tabs[tabId];
    return { ...state, tabs };
  });
}

async function write(value) {
  try {
    await chrome.storage.session.set({ [KEY]: value });
  } catch {
    // Losing the note is a small annoyance; failing the render would be a bug.
  }
}
