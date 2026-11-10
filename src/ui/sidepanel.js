import { mountBridgeApprovals } from './components/bridge.js';
import { hasOrigin, originPattern } from '../shared/permissions.js';
import { el, t, initUiLanguage } from './dom.js';
import { icon } from './icons.js';
import { loadPanelState, savePanelSection, forgetPanelTab } from '../storage/ui-state.js';
import { isDemoPage, isDemoTab, demoUrl, openDemo } from '../shared/demo.js';
import { renderGrant } from './views/grant.js';
import { renderStatus, appendSecurityBadge } from './views/status.js';
import { renderTools } from './views/tools.js';
import { renderEnvironment } from './views/environment.js';
import { renderToolDetails } from './views/tool-details.js';
import { renderTimeline } from './views/timeline.js';
import { renderSecurity } from './views/security.js';
import { pageStateViews } from './views/page-state.js';
import { renderAgent } from './views/agent.js';
import { renderEvals } from './views/evals.js';
import { renderAudit } from './views/audit.js';
import { renderSettings } from './views/settings.js';
import { openHelp } from './components/help.js';
import { recipeHub, renderRecipe } from './views/recipes.js';
import { createRecipe, recipeStep } from '../core/recipes.js';

const refreshBridgeApprovals = mountBridgeApprovals(document.getElementById('bridge-approvals'));
const originEl = document.getElementById('origin');
const factsEl = document.getElementById('facts');
const viewEl = document.getElementById('view');
const refreshEl = document.getElementById('refresh');
const railEl = document.getElementById('rail');
const resetEl = document.getElementById('reset');

// Open-in-window mode (D-120): ?window=1&tabId=N&url=… turns this same bundle into a big
// standalone chat window — one code path, no duplicate chat. The rail hides (the window IS
// the Agent Lab) and the inspected page comes from the URL, not from window focus.
const windowParams = new URLSearchParams(location.search);
const windowMode = windowParams.get('window') === '1';
const windowTabId = Number(windowParams.get('tabId')) || null;
if (windowMode) {
  document.body.classList.add('window-mode');
  railEl.hidden = true;
}
const helpEl = document.getElementById('help');
helpEl.textContent = t('help_button');
helpEl.title = t('help_buttonHelp');
helpEl.addEventListener('click', () => openHelp({ page: 'screen' }));

