// The Agent Lab screen: chat with this page's tools and watch what the model does with them.
//
// The conversation is the surface (D-112 / F9): input at the bottom, turns above, Enter sends.
// It still exists to answer the developer's question — "would a model actually pick my tool,
// and would my schema survive contact with it?" — which is why a tool call is rendered as an
// event with its arguments and result, and why an override or a withheld tool is always visible
// in the transcript (D-004 rules 5 and 6).

import { el, t } from '../dom.js';
import { renderAgentSetup } from './agent-setup.js';
import { renderTranscript } from './agent-transcript.js';
import { renderSessionSwitcher, renderManualMode } from './agent-sessions-view.js';
import { networkNotice } from '../components/network-notice.js';
import { endpointWarnings, configProblems } from '../../core/agent/providers.js';
import { STATUS, isFinished } from '../../core/agent/loop.js';
import { loadPanelState, savePanelTabState } from '../../storage/ui-state.js';

const RUNNING = new Set([STATUS.ready, STATUS.callingModel, STATUS.runningTools]);
const stillGoing = (run) => Boolean(run) && !isFinished(run) && RUNNING.has(run.status);

// A stored session renders through the same transcript view as a live run; it carries every
// field that view needs (transcript, status, doneReason, budgets, model).
const sessionAsRun = (session) => ({ ...session, id: session.id, goal: session.title });

