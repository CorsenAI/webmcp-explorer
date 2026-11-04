// The tool detail screen: frozen identity header, tabbed action area, sticky action bar.
// After a run the form collapses to one summary line so the result gets the whole column
// (D-013) — a permanent split would cut 400px into two unusable halves.

import { el, badge, t } from '../dom.js';
import { validateArguments } from '../../core/schema/validate.js';
import { createToolArguments } from './tool-arguments.js';
import { renderSchemaTree } from '../components/schema-tree.js';
import { renderToolSource } from './tool-source.js';
import { renderToolHistory } from './tool-history.js';
import { renderToolOverride } from './tool-override.js';
import { renderSavedCalls } from './tool-saved-calls.js';
import { renderToolChecks } from './tool-checks.js';
import { renderToolSecurity } from './tool-security.js';
import { replayability } from '../../core/history.js';
import { renderResult } from './tool-result.js';
import { resultActions, reproductionBar } from './tool-reproduction.js';
import { scriptToolConfig, registerToolSnippet } from '../../core/export/repro.js';

function annotationLabel(key) {
  const map = {
    readOnlyHint: t('toolDetails_readOnly'),
    consequentialHint: t('toolDetails_consequential'),
    untrustedContentHint: t('toolDetails_untrustedContent'),
    debugging: t('toolDetails_debugging'),
  };
  return map[key] ?? key;
}

const ANNOTATION_KIND = {
  readOnlyHint: 'accent',
  consequentialHint: 'warn',
  untrustedContentHint: 'warn',
  debugging: 'accent',
};

