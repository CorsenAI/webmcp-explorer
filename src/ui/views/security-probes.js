// Active probes (S2): the one part of the Security section that calls tools, and only on a site
// the person declared they control. The gate is explicit and in the page: a confirmation per
// origin, a tool selection where only read-only tools are preselected, and a disclosure that
// says what will run before the button that runs it (D-052). Progress and stop are real; every
// call is recorded in History as a probe.

import { el, badge, t } from '../dom.js';
import { preselectable } from '../../core/security/probes.js';
import { renderFinding } from './security.js';

export function renderProbes(root, { result, tabId, onFindings = () => {} }) {
  const origin = result?.topOrigin ?? null;
  const tools = (result?.tools ?? []).filter((tool) => !tool.notInjected && !tool.disabled);
  const box = el('details', { class: 'ck-bar sec-probes' }, [
    el('summary', { text: t('probes_title'), title: t('probes_titleHelp') }),
    el('p', { class: 'field-desc', text: t('probes_intro') }),
  ]);
  root.append(box);
  if (!origin || !tools.length) return box;

  const send = (m) => chrome.runtime.sendMessage(m).catch((e) => ({ error: String(e?.message ?? e) }));
  const state = { consent: false, running: false, selected: new Set(tools.filter(preselectable).map((tool) => tool.instanceId)) };

  const consent = el('input', { type: 'checkbox', id: 'sp-consent', title: t('probes_consentHelp') });
  const consentRow = el('label', { class: 'field-label', for: 'sp-consent' }, [consent, el('span', { text: ` ${t('probes_consent', [origin])}` })]);
  consent.addEventListener('change', async () => {
    const out = await send({ type: 'security-controlled-set', origin, on: consent.checked });
    state.consent = out?.controlled === true;
    consent.checked = state.consent;
    sync();
  });

  const list = el('div', {}, [el('p', { class: 'field-group', text: t('probes_tools') })]);
  for (const tool of tools) {
    const input = el('input', { type: 'checkbox', id: `sp-${tool.instanceId}`, title: t('probes_toolHelp') });
    input.checked = state.selected.has(tool.instanceId);
    input.addEventListener('change', () => {
      if (input.checked) state.selected.add(tool.instanceId); else state.selected.delete(tool.instanceId);
      sync();
    });
    const notes = [];
    if (tool.annotations?.consequentialHint === true) notes.push(badge(t('probes_consequential'), 'warn'));
    if (!preselectable(tool)) notes.push(el('span', { class: 'field-note', text: t('probes_notPreselected') }));
    list.append(el('label', { class: 'row-inline sp-tool', for: `sp-${tool.instanceId}` }, [input, el('span', { class: 'mono', text: tool.name }), ...notes]));
  }

  const disclosure = el('p', { class: 'field-desc nn-notice' });
  const run = el('button', { class: 'primary', text: t('probes_run'), title: t('probes_runHelp') });
  const stop = el('button', { class: 'cancel-call', text: t('probes_stop'), title: t('probes_stopHelp'), hidden: '' });
  const progress = el('p', { class: 'field-note', hidden: '' });
  const status = el('p', { class: 'field-note', hidden: '' });
  const results = el('div', {});
  box.append(consentRow, list, disclosure, el('div', { class: 'row-inline' }, [run, stop]), progress, status, results);

  const onProgress = (msg) => {
    if (msg?.type !== 'security-probe-progress' || msg.tabId !== tabId) return;
    if (msg.finished) return;
    progress.hidden = false;
    progress.textContent = t('probes_progress', [String(msg.done), String(msg.total), String(msg.toolName ?? ''), String(msg.probe ?? '')]);
  };
  chrome.runtime.onMessage.addListener(onProgress);
  root.addEventListener('explorer:teardown', () => chrome.runtime.onMessage.removeListener(onProgress), { once: true });

  run.addEventListener('click', async () => {
    const selected = tools.filter((tool) => state.selected.has(tool.instanceId));
    if (!state.consent || !selected.length || state.running) return;
    state.running = true;
    status.hidden = true;
    results.replaceChildren();
    sync();
    const out = await send({ type: 'security-probe-run', tabId, topOrigin: origin, tools: selected });
    state.running = false;
    progress.hidden = true;
    sync();
    if (out?.error) {
      status.hidden = false;
      status.textContent = out.code === 'consent-required' ? t('probes_consentRequired') : (out.code === 'busy' ? t('probes_busy') : out.error);
      return;
    }
    const findings = out.findings ?? [];
    status.hidden = false;
    status.textContent = out.cancelled
      ? t('probes_cancelled', [String(out.done), String(out.total), String(findings.length)])
      : (findings.length ? t('probes_done', [String(out.done), String(findings.length)]) : t('probes_none', [String(out.done)]));
    results.replaceChildren(...findings.map((f) => renderFinding(f)), el('p', { class: 'field-desc', text: t('probes_history') }));
    onFindings(findings, out);
  });
  stop.addEventListener('click', () => { send({ type: 'security-probe-stop', tabId }); });

  send({ type: 'security-controlled-list' }).then((out) => {
    state.consent = Array.isArray(out?.origins) && out.origins.includes(origin);
    consent.checked = state.consent;
    sync();
  });
  sync();
  return box;

  function sync() {
    const count = tools.filter((tool) => state.selected.has(tool.instanceId)).length;
    disclosure.textContent = t('probes_disclosure', [String(count), origin]);
    run.disabled = !state.consent || count === 0 || state.running;
    run.title = run.disabled ? t('probes_runHelp') : t('probes_runHelp');
    stop.hidden = !state.running;
  }
}