export async function renderAgent(root, { tabId, tools, topOrigin }) {
  const setupHost = el('div');
  const transcriptHost = el('div', { class: 'ag-transcript' });
  const goal = el('textarea', {
    id: 'ag-goal', rows: '2',
    placeholder: t('agent_whatShouldTheAgentTry'),
  });
  goal.disabled = true;
  // A chat composer grows with the draft and stops a few lines short of the panel (the
  // convention every chat box sets): the user sees the whole question, not a two-line window
  // onto a paragraph they are typing. Fixed floor, capped ceiling; scrollHeight drives it.
  const autoGrow = () => {
    goal.style.height = 'auto';
    goal.style.height = `${Math.min(goal.scrollHeight, 200)}px`;
  };
  goal.addEventListener('input', autoGrow);
  // The floating "back to the conversation" affordance: shown only when the reader has
  // scrolled up while output is arriving, so a long answer does not strand them mid-page
  // with no one-click way to catch the end (chat anatomy, Perplexity's jump-to-latest).
  const jumpButton = el('button', {
    class: 'ag-jump', type: 'button', text: t('agent_jumpToLatest'),
    title: t('agent_jumpToLatestHelp'), hidden: '',
  });
  jumpButton.addEventListener('click', () => {
    root.scrollTop = root.scrollHeight;
    jumpButton.hidden = true;
  });
  // One-click "Try again": re-asks the last question into the same conversation. Declared
  // with the composer's other controls; paint() decides whether it shows.
  const retryButton = el('button', {
    class: 'ag-retry', type: 'button', text: t('agent_tryAgain'),
    title: t('agent_tryAgainHelp'), hidden: '',
  });
  // Jump visibility follows the wheel directly, not just paints: a reader scrolling up in a
  // finished conversation gets the affordance at once, without waiting for a tick that may
  // never come (measured by the visual probe). Paints still settle it for the streaming case.
  const updateJumpVisibility = () => {
    const shown = viewing ?? run;
    const above = root.scrollHeight - root.scrollTop - root.clientHeight > 48;
    jumpButton.hidden = !(above && shown && root.scrollHeight > root.clientHeight);
  };
  root.addEventListener('scroll', updateJumpVisibility);

  const sendButton = el('button', { class: 'primary', text: t('agent_send') });
  const cancelButton = el('button', { text: t('agent_cancel'), title: t('agent_stopAfterTheCurrentStep') });
  // Open-in-window: the side panel is Chrome's own width and the owner called the chat
  // "minuscul". The same Agent Lab, rendered in a real window the user resizes — the popup
  // reuses this bundle through ?window=1, so there is exactly one chat code path.
  const windowButton = el('button', {
    class: 'icon-button ag-open-window', text: '⧉',
    title: t('agent_openInWindow'), 'aria-label': t('agent_openInWindow'),
  });
  windowButton.addEventListener('click', async () => {
    // The page under inspection travels in the URL: inside the popup, lastFocusedWindow is
    // the popup itself, so only an explicit handoff keeps it pointed at the same page.
    const page = await chrome.tabs.get(tabId).catch(() => null);
    if (!page?.id || !page.url) return;
    const url = chrome.runtime.getURL(
      `ui/sidepanel.html?window=1&tabId=${page.id}&url=${encodeURIComponent(page.url)}`);
    chrome.windows.create({ url, type: 'popup', width: 1000, height: 820 });
  });
  const manualHost = el('div');
  const setupHint = el('p', { class: 'field-desc', role: 'status' });
  const setupButton = el('button', { type: 'button', class: 'ag-configure', text: t('agentSetup_openSetup'), title: t('agentSetup_openSetupHelp') });
  setupButton.addEventListener('click', () => {
    setup.open = true;
    setup.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setupHost.querySelector('#ag-provider')?.focus({ preventScroll: true });
  });
  // The "Answer as" bar lives in the composer, not only in the setup fold: the owner must be
  // able to change the persona between two messages of one conversation without opening
  // anything. It saves through the same channel as the setup select.
  const profileBarHost = el('div', { class: 'ag-profile-bar' });
  // The disclosure of what Send puts on the wire, and to whom. Inline, not a tooltip (D-052).
  const noticeHost = el('div', { class: 'nn-host' });
  // Conversation history: finished runs kept per site, switchable, continuable.
  const sessionsHost = el('div');
  const continueNote = el('p', { class: 'field-desc ag-continuing', hidden: '' });

  let config = null;
  let providers = [];
  let promptProfiles = [];
  let keyState = { hasKey: false };
  let endpointAllowed = false;
  let checkedEndpointKey = null;
  let run = null;
  let sending = false;
  let initialized = false;
  let configRefresh = 0;
  let disposed = false;
  let detailsOpen = false;
  let viewing = null;
  let sessions = [];
  // Chat groups and the active filter are view state; they are declared here because the
  // functions below close over them and renderAgent calls refreshSessions before returning.
  let groups = [];
  let groupFilter = null;
  // Declared here, not where renderProfileBar lives: paint() runs through refreshConfig()
  // at mount, long before the function body — `let` below that point is a dead zone (the
  // same trap `groups` hit once).
  let barSignature = null;

  // The summary carries the answer to "what did I just run against?", because the section is
  // collapsed for the whole of the run that follows.
  const setupSummary = el('summary', { text: t('agentSetup_model'), title: t('help_modelSetup') });
  const setup = el('details', { class: 'ag-setup', open: '' });
  setup.append(setupSummary, setupHost);

  // Chat-first layout (D-118, the owner's Gmail demand): the conversation owns the top of
  // the panel and fills it; every control — session history, persona, composer, model setup
  // — sits below where the reading ends, the way ChatGPT/Claude/Gemini order a chat window.
  root.replaceChildren(
    transcriptHost,
    continueNote,
    sessionsHost,
    el('div', { class: 'field ag-composer' }, [
      jumpButton,
      profileBarHost,
      goal,
      el('p', { class: 'field-desc ag-tool-count', text: t('agent_toolsAvailable', [String(tools.length)]),
        title: t('agent_nToolsOnThisPageWillBeOffered', [String(tools.length)]) }),
      noticeHost,
      el('div', { class: 'form-actions' }, [sendButton, cancelButton, retryButton, windowButton]),
      setupHint, setupButton,
      manualHost,
    ]),
    setup,
  );
  const composerSize = new ResizeObserver(([entry]) => {
    root.style.setProperty('--ag-composer-height', `${entry.target.offsetHeight + 12}px`);
  });
  composerSize.observe(root.querySelector('.ag-composer'));

  // The last question the user actually sent — what Try again re-asks. Kept as typed, so a
  // retried question is the same question, not a paraphrase of a transcript entry.
  retryButton.addEventListener('click', () => {
    const source = viewing ?? run;
    const users = (source?.transcript ?? []).filter((entry) => entry.role === 'user');
    const last = users[users.length - 1]?.text ?? '';
    if (!last) return;
    goal.value = last;
    autoGrow();
    send();
  });

  cancelButton.disabled = true;

  async function send() {
    if (sendButton.disabled || sending || disposed) return;
    if (!goal.value.trim()) {
      goal.focus();
      return;
    }
    // A chat continues itself: the next message goes into the conversation on screen — the
    // stored session opened from the history, or the one the finished run archived. Only
    // "New session" starts a fresh one, the way every chat product behaves (owner's demand,
    // 2026-09-16: two sends in a row used to open two unrelated sessions).
    const continuing = viewing?.id
      ?? (run && isFinished(run) ? (run.sessionId ?? run.id) : null);
    sending = true;
    paint();
    let started;
    try { started = await chrome.runtime.sendMessage({
      type: 'agent-start', tabId, goal: goal.value.trim(), tools, topOrigin,
      sessionId: continuing,
    }); } catch (error) { started = { error: error.message }; }
    sending = false;
    if (disposed) return;
    if (started?.error) {
      manualHost.replaceChildren(el('p', { class: 'field-note', text: started.error }));
      paint();
      return;
    }
    viewing = null;
    run = started.run;
    goal.value = '';
    autoGrow();
    savePanelTabState(tabId, { agentGoal: '', agentConversation: {
      origin: topOrigin, id: run.sessionId ?? run.id,
    } });
    setup.open = false;
    root.append(setup);
    paint();
    refreshSessions();
    if (started.manual) await showManual();
  }

  sendButton.addEventListener('click', send);
  // Enter sends, Shift+Enter makes a newline — the convention of every chat box.
  goal.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });

  cancelButton.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'agent-cancel', tabId });
  });

  // The service worker publishes every transition, so the panel shows the conversation as it
  // happens rather than in one jump at the end.
  const onMessage = (msg) => {
    if (msg?.type === 'agent-config-changed') { refreshConfig(); return; }
    if (msg?.type !== 'agent-update' || msg.tabId !== tabId) return;
    run = msg.run;
    paint();
    if (isFinished(run)) refreshSessions();
    if (config?.providerId === 'manual' && !RUNNING.has(run.status)) manualHost.replaceChildren();
  };
  chrome.runtime.onMessage.addListener(onMessage);
  // The panel fires this before it replaces the view, so a listener does not outlive the
  // screen that created it.
  root.addEventListener('explorer:teardown', () => {
    disposed = true;
    composerSize.disconnect();
    chrome.runtime.onMessage.removeListener(onMessage);
    root.removeEventListener('scroll', updateJumpVisibility);
    root._agScrollCleanup?.();
  }, { once: true });

  await refreshConfig();
  // A goal typed before the panel was closed is the user's work; it comes back with them
  // (D-042). The run itself lived on in the service worker and is fetched here.
  const saved = await loadPanelState(tabId);
  detailsOpen = saved.tab.agentDetailsOpen === true;
  if (saved.tab.agentGoal) { goal.value = saved.tab.agentGoal; autoGrow(); }
  goal.addEventListener('input', () => {
    savePanelTabState(tabId, { agentGoal: goal.value });
  });

  const state = await chrome.runtime.sendMessage({ type: 'agent-state', tabId });
  run = state?.run ?? null;
  await refreshSessions();
  const selected = saved.tab.agentConversation;
  if (!stillGoing(run) && selected?.origin === topOrigin) {
    viewing = sessions.find(session => session.id === selected.id) ?? null;
    if (!viewing) run = null;
  }
  if (run) setup.open = false;
  if (viewing) setup.open = false;
  const selectedProvider = providers.find(provider => provider.id === config?.providerId);
  if (selectedProvider &&
      configProblems({ ...config, hasKey: keyState.hasKey, provider: selectedProvider }).length === 0 &&
      (selectedProvider.manual || endpointAllowed)) setup.open = false;
  if (!selectedProvider) { setup.open = true; root.prepend(setup); }
  initialized = true;
  goal.disabled = false;
  paint();

  async function refreshConfig(patch) {
    const revision = ++configRefresh;
    if (patch && Object.keys(patch).length) {
      await chrome.runtime.sendMessage({ type: 'agent-config-save', patch });
    }
    const data = await chrome.runtime.sendMessage({ type: 'agent-config' });
    if (disposed || revision !== configRefresh) return;
    config = data.config;
    providers = data.providers;
    promptProfiles = data.promptProfiles ?? [];
    keyState = data.key ?? { hasKey: false };
    const focused = setupHost.contains(document.activeElement) ? document.activeElement : null;
    const selection = focused && typeof focused.selectionStart === 'number'
      ? [focused.selectionStart, focused.selectionEnd] : null;
    // A custom connector is not in the static catalogue; the worker resolved it already.
    const resolved = providers.find((p) => p.id === config.providerId) ?? null;
    endpointAllowed = false;
    const configuredId = config.providerId;
    const configuredUrl = config.baseUrl;
    renderAgentSetup(setupHost, {
      config,
      providers,
      key: data.key,
      promptProfiles,
      warnings: endpointWarnings({
        providerId: config.providerId, baseUrl: config.baseUrl, provider: resolved,
      }),
      onChange: (next) => refreshConfig(next),
      onRunnable: (ok) => {
        if (config.providerId !== configuredId || config.baseUrl !== configuredUrl) return;
        endpointAllowed = ok; paint();
      },
    });
    if (focused?.id) {
      const replacement = setupHost.querySelector(`#${CSS.escape(focused.id)}`);
      if (replacement && !replacement.disabled) {
        replacement.focus({ preventScroll: true });
        if (selection && replacement.setSelectionRange) replacement.setSelectionRange(...selection);
      }
    }
    paint();
  }

  // The composer's "Answer as" bar (declared with the composer): picking a profile mid-chat
  // is one ordinary configuration act, saved through the same channel as the setup select.
  // The DOM is rebuilt ONLY when the offered options or the active profile changed — paint()
  // also runs on every worker state tick during a run, and replacing an open <select> closes
  // its dropdown: the owner read that flicker as the menu being locked after saving a profile
  // (measured 2026-09-18: the switch itself always saved; it was the menu that vanished).
  function renderProfileBar() {
    const signature = `${promptProfiles.map((p) => p.id).join('|')}::${config?.promptProfileId ?? ''}`;
    const live = profileBarHost.querySelector('select');
    if (signature === barSignature && live) {
      live.value = config?.promptProfileId ?? '';
      return;
    }
    barSignature = signature;
    const select = el('select', {
      id: 'ag-prompt', 'aria-label': t('prompt_choose'), title: t('prompt_chooseHelp'),
    });
    const defaultOption = el('option', { value: '', text: t('prompt_defaultLabel') });
    select.append(defaultOption);
    for (const p of promptProfiles) {
      const option = el('option', { value: p.id, text: p.name });
      option.selected = p.id === config?.promptProfileId;
      select.append(option);
    }
    select.addEventListener('change', () => refreshConfig({
      promptProfileId: select.value || null,
    }));
    profileBarHost.replaceChildren(
      el('label', { for: 'ag-prompt', class: 'ag-profile-label', text: t('agent_answerAs') }), select);
  }

  function paint() {
    if (disposed) return;
    renderProfileBar();
    const provider = providers.find((p) => p.id === config?.providerId);
    const busy = sending || stillGoing(run);
    const problems = config
      ? configProblems({ ...config, hasKey: keyState.hasKey, provider })
      : ['unknown-provider'];
    noticeHost.replaceChildren(networkNotice({ config, providers, subject: t('agent_send'), compact: true }));
    const needsEndpoint = Boolean(provider && !provider.manual);
    const reason = problems.includes('missing-provider') || problems.includes('unknown-provider')
      ? t('agentSetup_chooseProvider')
      : problems.includes('missing-key') ? t('agentSetup_addKeyFirst')
        : problems.includes('missing-endpoint') ? t('agentSetup_setAnEndpointFirst')
          : needsEndpoint && !endpointAllowed ? t('agentSetup_allowFirst')
            : problems.includes('missing-model') ? t('agentSetup_selectModel')
              : problems.length ? t('agentSetup_reviewSettings') : '';
    setupHint.textContent = reason;
    setupHint.hidden = !reason || busy;
    setupButton.hidden = !reason || busy;
    sendButton.disabled = !initialized || busy || problems.length > 0 || (needsEndpoint && !endpointAllowed);
    sendButton.title = busy ? t('agent_aRunIsInProgress')
      : problems.length ? t('agent_fixFirst', [problems.join(', ')])
        : needsEndpoint && !endpointAllowed ? t('agent_allowTheEndpointFirst')
          : t('agent_sendTheGoalAndThis');
    cancelButton.disabled = !busy;
    cancelButton.hidden = !busy;
    sessionsHost.querySelectorAll('.ag-session-open, .ag-session-delete, .ag-new-session')
      .forEach(button => { button.disabled = busy; });
    const profileName = config?.promptProfileId
      ? promptProfiles.find((p) => p.id === config.promptProfileId)?.name : null;
    setupSummary.textContent = provider
      ? [provider.label, config.model, profileName].filter(Boolean).join(' · ')
      : t('agentSetup_chooseProvider');
    // Viewing a stored session replaces the live transcript until the user starts a run or
    // picks another session. A stored session renders through the same view as a live run.
    const shown = viewing ? sessionAsRun(viewing) : run;
    // Chat autopilot, decided purely from geometry at paint time — no scroll listener, so
    // nothing races the transient clamp Chrome applies when a collapsed section briefly
    // shortens the column (measured on the owner's Gmail and in pairs: listener-based
    // follow read that clamp as a choice and yanked reading users). Captured BEFORE the
    // transcript rebuild, while the old heights are still true: at the bottom, new output
    // pulls the view along; reading anywhere above, the position is restored after, twice —
    // the grown tree settles a frame later. Short content makes both branches harmless.
    const top = root.scrollTop;
    const atBottom = root.scrollHeight - top - root.clientHeight < 48;
    // A user may reopen setup while reading a run; a refresh must respect that choice.
    renderTranscript(transcriptHost, shown, {
      origin: topOrigin, detailsOpen,
      model: shown?.providerId === 'chrome-on-device' ? 'Chrome built-in (retired)' : undefined,
      tools,
      onPickStarter: (prompt) => {
        goal.value = prompt;
        autoGrow();
        savePanelTabState(tabId, { agentGoal: goal.value });
        goal.focus();
      },
      onDetailsChange: (open) => {
        detailsOpen = open;
        savePanelTabState(tabId, { agentDetailsOpen: open });
      },
    });
    if (viewing) {
      const goals = viewing.transcript.filter((entry) => entry.role === 'user').length;
      continueNote.hidden = false;
      continueNote.textContent = goals === 1
        ? t('agentSessions_continuingOne')
        : t('agentSessions_continuing', [String(goals)]);
    } else {
      continueNote.hidden = true;
    }
    if (atBottom) {
      root.scrollTop = root.scrollHeight;
      jumpButton.hidden = true;
    } else {
      jumpButton.hidden = !shown || root.scrollHeight <= root.clientHeight;
      if (root.scrollTop !== top) {
        root.scrollTop = top;
        requestAnimationFrame(() => { root.scrollTop = top; });
      }
    }
    const canRetry = shown && isFinished(shown)
      && (shown.transcript ?? []).some((entry) => entry.role === 'user');
    retryButton.hidden = !canRetry || busy;
  }

  async function refreshSessions() {
    [sessions, groups] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'agent-sessions', origin: topOrigin }).catch(() => []),
      chrome.runtime.sendMessage({ type: 'agent-session-groups', origin: topOrigin }).catch(() => []),
    ]) ?? [[], []];
    renderSessions();
  }

  function renderSessions() {
    if (disposed) return;
    renderSessionSwitcher(sessionsHost, {
      topOrigin,
      sessions,
      groups,
      groupFilter,
      viewing,
      busy: sending || stillGoing(run),
      onNew: async () => {
        viewing = null;
        if (!stillGoing(run)) run = null;
        groupFilter = null;
        goal.value = '';
        autoGrow();
        savePanelTabState(tabId, { agentGoal: '', agentConversation: { origin: topOrigin, id: null } });
        goal.focus();
        paint();
        await refreshConfig({ promptProfileId: null });
      },
      onSelect: (session) => {
        viewing = session;
        goal.value = '';
        autoGrow();
        savePanelTabState(tabId, { agentGoal: '', agentConversation: { origin: topOrigin, id: session.id } });
        paint();
        root.scrollTop = root.scrollHeight;
      },
      onDelete: async (session) => {
        await chrome.runtime.sendMessage({
          type: 'agent-session-delete', origin: topOrigin, sessionId: session.id,
        });
        if (viewing?.id === session.id) viewing = null;
        if ((run?.sessionId ?? run?.id) === session.id) run = null;
        if (!viewing && !run) {
          savePanelTabState(tabId, { agentConversation: { origin: topOrigin, id: null } });
        }
        await refreshSessions();
        paint();
      },
      onFilterChange: (nextFilter, { refresh = true } = {}) => {
        groupFilter = nextFilter;
        if (refresh) renderSessions();
      },
      onRefresh: async () => {
        await refreshSessions();
        paint();
      },
    });
    if (viewing && !sessions.some((session) => session.id === viewing.id)) {
      viewing = null;
      paint();
    }
  }

  async function showManual() {
    await renderManualMode(manualHost, {
      tabId,
      isRunning: (nextRun) => RUNNING.has(nextRun?.status),
      onRunUpdate: (nextRun) => {
        run = nextRun;
        paint();
      },
    });
  }
}
