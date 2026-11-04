// Past calls for one tool, with performance stats and replay eligibility.
//
// An entry stores the contract as it was at call time, so Explorer can say "the schema
// changed since this call" rather than replaying blindly against a contract that moved.

import { el, badge, t } from '../dom.js';
import { summarize, replayability } from '../../core/history.js';
import { exportBar } from '../components/export-bar.js';
import { reproReport, specFilename } from '../../core/export/repro.js';
import { reproContext } from './repro-context.js';

function formatTime(at) {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function statsBlock(stats) {
  const grid = el('div', { class: 'stats' });
  const put = (label, value, title) => {
    grid.append(el('div', { class: 'stat', title }, [
      el('span', { class: 'stat-label', text: label }),
      el('span', { class: 'stat-value', text: value }),
    ]));
  };
  put(t('toolHistory_calls'), String(stats.calls), t('toolHistory_callsHelp'));
  put(t('toolHistory_success'), `${stats.successRate}%`, t('toolHistory_successHelp'));
  put(t('toolHistory_p50'), stats.p50 === null ? '—' : t('common_ms', [String(stats.p50)]), t('toolHistory_p50Help'));
  put(t('toolHistory_p95'), stats.p95 === null ? '—' : t('common_ms', [String(stats.p95)]), t('toolHistory_p95Help'));
  put(t('toolHistory_max'), stats.max === null ? '—' : t('common_ms', [String(stats.max)]), t('toolHistory_maxHelp'));
  if (stats.timed < stats.calls) {
    put(t('toolHistory_untimed'), String(stats.calls - stats.timed), t('toolHistory_untimedHelp'));
  }
  return grid;
}

// The tool as it was when the entry was recorded: the frozen contract, the frame and the origin
// of the call, over the live tool's identity.
function recordedTool(entry, tool) {
  return {
    ...tool,
    name: entry.toolName ?? tool.name,
    origin: entry.origin ?? tool.origin,
    frameId: entry.frameId ?? tool.frameId,
    contractFp: entry.contractFp ?? tool.contractFp,
    description: entry.contractSnapshot?.description ?? tool.description,
    inputSchema: entry.contractSnapshot?.inputSchema ?? tool.inputSchema,
  };
}

function entryRow(entry, tool, currentTools, { onReplay, page }) {
  const verdict = replayability(entry, currentTools);

  const head = el('div', { class: 'history-head' }, [
    el('span', { class: 'muted', text: formatTime(entry.at) }),
    // A call made by an active security probe (S2) is not something the person typed.
    entry.probe ? el('span', { class: 'badge badge-muted', text: t('history_probeBadge'), title: t('history_probeBadgeHelp', [entry.probe]) }) : null,
    el('span', {
      class: entry.ok ? 'badge badge-ok' : 'badge badge-danger',
      text: entry.ok ? t('common_ok') : (entry.code ?? t('common_error')),
      title: entry.error ?? '',
    }),
    el('span', {
      class: 'muted',
      text: entry.durationMs === null ? '—' : t('common_ms', [String(entry.durationMs)]),
      title: entry.roundTripMs === null ? '' : t('toolHistory_msIncludingHop', [String(entry.roundTripMs)]),
    }),
  ]);

  const box = el('details', { class: 'history-row' });
  const body = el('div', { class: 'history-body' });

  body.append(el('p', { class: 'card-origin', text: t('toolHistory_arguments') }));
  body.append(el('pre', { class: 'result-body mono', text: JSON.stringify(entry.args, null, 2) }));

  if (entry.ok && entry.result !== null) {
    body.append(el('p', { class: 'card-origin', text: t('toolDetails_result') }));
    body.append(el('pre', { class: 'result-body mono', text: entry.result }));
    if (entry.resultTruncated) {
      body.append(el('p', {
        class: 'field-note',
        text: t('toolHistory_resultTruncatedForStorageOriginal', [String(entry.resultOriginalChars)]),
      }));
    }
  }

  if (!entry.ok && entry.error) {
    body.append(el('p', { class: 'field-note', text: entry.error }));
  }

  if (verdict.message) {
    body.append(el('p', { class: 'field-note', text: verdict.message }));
  }

  // When the call belongs to another frame than the one this screen was opened on, the button
  // says where the replay will run: a shared history must never redirect silently (D-057).
  const elsewhere = verdict.target && Number.isInteger(verdict.target.frameId)
    && verdict.target.frameId !== tool.frameId;
  const replay = el('button', {
    text: elsewhere ? t('toolHistory_replayInFrame1', [String(verdict.target.frameId)]) : t('toolHistory_replay'),
    title: !verdict.canReplay
      ? verdict.message
      : elsewhere
        ? t('toolHistory_thisCallWasMadeInFrame1', [String(verdict.target.frameId)])
        : t('toolHistory_runThisToolAgainWith'),
  });
  replay.disabled = !verdict.canReplay;
  replay.addEventListener('click', () => onReplay(entry));
  body.append(replay);

  // This call, as something a colleague can run without Explorer.
  if (entry.code !== 'cancelled') {
    const recorded = recordedTool(entry, tool);
    body.append(exportBar({
      label: t('toolDetails_reproduce'),
      kinds: ['markdown', 'json', 'console', 'playwright'],
      filenames: { playwright: specFilename(recorded).replace(/\.mjs$/, '') },
      note: t('toolDetails_reproduceNote'),
      build: () => reproReport({
        tool: recorded, args: entry.args,
        outcome: { engine:entry.engine,dispatchState:entry.dispatchState,effectState:entry.effectState,attempts:entry.attempts,ok: entry.ok, result: entry.result, error: entry.error, code: entry.code, durationMs: entry.durationMs, roundTripMs: entry.roundTripMs, argsEncoding: entry.argsEncoding ?? null, mocked: entry.mocked === true, mockMode: entry.mockMode ?? null, startedAt: entry.at },
        ...reproContext({ tool: recorded, url: page?.url ?? null, topOrigin: page?.topOrigin ?? null }),
      }),
    }));
  }

  box.append(el('summary', { title: t('help_historyEntry') }, [head]), body);
  return box;
}

export function renderToolHistory(root, { entries, tool, currentTools, onReplay, onClear, page = null }) {
  root.replaceChildren();

  if (entries.length === 0) {
    root.append(el('p', { class: 'muted', text: t('toolHistory_noRecordedCallForThis') }));
    return;
  }

  const [stats] = summarize(entries);
  if (stats) root.append(statsBlock(stats));

  const header = el('div', { class: 'history-header' }, [
    el('span', { class: 'muted', text: t('toolHistory_1Calls', [String(entries.length)]) }),
  ]);

  if (onClear) {
    const clear = el('button', {
      class: 'link-button',
      text: t('toolHistory_clearHistory'),
      title: t('toolHistory_deleteEveryRecordedCallFor'),
    });
    clear.addEventListener('click', onClear);
    header.append(clear);
  }
  root.append(header);

  for (const entry of entries) {
    root.append(entryRow(entry, tool, currentTools ?? [tool], { onReplay, page }));
  }
}
