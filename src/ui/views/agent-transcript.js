// Renders an agent run as a conversation, with every tool call shown as what it really was.
//
// The competing inspector keeps a flat array and offers "copy trace", which is
// JSON.stringify on the clipboard. What a developer actually needs to see is which tool the
// model picked, with which arguments, what came back, how long it took, and whether the
// answer was mocked — because a run against mocks looks identical to a real one otherwise.

import { el, badge, t } from '../dom.js';
import { renderMarkdown } from '../components/markdown.js';
import { STATUS, DONE_REASON, isFinished, runStats } from '../../core/agent/loop.js';
import { awaitingForms } from '../../core/agent/form-wait.js';
import { exportBar } from '../components/export-bar.js';
import { agentReport } from '../../core/export/report.js';

function doneText(reason) {
  const map = {
    [DONE_REASON.answered]: t('agentTranscript_answered'),
    [DONE_REASON.stepLimit]: t('agentTranscript_stoppedModelTurnBudgetReached'),
    [DONE_REASON.toolLimit]: t('agentTranscript_stoppedToolCallBudgetReached'),
    [DONE_REASON.cancelled]: t('agentTranscript_cancelled'),
    [DONE_REASON.error]: t('agentTranscript_failed'),
    [DONE_REASON.interrupted]: t('agentTranscript_interruptedByChrome'),
  };
  return map[reason];
}

function excludedText(reason) {
  const map = {
    'schema-unparsed': t('agentTranscript_itsInputSchemaCouldNot'),
    'schema-not-object': t('agentTranscript_itsInputSchemaIsNot'),
    'disabled-by-override': t('agentTranscript_youDisabledItWithAn'),
    'not-injected': t('agentTranscript_explorerWasNotGrantedIts'),
  };
  return map[reason];
}

const views = new WeakMap();

export function renderTranscript(root, run, {
  origin = null, model = null, detailsOpen = false, onDetailsChange = () => {},
  tools = [], onPickStarter = null,
} = {}) {
  if (!run) {
    views.delete(root);
    const empty = el('p', {
      class: 'muted',
      text: t('agentTranscript_noRunYetDescribeWhat'),
    });
    const starters = buildStarters(tools, onPickStarter);
    root.replaceChildren(...[empty, starters].filter(Boolean));
    return;
  }

  let view = views.get(root);
  // Keep the disclosure, export buttons and unchanged turns in place while the worker
  // publishes progress. Replacing them would discard keyboard focus and reading position.
  const identity = run.id ?? run.goal;
  if (!view || view.identity !== identity) {
    const outcome = el('div', { class: 'ag-outcome', role: 'status', 'aria-live': 'polite' });
    const answer = el('div', { class: 'ag-answer' });
    const body = el('div', { class: 'ag-execution-body' });
    const trace = el('details', { class: 'ag-execution tree-raw' }, [
      el('summary', { text: t('agentTranscript_executionDetails'), title: t('agentTranscript_executionDetailsHelp') }),
      body,
    ]);
    trace.open = detailsOpen;
    trace.addEventListener('toggle', () => onDetailsChange(trace.open));
    view = { identity, outcome, answer, trace, body, entries: [], messages: [], run, origin, model };
    const current = view;
    const exports = exportBar({
      label: t('agentTranscript_exportThisRun'),
      build: () => agentReport(current.run, { origin: current.origin, model: current.model }),
      note: t('agentTranscript_aTraceHoldsTheGoal'),
    });
    root.replaceChildren(outcome, answer, ...caveats(run), trace, exports);
    views.set(root, view);
  }
  Object.assign(view, { run, origin, model });
  const nodes = [statusLine(run)];
  // Historical runs name the model/provider they used, independent of current settings.
  const modelUsed = run.model ?? model;
  if (modelUsed) nodes.push(el('p', { class: 'field-desc ag-used-model', text: t('agentTranscript_modelUsed', [modelUsed]) }));
  if (run.error) nodes.push(el('p', { class: 'field-note', text: run.error }));

  // The honest account of an interruption: what happened, what it cost, and why it is not
  // simply restarted for you.
  if (run.status === STATUS.interrupted) {
    nodes.push(el('p', {
      class: 'field-note',
      text: t('agentTranscript_chromeStoppedTheExtensionS'),
    }));
  }
  if (run.status === STATUS.callingModel) nodes.push(waiting(t('agentTranscript_askingTheModel')));
  // A declarative form may wait for a person; "Running tools" alone would read as a hang (form-wait.js).
  const forms = awaitingForms(run);
  if (forms.length) nodes.push(waiting(t('agentTranscript_waitingForForm', [forms.join(', ')])));
  else if (run.status === STATUS.runningTools) nodes.push(waiting(t('agentTranscript_runningTools')));
  view.outcome.replaceChildren(...nodes);

  // A conversation shows every question and answer. The exact tool trace stays folded;
  // hiding earlier messages there made a saved conversation look like a single response.
  const messages = run.transcript.filter(entry =>
    (entry.role === 'user' || entry.role === 'assistant') && entry.text?.trim());
  messages.forEach((entry, index) => {
    const signature = JSON.stringify(entry);
    if (view.messages[index]?.signature === signature) return;
    const node = turn(t(entry.role === 'user' ? 'agentTranscript_you' : 'agentTranscript_explorer'),
      entry.text, entry.role === 'user' ? 'ag-goal' : 'ag-model');
    if (view.messages[index]) view.messages[index].node.replaceWith(node);
    else view.answer.append(node);
    view.messages[index] = { signature, node };
  });
  while (view.messages.length > messages.length) view.messages.pop().node.remove();
  view.answer.hidden = !messages.length;

  run.transcript.forEach((entry, index) => {
    const signature = JSON.stringify(entry);
    if (view.entries[index]?.signature === signature) return;
    const node = el('div');
    if (entry.role === 'user') node.append(turn(t('agentTranscript_goal'), entry.text, 'ag-goal'));
    else if (entry.role === 'assistant') node.append(...assistantTurn(entry));
    else if (entry.role === 'tool') node.append(toolTurn(entry));
    if (view.entries[index]) view.entries[index].node.replaceWith(node);
    else view.body.append(node);
    view.entries[index] = { signature, node };
  });
  while (view.entries.length > run.transcript.length) view.entries.pop().node.remove();
}

