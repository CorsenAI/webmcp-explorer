// The live timeline — the Network panel for WebMCP (D-004 rule 8).
//
// It reports what it lost. A page that churns tools will overflow the bounded buffer, and
// a tidy list that silently omits history would be worse than no list at all.

import { el, badge, t } from '../dom.js';
import { exportBar } from '../components/export-bar.js';
import { timelineReport } from '../../core/export/report.js';
import { CONTRACT_PARTS } from '../../core/security/contract-lock.js';

function kindLabel(kind) {
  const map = {
    registered: t('timeline_kindRegistered'),
    unregistered: t('timeline_kindUnregistered'),
    changed: t('timeline_kindChanged'),
    activated: t('timeline_kindActivated'),
    cancelled: t('timeline_kindCancelled'),
    executed: t('timeline_kindExecuted'),
    failed: t('timeline_kindFailed'),
  };
  return map[kind] ?? kind;
}

const KIND_KIND = {
  registered: 'ok',
  unregistered: 'warn',
  changed: 'warn',
  activated: 'accent',
  cancelled: 'warn',
  executed: 'ok',
  failed: 'danger',
};

function getFilters() {
  return [
    { key: 'lifecycle', label: t('timeline_lifecycle'), kinds: ['registered', 'unregistered', 'changed'] },
    { key: 'calls', label: t('agentTranscript_calls'), kinds: ['executed', 'failed'] },
    { key: 'agent', label: t('timeline_agent'), kinds: ['activated', 'cancelled'] },
  ];
}

function timeOf(at) {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const PART_KEY = { description: 'baseline_partDescription', schema: 'baseline_partSchema', annotations: 'baseline_partAnnotations' };
const partsText = (parts) => CONTRACT_PARTS.filter((part) => (parts ?? []).includes(part)).map((part) => t(PART_KEY[part])).join(', ');

// What the contract fingerprints say about an event, when they say anything: a tool replaced
// under its own name, or a name that came back with the contract it had or with another one.
function contractNote(event) {
  if (event.kind === 'changed') return t('timeline_changedParts', [partsText(event.parts)]);
  if (event.kind === 'registered' && event.contract === 'same') return t('timeline_sameContract');
  if (event.kind === 'registered' && event.contract === 'changed') return t('timeline_otherContract', [partsText(event.parts)]);
  return null;
}

function eventRow(event) {
  const note = contractNote(event);
  const replaced = event.kind === 'registered' && event.contract === 'changed';
  const parts = [
    el('span', { class: 'muted tl-time', text: timeOf(event.at) }),
    badge(kindLabel(event.kind), replaced ? 'warn' : KIND_KIND[event.kind] ?? 'accent'),
    el('span', { class: 'tl-name mono', text: event.toolName ?? '—', title: event.toolName ?? '' }),
  ];

  if (typeof event.durationMs === 'number') {
    parts.push(el('span', { class: 'muted tl-dur', text: t('timeline_1Ms', [String(event.durationMs)]) }));
  }
  if (note) parts.push(el('span', { class: 'muted tl-detail', text: note }));

  const row = el('div', {
    class: note ? 'tl-row tl-row-noted' : 'tl-row',
    title: [event.origin, event.frameId === null ? null : t('common_frameN', [String(event.frameId)]), event.error]
      .filter(Boolean).join(' · '),
  }, parts);

  return row;
}

export function renderTimeline(root, { tabId, origin = null }) {
  const state = { kinds: null, paused: false, events: [], stats: null };
  let refreshing = null;
  let again = false;

  const controls = el('div', { class: 'chips' });
  const summary = el('div', { class: 'count muted' });
  const list = el('div', {});
  // Built at click time from what the buffer held at the last refresh: filters included, since
  // an export is of what is on screen (D-045).
  const exporter = exportBar({
    label: t('timeline_exportThisTimeline'),
    build: () => timelineReport(state.events, { origin, stats: state.stats }),
    note: t('timeline_exportNote'),
  });
  root.replaceChildren(controls, summary, list, exporter);

  const pause = el('button', { class: 'chip', text: t('timeline_pause'), title: t('timeline_stopRecordingNewEvents') });
  pause.addEventListener('click', async () => {
    state.paused = !state.paused;
    await chrome.runtime.sendMessage({ type: 'live-pause', tabId, paused: state.paused });
    pause.textContent = state.paused ? t('timeline_resume') : t('timeline_pause');
    pause.title = state.paused ? t('help_resumeTimeline') : t('timeline_stopRecordingNewEvents');
    pause.classList.toggle('chip-active', state.paused);
    refresh();
  });

  const clear = el('button', { class: 'chip', text: t('timeline_clear'), title: t('timeline_discardTheRecordedEvents') });
  clear.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'live-clear', tabId });
    refresh();
  });

  const filterButtons = getFilters().map((filter) => {
    const button = el('button', { class: 'chip', text: filter.label, title: t('timeline_showOnly1Events', [String(filter.label.toLowerCase())]) });
    button.addEventListener('click', () => {
      state.kinds = state.kinds === filter.kinds ? null : filter.kinds;
      for (const other of filterButtons) other.classList.remove('chip-active');
      if (state.kinds) button.classList.add('chip-active');
      refresh();
    });
    return button;
  });

  controls.append(pause, clear, ...filterButtons);
  refresh();

  // The worker says when this tab's timeline changed (live-changed, D-054). The view then
  // fetches rather than trusting a pushed payload, so what is shown is always what the buffer
  // holds — filters and pause state included.
  const onMessage = (msg) => {
    if (msg?.type === 'live-changed' && msg.tabId === tabId) refresh();
  };
  chrome.runtime.onMessage.addListener(onMessage);
  // The panel fires this before it replaces the view, so a listener does not outlive the
  // screen that created it.
  root.addEventListener('explorer:teardown', () => {
    chrome.runtime.onMessage.removeListener(onMessage);
  }, { once: true });

  // Two fetches in flight could paint an older list over a newer one; a refresh asked for
  // while one is running waits for it and runs once after.
  function refresh() {
    if (refreshing) {
      again = true;
      return refreshing;
    }
    refreshing = fetchAndPaint().finally(() => {
      refreshing = null;
      if (again) {
        again = false;
        refresh();
      }
    });
    return refreshing;
  }

  async function fetchAndPaint() {
    const response = await chrome.runtime.sendMessage({
      type: 'live-list', tabId, kinds: state.kinds, limit: 200,
    });
    const events = response?.events ?? [];
    const stats = response?.stats ?? { total: 0, dropped: 0, skippedWhilePaused: 0 };
    state.events = events;
    state.stats = stats;

    const facts = [t('timeline_nShown', [String(events.length)]), t('timeline_nRecorded', [String(stats.total)])];
    // Honesty about the sampling model (L-10): never imply an exhaustive capture.
    if (stats.dropped > 0) facts.push(t('timeline_nDropped', [String(stats.dropped)]));
    if (stats.skippedWhilePaused > 0) facts.push(t('timeline_nMissedPaused', [String(stats.skippedWhilePaused)]));
    summary.replaceChildren(
      el('span', { text: facts.join(' · ') }),
      el('span', {
        class: 'tl-note',
        text: t('timeline_sampled'),
        title: t('timeline_explorerObservesToolChangesWithout'),
      }),
    );

    if (events.length === 0) {
      list.replaceChildren(el('p', {
        class: 'muted',
        text: stats.paused
          ? t('timeline_recordingIsPaused')
          : t('timeline_nothingRecordedYetRegistrationsAnd'),
      }));
      return;
    }

    list.replaceChildren(...events.map(eventRow));
  }

  return { refresh };
}