// Chrome scrolls a newly focused textarea's caret into view, sometimes leaving the rest of
// the field below the panel. Keep a keyboard-focused control whole when it fits the view.
viewEl.addEventListener('focusin', ({ target }) => {
  if (target.matches(':focus-visible') && target.getBoundingClientRect().height <= viewEl.clientHeight - 8) {
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
});

// The static markup carries English hints so the frame is never nameless before the script
// runs; the locale supplies the ones the user actually sees.
originEl.title = t('sidepanel_originHelp');
resetEl.setAttribute('aria-label', t('sidepanel_resetLabel'));
refreshEl.title = t('sidepanel_refreshLabel');
refreshEl.setAttribute('aria-label', t('sidepanel_refreshLabel'));
railEl.setAttribute('aria-label', t('sidepanel_railLabel'));

// Three groups, as decided in D-013: inspect, act, capitalise. Only the sections that
// exist are shown — a rail full of dead icons teaches the user to ignore it.
const SECTIONS = [
  { id: 'tools', labelKey: 'toolsHeading', group: 'inspect' },
  { id: 'timeline', labelKey: 'sidepanel_timeline', group: 'inspect' },
  { id: 'security', labelKey: 'security_title', group: 'inspect' },
  { id: 'agent', labelKey: 'sidepanel_agentLab', group: 'act' },
  { id: 'evals', labelKey: 'sidepanel_evals', group: 'act' },
  { id: 'audit', labelKey: 'sidepanel_audit', group: 'act' },
  // Settings sit at the bottom of the rail (ARCHITECTURE section 8): not a section of the
  // product, the place where its access and its data are managed.
  { id: 'settings', labelKey: 'settings_title', group: 'settings' },
];

let section = 'tools';
const SECTION_IDS = new Set(SECTIONS.map((item) => item.id));

let rendering = false;
// A render asked for while one is in progress is not dropped: it runs once the current one has
// finished. Measured in the production journeys: a rail click made while a permission change was
// being painted was silently lost, leaving the rail on one section and the view on another.
let renderQueued = false;
// The tab the last render inspected: the one whose live notices may redraw the list.
let inspectedTabId = null;
let openToolId = null;
const recipeDrafts = new Map();

function openRecipe(draft, tabId, discovery) {
  viewEl.dispatchEvent(new CustomEvent('explorer:teardown'));
  viewEl.classList.remove('ag-view');
  recipeDrafts.set(tabId, draft);draft.open=true;openToolId=null;
  renderRecipe(viewEl, { draft, tabId, discovery,
    onBack: () => { draft.open=false; render(); },
    onDiscard: () => { recipeDrafts.delete(tabId); render(); },
  });
}

function renderRail() {
  helpEl.textContent = t('help_button');
  helpEl.title = t('help_buttonHelp');
  originEl.title = t('sidepanel_originHelp');
  resetEl.setAttribute('aria-label', t('sidepanel_resetLabel'));
  refreshEl.title = t('sidepanel_refreshLabel');
  refreshEl.setAttribute('aria-label', t('sidepanel_refreshLabel'));
  railEl.setAttribute('aria-label', t('sidepanel_railLabel'));

  const buttons = [];
  let lastGroup = null;
  for (const item of SECTIONS) {
    if (lastGroup && item.group !== lastGroup) {
      buttons.push(el('div', { class: item.group === 'settings' ? 'rail-spacer' : 'rail-sep' }));
    }
    lastGroup = item.group;
    const label = t(item.labelKey);
    const button = el('button', {
      class: section === item.id ? 'rail-button rail-active' : 'rail-button',
      title: t(`help_nav_${item.id}`),
      'aria-label': label,
      'aria-pressed': String(section === item.id),
    }, [icon(item.id), el('span', { class: 'rail-label', text: label, 'aria-hidden': 'true' })]);
    button.addEventListener('click', () => {
      if (section === item.id) return;
      section = item.id;
      openToolId = null;
      // Closing the panel must not lose the user's place (D-042). The save is a read-modify-write
      // of the session note; the render must not read that note back — restore() did, and a click
      // made before the write had landed bounced the panel to the previous section (measured in
      // the production journeys: Settings stayed on screen after Tools was clicked).
      savePanelSection(section);
      renderRail();
      railEl.querySelector('.rail-active')?.focus({ preventScroll: true });
      render();
    });
    buttons.push(button);
  }
  railEl.replaceChildren(...buttons);
}

function openDetails(tool, tabId, result) {
  // The instance, not the logical id: two frames may own a tool of the same name (D-056), and a
  // refresh must reopen the very one the user was looking at.
  openToolId = tool.instanceId ?? tool.logicalId;
  if(recipeDrafts.has(tabId))recipeDrafts.get(tabId).open=false;
  renderToolDetails(viewEl, {
    tool,
    tabId,
    url: result?.url ?? null,
    topOrigin: result?.topOrigin ?? null,
    currentTools: result?.tools ?? [tool],
    onBack: () => {
      openToolId = null;
      render();
    },
    // Re-run discovery so the header, the list and the badges reflect the new override.
    onOverrideChanged: () => render(),
    onRecipe: (selected, args, outcome) => {
      const draft=recipeDrafts.get(tabId)??{recipe:createRecipe({name:'',topOrigin:result.topOrigin,sourceUrl:result.url??'',steps:[]})};
      if(draft.recipe.steps.length>=20)return;
      const step=recipeStep(selected,args);draft.recipe.steps.push(step);draft.saved=false;
      draft.seedResults??=Object.create(null);draft.seedResults[step.id]=structuredClone(outcome);
      openRecipe(draft,tabId,result);
    },
  });
}

async function activeTab() {
  // Open-in-window mode (D-120): a popup's own tab IS the active tab of its window, so
  // lastFocusedWindow would inspect the panel itself. The page to inspect arrives in the
  // popup's URL instead — the Agent Lab's window button writes tabId and url there.
  if (windowMode) return chrome.tabs.get(windowTabId).catch(() => null);
  // A native side panel belongs to its browser window. A chat popup can take global
  // focus without changing that window's inspected tab (including while it closes).
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

const { showMessage, demoOffer, showNeedsAction, showDiscoveryFailure } = pageStateViews(viewEl, factsEl, render);

// Nothing tells an already-open side panel that it has just been granted activeTab: the
// grant happens when the user clicks the toolbar button, and no chrome.* event fires for it.
// Without this, the panel keeps showing "needs one click" after the user has already
// clicked — which is what happened in manual testing (D-033). The poll runs only while that
// screen is up, and stops the moment access arrives.
const ACCESS_POLL_MS = 800;
let accessPoll = null;

function setAccessPoll(on) {
  if (on === (accessPoll !== null)) return;
  if (on) accessPoll = setInterval(checkAccess, ACCESS_POLL_MS);
  else { clearInterval(accessPoll); accessPoll = null; }
}

// Only re-renders once the address actually became visible. A poll that rebuilt the view on
// every tick would throw away whatever the user is in the middle of — a half-filled form,
// a scrolled result — for as long as access has not arrived.
async function checkAccess() {
  if (document.hidden) return;
  const tab = await activeTab();
  // The demo's bridge may announce after onActivated/onUpdated. Its URL stays hidden,
  // so the blocked-screen poll must also notice that late announcement (D-095).
  if (tab?.url || await isDemoTab(tab?.id)) render();
}

async function render() {
  if (rendering) {
    renderQueued = true;
    return;
  }
  rendering = true;
  viewEl.inert = true;
  viewEl.setAttribute('aria-busy', 'true');
  refreshEl.disabled = true;
  let blocked = false;
  let currentTabId = null;
  inspectedTabId = null;

  // Views may hold listeners on the service worker; tell the outgoing one to let go before
  // it is replaced.
  viewEl.dispatchEvent(new CustomEvent('explorer:teardown'));

  try {
    const tab = await activeTab();
    currentTabId = tab?.id ?? null;
    inspectedTabId = currentTabId;

    // Settings need no page: they must be reachable from a blocked screen too, since managing
    // site access is one of the ways out of it.
    if (section === 'settings') {
      originEl.textContent = tab?.url && originPattern(tab.url) ? new URL(tab.url).host : '—';
      factsEl.replaceChildren();
      await renderSettings(viewEl, { onChanged: () => { renderRail(); refreshBridgeApprovals(true); render(); } });
      return;
    }

    // The bundled demo lives inside the extension, so it needs neither an http origin nor a
    // grant: Explorer already has access to its own pages (D-049). Its tab announces itself,
    // because Chrome hides even an extension page's URL without the tabs permission — and it
    // is asked before the blocked screen: a visitor who opened the demo from the
    // "WebMCP unavailable" screen must land on its tools, not on "click the icon" (found by
    // tools/e2e/no-flag.mjs, R11).
    const demo = isDemoPage(tab?.url) || await isDemoTab(tab?.id);

    const pageUrl = demo ? (tab?.url ?? demoUrl()) : tab?.url;
    // A removed permission or navigation must not hide a recipe's completed/uncertain
    // results. Its review still checks current access through the worker before any call.
    const recipeDraft=recipeDrafts.get(tab?.id);
    if(section==='tools'&&recipeDraft?.open){
      let discovery={tools:[],topOrigin:recipeDraft.recipe.topOrigin,url:pageUrl};
      try{if(pageUrl&&(demo||await hasOrigin(pageUrl))){
        const fresh=await chrome.runtime.sendMessage({type:'discover',tabId:tab.id,url:pageUrl});
        if(fresh&&!fresh.error)discovery=fresh;
      }}catch{/* The retained recipe remains readable when the page cannot be injected. */}
      originEl.textContent=recipeDraft.recipe.topOrigin;
      factsEl.replaceChildren();openRecipe(recipeDraft,tab.id,discovery);return;
    }

    // Tab.url is a sensitive property: without activeTab (granted by clicking the toolbar
    // icon) or a matching host grant, Chrome returns a tab object with no url. Saying
    // "no inspectable tab" there would be wrong and would dead-end a fresh install.
    if (tab && !tab.url && !demo) {
      originEl.textContent = '—';
      blocked = true;
      showNeedsAction();
      return;
    }


    if (!demo && (!tab?.url || !originPattern(tab.url))) {
      originEl.textContent = '—';
      showMessage(t('noTabTitle'), t('noTabBody'), 'muted', demoOffer());
      return;
    }

    originEl.textContent = demo ? t('sidepanel_demoPage') : new URL(tab.url).host;

    if (!demo && !(await hasOrigin(tab.url))) {
      factsEl.replaceChildren();
      renderGrant(viewEl, { url: tab.url, onGranted: render });
      return;
    }

    const result = await chrome.runtime.sendMessage({
      type: 'discover', tabId: tab.id, url: pageUrl,
    });

    if (!result || result.error) {
      showDiscoveryFailure(result?.error ?? t('sidepanel_noResponseFromTheService'),pageUrl);
      return;
    }

    renderStatus(factsEl, result, { onGranted: render, tabId: tab.id });
    // Not awaited: the badge for findings new since the saved baseline arrives when storage answers.
    appendSecurityBadge(factsEl, result);

    // The Agent Lab is the one screen that owns its scroll column (chat layout, D-116);
    // every other screen keeps the plain whole-view scroll.
    viewEl.classList.toggle('ag-view', section === 'agent');

    if (section === 'timeline') {
      await chrome.runtime.sendMessage({ type: 'live-attach', tabId: tab.id });
      renderTimeline(viewEl, { tabId: tab.id, origin: result.topOrigin ?? null });
      return;
    }

    if (section === 'security') {
      // The lifecycle rules read the tab's live timeline; attaching is what Timeline does too.
      await chrome.runtime.sendMessage({ type: 'live-attach', tabId: tab.id }).catch(() => {});
      const live = await chrome.runtime.sendMessage({ type: 'live-list', tabId: tab.id, limit: 500 }).catch(() => null);
      await renderSecurity(viewEl, {
        result, tabId: tab.id, events: live?.events ?? [],
        onOverrideChanged: () => render(),
        onOpenTool: (finding) => {
          const tool = result.tools.find((item) => (item.instanceId ?? item.logicalId) === finding.instanceId);
          if (!tool) return;
          section = 'tools';
          savePanelSection(section);
          renderRail();
          openDetails(tool, tab.id, result);
        },
      });
      return;
    }

    if (section === 'agent') {
      await renderAgent(viewEl, {
        tabId: tab.id, tools: result.tools, topOrigin: result.topOrigin,
      });
      return;
    }

    if (section === 'evals') {
      await renderEvals(viewEl, {
        tabId: tab.id, tools: result.tools, topOrigin: result.topOrigin,
      });
      return;
    }

    if (section === 'audit') {
      // Pure derivation over the discovery result: no provider, no key, no network — the
      // audit of a page's declared contracts is a fact about the page, like manual discovery.
      renderAudit(viewEl, {
        tools: result.tools,
        topOrigin: result.topOrigin,
        onOpenTool: (auditItem) => {
          const target = result.tools.find((item) => (
            auditItem.instanceId
              ? (item.instanceId ?? item.logicalId) === auditItem.instanceId
              : item.name === auditItem.tool
          ));
          if (!target) return;
          section = 'tools';
          savePanelSection(section);
          renderRail();
          openDetails(target, tab.id, result);
        },
      });
      return;
    }

    if (result.env.checks.apiAvailability !== 'available' && !result.tools.length) {
      renderEnvironment(viewEl, result, { onDemo: openDemo, tabId: tab.id, emulationInStatus: true });
      chrome.runtime.sendMessage({type:'live-attach',tabId:tab.id}).catch(()=>{});
      return;
    }

    // Keep the open tool across a refresh, but only if it is still registered: a tool that
    // disappeared must not leave a detail screen for something that no longer exists.
    const stillThere = openToolId
      && result.tools.find((tool) => (tool.instanceId ?? tool.logicalId) === openToolId);

    if (stillThere) {
      openDetails(stillThere, tab.id, result);
      return;
    }

    openToolId = null;
    renderTools(viewEl, result, {
      recipes: recipeHub({discovery:result,draft:recipeDrafts.get(tab.id),onOpen:draft=>openRecipe(draft,tab.id,result)}),
      onOpen: (tool) => openDetails(tool, tab.id, result),
      tabId: tab.id,
      url: tab.url,
    });
    if (result.env.checks.apiAvailability !== 'available') {
      const diagnosis=el('div');renderEnvironment(diagnosis,result,{onDemo:openDemo,tabId:tab.id,emulationInStatus:true});
      viewEl.prepend(diagnosis);
    }
    // The list follows the page: a tool registered or removed after this paint redraws it
    // (live-changed below). Attached after the paint so the first screen is not delayed.
    chrome.runtime.sendMessage({ type: 'live-attach', tabId: tab.id }).catch(() => {});
  } catch (error) {
    showDiscoveryFailure(String(error?.message ?? error));
  } finally {
    setAccessPoll(blocked);
    rendering = false;
    viewEl.inert = false;
    viewEl.removeAttribute('aria-busy');
    refreshEl.disabled = false;
    syncReset(currentTabId);
    if (renderQueued) {
      renderQueued = false;
      render();
    }
  }
}

// Restore where the user was before doing anything else, so the first paint is already the
// right screen rather than a flash of Tools.
async function restore() {
  await initUiLanguage();
  await refreshBridgeApprovals(true);
  const saved = await loadPanelState(0);
  if (saved.section && SECTION_IDS.has(saved.section)) section = saved.section;
  // The window mode IS the Agent Lab (D-120): the saved section belongs to the side panel's
  // history, not to a chat window the user just opened from the composer.
  if (windowMode) section = 'agent';
  renderRail();
  await render();
}

refreshEl.addEventListener('click', render);

// A registration, a removal or a replaced contract on the inspected tab redraws the Tools list by
// itself — a page that registers on a route change must not need the refresh button (measured
// against the other inspectors, docs/BENCHMARK.md T8), and a description rewritten under the same
// name must not stay on screen as it was. Executions do not redraw; a detail screen with
// arguments being typed is never rebuilt underneath the user: the list catches up when they
// come back to it.
const LIVE_REDRAW_MS = 400;
let liveRedraw = null;
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'live-changed' || msg.tabId !== inspectedTabId) return;
  if (section !== 'tools' || openToolId !== null || recipeDrafts.get(inspectedTabId)?.open) return;
  if (!(msg.kinds ?? []).some((kind) => kind === 'registered' || kind === 'unregistered' || kind === 'changed')) return;
  clearTimeout(liveRedraw);
  liveRedraw = setTimeout(() => { liveRedraw = null; render(); }, LIVE_REDRAW_MS);
});