function statusLine(run) {
  const stats = runStats(run);
  const chips = [];

  if (isFinished(run)) {
    const kind = run.status === STATUS.failed ? 'danger'
      : run.doneReason === DONE_REASON.answered ? 'ok' : 'warn';
    chips.push(badge(doneText(run.doneReason) ?? run.status, kind,
      run.status === STATUS.interrupted
        ? t('agentTranscript_chromeStoppedTheExtensionS2')
        : null));
  } else {
    chips.push(badge(t('agentTranscript_running'), 'accent'));
  }

  chips.push(badge(stats.steps === 1
    ? t('agentTranscript_oneModelTurn') : t('agentTranscript_nModelTurns', [String(stats.steps)]), 'accent',
    t('agentTranscript_budgetSteps', [String(run.maxSteps)])));
  chips.push(badge(stats.toolCalls === 1
    ? t('agentTranscript_oneToolCall') : t('agentTranscript_nToolCalls', [String(stats.toolCalls)]), 'accent',
    t('agentTranscript_budgetCalls', [String(run.maxToolCalls)])));
  if (stats.failedToolCalls) {
    chips.push(badge(t('agentTranscript_nFailed', [String(stats.failedToolCalls)]), 'danger',
      t('agentTranscript_nFailedHelp')));
  }
  if (stats.mockedToolCalls) {
    chips.push(badge(t('agentTranscript_nMocked', [String(stats.mockedToolCalls)]), 'warn',
      t('agentTranscript_nMockedHelp')));
  }
  if (stats.usage.input || stats.usage.output) {
    chips.push(badge(t('agentTranscript_tokens', [String(stats.usage.input), String(stats.usage.output)]), 'accent',
      t('agentTranscript_tokensHelp')));
  }

  return el('div', { class: 'card-meta' }, chips);
}