function callId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function renderToolDetails(root, { tool, tabId, topOrigin, currentTools, url = null,
  onBack, onOverrideChanged = () => {}, onRecipe = null }) {
  const editor = createToolArguments(tool.inputSchema);
  const model = editor.model;
  const savedDraft = {};
  const state = {
    tab: 'run',
    values: editor.initialValues,
    result: null,
    running: false,
    // The id of the call in flight, so the Cancel button can name it (L-17 lifted).
    callId: null,
    cancelling: false,
    history: null,
    override: null,
  };

  root.replaceChildren();
  const header = el('div', { class: 'detail-header' });
  const body = el('div', { class: 'detail-body' });
  const footer = el('div', { class: 'detail-footer' });
  root.append(header, body, footer);

  // The footer's controls are built once and then synchronised in place (D-027): a Run button
  // rebuilt at the moment it is pressed would take the keyboard focus with it. Cancel is always
  // there and hidden when there is nothing to cancel, so nothing is inserted or removed around
  // the focused button either.
  const controls = {
    run: el('button', { class: 'primary', title: t('toolDetails_executeThisToolInIts') }),
    cancel: el('button', { class: 'cancel-call', title: t('toolDetails_cancelHelp'), hidden: '' }),
    error: el('p', { class: 'field-note error', hidden: '' }),
    // A declarative form without toolautosubmit is filled in by the browser and then waits for
    // a person to submit it (measured on Chrome 152, WMP-0029). "Running…" alone would read as
    // a hang, so the wait is announced where the button is.
    note: tool.registrationType === 'declarative' && tool.autoSubmit !== true
      ? el('p', { class: 'field-note', text: t('toolDetails_declarativeWaits') })
      : null,
  };
  controls.run.addEventListener('click', execute);
  controls.cancel.addEventListener('click', cancel);

  renderHeader();
  renderBody();
  renderFooter();

  function renderHeader() {
    const back = el('button', {
      class: 'icon-button', title: t('toolDetails_backToTheToolList'), 'aria-label': t('toolDetails_backToTheToolList'), text: '←',
    });
    back.addEventListener('click', onBack);

    const meta = [tool.origin];
    if (tool.frameId !== null) meta.push(t('common_frameN', [String(tool.frameId)]));
    if (tool.registrationType !== 'unknown') meta.push(tool.registrationType);
    if (tool.autoSubmit === true) meta.push(t('toolDetails_autoSubmit'));

    const badges = el('div', { class: 'card-meta' });
    if (tool.inventoryOnly) badges.append(badge(t('emulation_inventoryOnly'),'warn',t('emulation_inventoryHelp')));
    if (tool.schemaSource === 'inferred-html') badges.append(badge(t('emulation_inferred'),'warn',t('emulation_inventoryHelp')));
    if (tool.overridden) {
      badges.append(badge(t('toolDetails_overridden'), 'warn', t('toolDetails_overriddenHelp')));
    }
    if (tool.disabled) {
      badges.append(badge(t('toolDetails_disabled'), 'danger', t('toolDetails_disabledHelp')));
    }
    for (const [key, value] of Object.entries(tool.annotations ?? {})) {
      if (value !== true) continue;
      badges.append(badge(annotationLabel(key), ANNOTATION_KIND[key] ?? 'accent',
        t('annotationDeclaredHelp')));
    }

    // replaceChildren() turns a null into the text "null": only real nodes go in.
    header.replaceChildren(...[
      el('div', { class: 'detail-title' }, [back, el('h2', { class: 'card-name', text: tool.name })]),
      tool.title && tool.title !== tool.name
        ? el('p', { class: 'card-title', text: tool.title, title: t('tools_titleHelp') })
        : null,
      el('p', { class: 'card-origin', text: meta.join(' · ') }),
      badges.childElementCount ? badges : null,
      tool.description ? el('p', { class: 'card-desc', text: tool.description }) : null,
    ].filter(Boolean));
  }

  function tabButton(id, label) {
    const button = el('button', {
      class: state.tab === id ? 'tab tab-active' : 'tab',
      text: label,
      title: t(`help_detail_${id}`),
      'data-detail-tab': id,
      'aria-pressed': String(state.tab === id),
    });
    button.addEventListener('click', () => {
      state.tab = id;
      renderBody();
      renderFooter();
      body.querySelector(`[data-detail-tab="${id}"]`)?.focus({ preventScroll: true });
    });
    return button;
  }

  function renderBody() {
    const tabs = el('div', { class: 'tabs' }, [
      tabButton('run', t('toolDetails_tabRun')),
      tabButton('schema', t('toolDetails_tabSchema')),
      tabButton('history', t('toolDetails_tabHistory')),
      tabButton('override', t('toolDetails_tabOverride')),
    ]);

    if (state.tab === 'run' && model.fields.length > 0) {
      const toggle = el('button', {
        class: 'link-button mono',
        text: editor.mode === 'form' ? t('toolDetails_json') : t('toolDetails_form'),
        title: editor.mode === 'form'
          ? t('toolDetails_editTheArgumentsAsRaw')
          : t('toolDetails_goBackToTheGenerated'),
      });
      toggle.disabled = !model.renderable && editor.mode === 'json';
      if (!model.renderable) {
        toggle.title = t('toolDetails_schemaNotRenderable');
      }
      toggle.addEventListener('click', () => {
        const error = editor.toggle();
        if (error) { showError(error); return; }
        controls.error.hidden = true;
        renderBody();
        body.querySelector('.tabs .link-button')?.focus({ preventScroll: true });
      });
      tabs.append(toggle);
    }

    body.replaceChildren(tabs);

    if (state.tab === 'schema') {
      body.append(renderSchemaTree(tool.inputSchema));
      const copyStatus = el('span', { class: 'field-note' });
      const copyCfg = el('button', {
        type: 'button',
        class: 'schema-copy-cfg',
        text: t('toolDetails_copyScriptToolConfig'),
        title: t('toolDetails_copyScriptToolConfigHelp'),
      });
      copyCfg.addEventListener('click', async () => {
        await navigator.clipboard?.writeText?.(scriptToolConfig(tool));
        copyStatus.textContent = t('exportBar_copied', [t('toolDetails_copyScriptToolConfig')]);
      });
      const copyReg = el('button', {
        type: 'button',
        class: 'schema-copy-reg',
        text: t('toolDetails_copyRegisterTool'),
        title: t('toolDetails_copyRegisterToolHelp'),
      });
      copyReg.addEventListener('click', async () => {
        await navigator.clipboard?.writeText?.(registerToolSnippet(tool));
        copyStatus.textContent = t('exportBar_copied', [t('toolDetails_copyRegisterTool')]);
      });
      body.append(el('div', { class: 'row-inline schema-copy-bar' }, [copyCfg, copyReg, copyStatus]));
      // What is missing from the contract belongs right under the contract.
      renderToolChecks(body, { tool, allTools: currentTools ?? [tool] });
      renderToolSecurity(body, { tool, discovery: { topOrigin, tools: currentTools ?? [tool], frames: [], completeness: {}, unreachableFrames: [] } });
      // Where the schema came from belongs beside the schema itself.
      renderToolSource(body, { tool, url: url ?? topOrigin });
      return;
    }

    if (state.tab === 'history') {
      body.append(el('p', { class: 'muted', text: t('toolDetails_loading') }));
      loadHistory();
      return;
    }

    if (state.tab === 'override') {
      body.append(el('p', { class: 'muted', text: t('toolDetails_loading') }));
      loadOverrideTab();
      return;
    }

    if (state.result) {
      body.append(resultSummary());
      if (state.result.code !== 'cancelled') body.append(resultActions(body,
        onRecipe ? () => onRecipe(tool, state.result.args ?? state.values, state.result) : null));
      body.append(resultPanel());
    } else {
      body.append(editor.element());
    }

    // Saved calls sit under the arguments they belong to: what to run, and what was run before.
    renderSavedCalls(body, {
      tool, topOrigin, draft: savedDraft,
      currentArguments: () => {
        const editing = body.querySelector('#raw-json') ?? body.querySelector('.form-host');
        return editing ? currentValues() : state.values;
      },
      // The result on screen, for "expect the same result as the last run".
      lastOutcome: () => state.result,
      // A verdict is drawn by rebuilding the body, so it lands in the box as it is now.
      onRerender: () => { renderBody(); renderFooter(); },
      onLoad: (args) => {
        state.values = args;
        editor.reset(args);
        state.result = null;
        renderBody();
        renderFooter();
      },
      onRun: async (args) => {
        state.values = args;
        editor.reset(args);
        state.result = null;
        renderBody();
        await runAndShow(() => runCallOn(tool, args));
        return state.result;
      },
    });
  }

  function currentValues() {
    if (state.tab !== 'run') return null;
    return editor.read().values;
  }

  function resultSummary() {
    const line = el('div', { class: 'result-summary' });
    const count = Object.keys(state.result.args ?? {}).length;
    line.append(el('span', { class: 'muted', text: t('toolDetails_1Params', [String(count)]) }));
    const edit = el('button', { class: 'link-button', text: t('toolDetails_edit'), title: t('toolDetails_changeTheArgumentsAndRun') });
    edit.addEventListener('click', () => {
      state.result = null;
      renderBody();
      renderFooter();
    });
    line.append(edit);
    return line;
  }

  function resultPanel() {
    const wrap = el('div', {});
    renderResult(wrap, { result: state.result, tool });
    if (state.result.code !== 'cancelled') wrap.append(reproductionBar({
      tool, outcome: state.result, args: state.values, url, topOrigin,
    }));
    return wrap;
  }

  // Shows the footer for the current tab. Leaving the Run tab empties it; coming back puts the
  // same controls back. While on the Run tab, only syncFooter() touches them.
  function renderFooter() {
    if (state.tab !== 'run') {
      footer.replaceChildren();
      return;
    }
    if (footer.childElementCount === 0) {
      footer.append(controls.run, controls.cancel, controls.error);
      if (controls.note) footer.append(controls.note);
    }
    syncFooter();
  }

  // Updates the controls in place. Cancel shows only while a call is in flight, beside Run.
  function syncFooter() {
    const { run, cancel: cancelButton } = controls;
    run.textContent = state.running
      ? t('toolDetails_running')
      : (state.result ? t('toolDetails_runAgain') : t('toolDetails_runTool'));
    run.disabled = state.running || tool.inventoryOnly;
    if (tool.inventoryOnly) run.title = t('emulation_inventoryHelp');
    cancelButton.hidden = !state.running;
    cancelButton.textContent = state.cancelling ? t('toolDetails_cancelling') : t('toolDetails_cancel');
    cancelButton.disabled = !state.running || state.cancelling || !state.callId;
  }

  function showError(text) {
    controls.error.textContent = text;
    controls.error.hidden = false;
  }

  async function execute() {
    controls.error.hidden = true;
    // Once a result is shown the editor is folded away, and "Run again" means: the same
    // arguments, once more. They were validated when they ran; they are kept in the state.
    // Only when an editor is on screen are its current values read and checked (D-057).
    const editing = body.querySelector('#raw-json') ?? body.querySelector('.form-host');
    const values = editing ? currentValues() : state.values;
    if (values === null || values === undefined) {
      showError(t('toolDetails_theJsonIsNotValid'));
      return;
    }

    if (editing) {
      const read = editor.read();
      if (read.errors.length > 0) {
        showError(read.errors[0].message);
        return;
      }
    }

    const check = validateArguments(tool.inputSchema, values);
    if (!check.valid) {
      showError(check.errors[0].message);
      return;
    }

    state.values = values;
    await runAndShow(() => runCallOn(tool, values));
  }

  function cancel() {
    if (!state.callId || state.cancelling || !state.running) return;
    state.cancelling = true;
    syncFooter();
    chrome.runtime.sendMessage({ type: 'run-cancel', tabId, callId: state.callId })
      .catch(() => {});
  }

  // Runs a call and keeps the footer truthful for its duration — Running… plus Cancel — then
  // paints the result.
  async function runAndShow(start) {
    state.running = true;
    state.cancelling = false;
    syncFooter();
    try {
      state.result = await start();
    } catch (cause) {
      state.result = { ok: false, code: 'message-failed', error: String(cause?.message ?? cause), roundTripMs: 0 };
    } finally {
      state.running = false;
      state.cancelling = false;
      state.callId = null;
      renderBody();
      renderFooter();
    }
  }

  // The target is explicit: a replay runs against the instance the history resolved, which may
  // be another frame than the one this screen was opened on (D-057).
  async function runCallOn(target, values) {
    if (target.inventoryOnly) return {ok:false,code:'inventory-only',error:t('emulation_inventoryHelp')};
    const id = callId();
    state.callId = id;
    // The Cancel button is only useful once it knows the id.
    if (state.running) syncFooter();
    return chrome.runtime.sendMessage({
      type: 'run',
      tabId,
      call: {
        frameId: target.frameId,
        documentId: target.documentId,
        toolName: target.name,
        origin: target.origin,
        args: values,
        tool: target,
        topOrigin,
        callId: id,
      },
    });
  }

  async function loadOverrideTab() {
    const all = await chrome.runtime.sendMessage({ type: 'overrides-list' });
    if (state.tab !== 'override') return;
    const existing = Array.isArray(all)
      ? all.find((o) => o.logicalId === tool.logicalId) ?? null
      : null;
    body.replaceChildren(body.firstChild);
    const host = el('div', {});
    body.append(host);
    renderToolOverride(host, {
      tool,
      existing,
      onSaved: () => onOverrideChanged(),
      onRemoved: () => onOverrideChanged(),
    });
  }

  async function loadHistory() {
    const entries = await chrome.runtime.sendMessage({
      type: 'history', logicalId: tool.logicalId, limit: 100,
    });
    if (state.tab !== 'history') return;
    state.history = Array.isArray(entries) ? entries : [];
    body.replaceChildren(body.firstChild);
    const host = el('div', {});
    body.append(host);
    renderToolHistory(host, {
      entries: state.history,
      tool,
      currentTools: currentTools ?? [tool],
      page: { url: url ?? topOrigin, topOrigin },
      onReplay: async (entry) => {
        // Resolved once, here, from the same function the row used to render its verdict, so
        // what was judged is what runs. The button is disabled when there is no target.
        const verdict = replayability(entry, currentTools ?? [tool]);
        if (!verdict.canReplay || !verdict.target) return;
        state.values = entry.args;
        editor.reset(entry.args);
        state.tab = 'run';
        state.result = null;
        renderFooter();
        await runAndShow(() => runCallOn(verdict.target, entry.args));
      },
      onClear: async () => {
        await chrome.runtime.sendMessage({ type: 'history-clear' });
        state.history = [];
        renderBody();
      },
    });
  }
}