// Remembering where the user was is only kind if they can also decide to be done. This stops
// whatever is still running on this tab — an agent loop that would otherwise keep spending at
// their provider — and drops the panel's memory of it. It never touches their data (D-044).
resetEl.append(icon('reset'));
resetEl.addEventListener('click', async () => {
  const tab = await activeTab();
  resetEl.disabled = true;
  if (tab?.id !== undefined) {
    await chrome.runtime.sendMessage({ type: 'panel-reset', tabId: tab.id });
    await forgetPanelTab(tab.id);
  }
  await savePanelSection('tools');
  section = 'tools';
  openToolId = null;
  renderRail();
  await render();
});

// The button says what it would stop, and says so honestly when there is nothing to stop.
async function syncReset(tabId) {
  const saved = await loadPanelState(tabId ?? -1);
  // The section is remembered for the panel as a whole, so it counts even when there is no
  // inspectable tab to ask about.
  const remembered = Object.keys(saved.tab ?? {}).some((k) => k !== 'touchedAt')
    || (Boolean(saved.section) && saved.section !== 'tools');

  const activity = tabId === undefined || tabId === null
    ? null
    : await chrome.runtime.sendMessage({ type: 'panel-activity', tabId }).catch(() => null);
  const busy = Boolean(activity?.agent || activity?.evals || activity?.recipe);

  resetEl.disabled = !busy && !remembered;
  resetEl.title = busy
    ? t('sidepanel_stopTheAgentRunAnd')
    : remembered
      ? t('sidepanel_clearWhatThePanelRemembers')
      : t('sidepanel_nothingToStopThisPanel');
}

// Coming back to the panel is the other moment access may have changed under it.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'permissions-changed') render();
});

chrome.tabs.onActivated.addListener(() => { if (!windowMode) render(); });
chrome.tabs.onRemoved.addListener(tabId => {
  recipeDrafts.delete(tabId);
  if (windowMode && tabId === windowTabId) render();
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && (windowMode ? _tabId === windowTabId : tab.active)) render();
});

restore();
