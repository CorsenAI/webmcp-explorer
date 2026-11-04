// The Evals screen: run a set of goals against this page and see which tools the model
// reaches for — then change a description and run the same set again.
//
// This is the answer to the question the Mock Lab raises and cannot settle on its own: not
// "can I rewrite this description?" but "did rewriting it change what the model does?".

import { el, badge, t } from '../dom.js';
import { renderSuiteEditor } from './evals-editor.js';
import { createCase } from '../../core/evals/suite.js';
import { renderResults } from './evals-results.js';
import { loadPanelState, savePanelTabState } from '../../storage/ui-state.js';
import { networkNotice } from '../components/network-notice.js';
import { configProblems } from '../../core/agent/providers.js';
import { FORM_WAIT_MS } from '../../core/agent/form-wait.js';

export async function renderEvals(root, { tabId, tools, topOrigin }) {
  const editorHost = el('div');
  const resultsHost = el('div', { class: 'ev-results' });
  const progressHost = el('div');

  const picker = el('select', { id: 'ev-suite', title: t('evals_whichSuiteToRun') });
  const label = el('input', {
    type: 'text', id: 'ev-label',
    placeholder: t('evals_labelThisRunBeforeRewrite'),
  });

  const runButton = el('button', { class: 'primary', text: t('evals_runSuite') });
  const noticeHost = el('div', { class: 'nn-host' });
  let agentSetup = { config: null, providers: [], key: { hasKey: false } };
  const cancelButton = el('button', { text: t('agent_cancel'), title: t('evals_stopNow') });
  const newButton = el('button', { text: t('evals_new'), title: t('evals_anEmptySuite') });
  const fromPage = el('button', {
    text: t('evals_fromThisPage'),
    title: t('evals_oneCasePerToolEach'),
  });
  const deleteButton = el('button', { text: t('evals_delete'), title: t('evals_deleteThisSuiteAndIts') });

  let suites = [];
  let suite = null;
  let problems = [];
  let results = [];
  let running = false;
  // Refreshes the editor's warnings in place. Rebuilding the editor on every edit would take
  // the focus out of the control the user is working in (D-027).
  let refreshWarnings = () => {};
  // Saves are serialised: two edits made moments apart must both survive, and the second must
  // start from the result of the first.
  let saving = Promise.resolve();

  const onMessage = (msg) => {
    if (msg?.type !== 'evals-update' || msg.tabId !== tabId) return;
    showProgress(msg.progress);
  };
  chrome.runtime.onMessage.addListener(onMessage);
  root.addEventListener('explorer:teardown', () => {
    chrome.runtime.onMessage.removeListener(onMessage);
  }, { once: true });

  picker.addEventListener('change', () => selectSuite(picker.value));
  newButton.addEventListener('click', async () => {
    const created = await chrome.runtime.sendMessage({
      type: 'evals-suite-new', name: t('evals_newSuite'), origin: topOrigin,
    });
    await refresh(created.id);
  });
  fromPage.addEventListener('click', async () => {
    const created = await chrome.runtime.sendMessage({
      type: 'evals-suite-new', fromTools: true, tools, origin: topOrigin,
    });
    await refresh(created.id);
  });
  deleteButton.addEventListener('click', async () => {
    if (!suite) return;
    await chrome.runtime.sendMessage({ type: 'evals-suite-delete', suiteId: suite.id });
    await refresh(null);
  });

  runButton.addEventListener('click', async () => {
    if (!suite) return;
    running = true;
    paint();
    const out = await chrome.runtime.sendMessage({
      type: 'evals-run',
      tabId,
      suiteId: suite.id,
      tools,
      topOrigin,
      label: label.value.trim() || null,
    });
    running = false;
    progressHost.replaceChildren();
    if (out?.error) {
      progressHost.replaceChildren(el('p', { class: 'field-note', text: out.error }));
    }
    await loadResults();
    paint();
  });

  cancelButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'evals-cancel', tabId });
  });

  root.replaceChildren(
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'ev-suite', text: t('evals_suite') }),
      picker,
      el('div', { class: 'row-inline' }, [newButton, fromPage, deleteButton]),
    ]),
    editorHost,
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'ev-label', text: t('evals_runLabel') }),
      label,
      el('p', {
        class: 'field-desc',
        text: t('evals_labelsAreWhatMakeThe'),
      }),
    ]),
    noticeHost,
    el('div', { class: 'form-actions' }, [runButton, cancelButton]),
    progressHost,
    resultsHost,
  );

  // The suite runs through the Agent Lab's configuration, so the disclosure and the refusal
  // of an unsafe endpoint are the same as there.
  agentSetup = await chrome.runtime.sendMessage({ type: 'agent-config' }) ?? agentSetup;
  const onSetupChanged = (msg) => {
    if (msg?.type !== 'agent-config-changed') return;
    chrome.runtime.sendMessage({ type: 'agent-config' }).then((data) => {
      if (data) { agentSetup = data; paint(); }
    });
  };
  chrome.runtime.onMessage.addListener(onSetupChanged);
  root.addEventListener('explorer:teardown', () => {
    chrome.runtime.onMessage.removeListener(onSetupChanged);
  }, { once: true });

  const saved = await loadPanelState(tabId);
  if (saved.tab.evalLabel) label.value = saved.tab.evalLabel;
  let labelTimer = null;
  label.addEventListener('input', () => {
    clearTimeout(labelTimer);
    labelTimer = setTimeout(() => savePanelTabState(tabId, { evalLabel: label.value }), 400);
  });

  await refresh(saved.tab.evalSuiteId ?? null);

  // A suite started before the panel was closed is still running in the service worker. Ask
  // for its progress rather than waiting for the next broadcast, which may be a minute away.
  const inFlight = await chrome.runtime.sendMessage({ type: 'evals-progress', tabId });
  if (inFlight?.progress) {
    running = !inFlight.progress.interrupted && !inFlight.progress.finishedAt;
    showProgress(inFlight.progress);
    paint();
  }

  async function refresh(preferredId) {
    suites = await chrome.runtime.sendMessage({ type: 'evals-suites' }) ?? [];
    // A remembered suite may have been deleted since. Falling back to one that exists beats
    // an empty state beside a picker full of suites (found while composing the Store shots).
    const exists = (id) => id !== null && id !== undefined && suites.some((item) => item.id === id);
    const wanted = [preferredId, suite?.id, suites[0]?.id].find(exists) ?? null;
    picker.replaceChildren(...suites.map((item) => {
      const option = el('option', { value: item.id, text: item.name });
      if (item.id === wanted) option.selected = true;
      return option;
    }));
    await selectSuite(wanted);
  }

  async function selectSuite(id) {
    suite = suites.find((item) => item.id === id) ?? null;
    savePanelTabState(tabId, { evalSuiteId: suite?.id ?? null });
    if (!suite) {
      editorHost.replaceChildren(el('p', {
        class: 'muted',
        text: t('evals_noSuiteYetStartFrom'),
      }));
      results = [];
      paint();
      return;
    }
    buildEditor();
    await recheck();
    await loadResults();
    paint();
  }

  function buildEditor() {
    refreshWarnings = renderSuiteEditor(editorHost, {
      suite,
      tools,
      onRename: (name) => edit((current) => ({ ...current, name })),
      // Each control reports only its own change; it is applied here to the live suite, so
      // two edits in quick succession cannot overwrite each other.
      onEdit: (index, patch) => edit((current) => ({
        ...current,
        cases: current.cases.map((c, i) => (i === index ? { ...c, ...patch } : c)),
      })),
      onRemove: (index) => edit(
        (current) => ({ ...current, cases: current.cases.filter((_, i) => i !== index) }),
        { rebuild: true }),
      onAdd: () => edit(
        (current) => ({ ...current, cases: [...current.cases, createCase({ expectFirst: true })] }),
        { rebuild: true }),
    });
    refreshWarnings(problems);
  }

  // Adding or removing a case changes the structure, so the editor is rebuilt then — and only
  // then. Editing a field never rebuilds it.
  function edit(apply, { rebuild = false } = {}) {
    suite = apply(suite);
    const snapshot = suite;
    saving = saving.then(async () => {
      await chrome.runtime.sendMessage({ type: 'evals-suite-save', suite: snapshot });
      await recheck();
      if (rebuild) buildEditor();
      paint();
    });
    return saving;
  }

  async function recheck() {
    const check = await chrome.runtime.sendMessage({ type: 'evals-check', suiteId: suite.id });
    problems = check?.problems ?? [];
    refreshWarnings(problems);
  }

  async function loadResults() {
    results = suite
      ? await chrome.runtime.sendMessage({ type: 'evals-results', suiteId: suite.id }) ?? []
      : [];
  }

  function showProgress(progress) {
    if (!progress) {
      progressHost.replaceChildren();
      return;
    }
    if (progress.interrupted) {
      progressHost.replaceChildren(
        el('div', { class: 'card-meta' }, [
          badge(t('evals_interrupted'), 'danger', t('evals_interruptedHelp')),
          badge(t('evals_runsDone', [String(progress.done), String(progress.total)]), 'accent'),
        ]),
        el('p', {
          class: 'field-note',
          text: t('evals_chromeStoppedTheExtensionS'),
        }),
      );
      running = false;
      return;
    }

    const line = progress.currentCase
      ? t('evals_attemptGoal', [String(progress.currentCase.attempt), String(progress.currentCase.goal)])
      : t('evals_starting');
    progressHost.replaceChildren(
      el('div', { class: 'card-meta' }, [
        badge(t('evals_runs', [String(progress.done), String(progress.total)]), 'accent'),
        progress.unknownTools?.length
          ? badge(t('evals_unknownToolsCount', [String(progress.unknownTools.length)]), 'warn',
            progress.unknownTools.join(', '))
          : null,
      ]),
      el('p', { class: 'field-desc ag-waiting', text: line }),
      // A declarative form waits for a person; the suite says so instead of looking hung (form-wait.js).
      ...(progress.awaitingForms?.length
        ? [el('p', { class: 'field-note', role: 'status', text: t('evals_waitingForForm', [
          progress.awaitingForms.join(', '), String(Math.round(FORM_WAIT_MS / 1000))]) })]
        : []),
    );
  }

  function paint() {
    // A suite that checks nothing would pass whatever the model did, so running it is worse
    // than not running it.
    const provider = agentSetup.providers?.find((p) => p.id === agentSetup.config?.providerId) ?? null;
    const setupProblems = agentSetup.config
      ? configProblems({ ...agentSetup.config, hasKey: agentSetup.key?.hasKey, provider })
      : [];
    const manual = provider?.manual;
    const blocked = !suite || problems.length > 0 || setupProblems.length > 0 || manual;
    runButton.disabled = running || blocked;
    runButton.title = manual
      ? t('evals_manualModeCannotRunA')
      : setupProblems.length
        ? t('evals_fixModelSetup', [setupProblems.join(', ')])
        : problems.length
          ? t('evals_fixTheFlaggedCasesFirst')
          : t('evals_runEveryCaseEveryAttempt');
    noticeHost.replaceChildren(networkNotice({
      config: agentSetup.config, providers: agentSetup.providers ?? [], subject: t('evals_runSuite'),
    }));
    cancelButton.disabled = !running;
    deleteButton.disabled = !suite;

    renderResults(resultsHost, {
      result: results[0] ?? null,
      comparison: paint.comparison ?? null,
      before: paint.before ?? null,
      after: paint.after ?? null,
      onCompare: results.length >= 2 ? compare : null,
      // The page's tools as they are now, so a result judged against a contract that has since
      // moved says so (core/evals/stale.js).
      currentTools: tools,
    });
  }

  async function compare() {
    const out = await chrome.runtime.sendMessage({ type: 'evals-compare', suiteId: suite.id });
    if (out?.error) {
      progressHost.replaceChildren(el('p', { class: 'field-note', text: out.error }));
      return;
    }
    paint.comparison = out.comparison;
    paint.before = out.before;
    paint.after = out.after;
    paint();
  }
}