// What the model was NOT told. Without this the developer cannot tell "the model ignored my
// tool" from "Explorer never offered it".
function caveats(run) {
  const nodes = [];

  if (run.excluded?.length) {
    const box = el('details', { class: 'tree-raw' });
    box.append(el('summary', {
      title: t('help_excludedTools'),
      text: run.excluded.length === 1
        ? t('agentTranscript_oneToolWasNotOffered')
        : t('agentTranscript_nToolsWereNotOffered', [String(run.excluded.length)]),
    }));
    for (const item of run.excluded) {
      box.append(el('p', {
        class: 'field-desc',
        text: t('agentTranscript_nameDashReason', [item.name, excludedText(item.reason) ?? item.reason])
          + (item.detail ? t('agentTranscript_parenDetail', [String(item.detail)]) : ''),
      }));
    }
    nodes.push(box);
  }

  if (run.renamed?.length) {
    const box = el('details', { class: 'tree-raw' });
    box.append(el('summary', {
      title: t('help_renamedTools'),
      // Two messages rather than a suffix: plural rules are a translator's, not a ternary's.
      text: run.renamed.length === 1
        ? t('agentTranscript_oneToolNameWasChanged')
        : t('agentTranscript_nToolNamesWereChanged', [String(run.renamed.length)]),
    }));
    for (const item of run.renamed) {
      box.append(el('p', {
        class: 'field-desc',
        text: t('agentTranscript_renamedItem', [item.name, item.alias, item.reason === 'duplicate-name'
          ? t('agentTranscript_anotherToolAlreadyUsesThat')
          : t('agentTranscript_theApiRejectsTheseCharacters')]),
      }));
    }
    nodes.push(box);
  }

  if (run.adapted?.length) {
    const box = el('details', { class: 'tree-raw' });
    box.append(el('summary', {
      title: t('help_adaptedTools'),
      text: run.adapted.length === 1
        ? t('agentTranscript_oneToolSchemaWasAdapted')
        : t('agentTranscript_nToolSchemasWereAdapted', [String(run.adapted.length)]),
    }));
    for (const item of run.adapted) {
      box.append(el('p', {
        class: 'field-desc',
        text: t('agentTranscript_adaptedItem', [item.name, item.rule ?? t('agentTranscript_adaptedRootOnly')]),
      }));
    }
    nodes.push(box);
  }

  return nodes;
}

function assistantTurn(entry) {
  const nodes = [];
  if (entry.text) nodes.push(turn(t('agentTranscript_model'), entry.text, 'ag-model'));
  for (const call of entry.calls ?? []) {
    nodes.push(el('div', { class: 'ag-turn ag-call' }, [
      el('p', { class: 'ag-role', text: t('agentTranscript_calls') }),
      el('p', { class: 'card-name', text: call.alias }),
      el('pre', { class: 'result-body mono', text: JSON.stringify(call.args ?? {}, null, 1) }),
    ]));
  }
  return nodes;
}

function toolTurn(entry) {
  const chips = [];
  chips.push(entry.ok
    ? badge(t('common_ok'), 'ok')
    : badge(t('common_error'), 'danger', t('agentTranscript_errorHelp')));
  if (entry.mocked) {
    chips.push(badge(t('agentTranscript_mocked'), 'warn', t('agentTranscript_mockedHelp')));
  }
  if (Number.isFinite(entry.durationMs)) {
    chips.push(badge(t('common_ms', [String(entry.durationMs)]), 'accent', t('agentTranscript_measuredInPage')));
  }

  return el('div', { class: 'ag-turn ag-result' }, [
    el('p', { class: 'ag-role', text: t('agentTranscript_result1', [String(entry.alias)]) }),
    el('div', { class: 'card-meta' }, chips),
    el('pre', { class: 'result-body mono', text: entry.text || t('snapshots_empty') }),
  ]);
}

function turn(role, text, className) {
  return el('div', { class: `ag-turn ${className}` }, [
    el('p', { class: 'ag-role', text: role }),
    className === 'ag-model' ? renderMarkdown(text) : el('p', { class: 'ag-text', text }),
  ]);
}

function waiting(text) {
  return el('p', { class: 'field-desc ag-waiting', text });
}

function buildStarters(tools, onPickStarter) {
  if (!Array.isArray(tools) || !tools.length || typeof onPickStarter !== 'function') return null;
  const row = el('div', { class: 'ag-starters' });
  const addChip = (label, prompt) => {
    const btn = el('button', {
      type: 'button',
      class: 'ag-starter-chip',
      text: label,
      title: t('agent_starterHelp'),
    });
    btn.addEventListener('click', () => onPickStarter(prompt));
    row.append(btn);
  };
  addChip(t('agent_starterSummarize'), t('agent_starterSummarizePrompt'));
  const sorted = [...tools].sort((a, b) => (
    (b.annotations?.readOnlyHint === true ? 1 : 0) - (a.annotations?.readOnlyHint === true ? 1 : 0)
  ));
  for (const tool of sorted.slice(0, 2)) {
    const desc = (tool.description ?? '').trim().replace(/\.$/, '');
    const prompt = desc ? `${desc} (${tool.name}).` : t('agent_starterTryToolPrompt', [tool.name]);
    addChip(t('agent_starterTryTool', [tool.name]), prompt);
  }
  return row;
}
