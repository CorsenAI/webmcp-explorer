// Checks on a site the person declared they control: the active probes (S2), the one part of the
// Security section that calls tools, and the provider-key search in page scripts (WMCP-SEC-013),
// which calls none. The gate is explicit and in the page: a confirmation per origin; for probes, a
// tool selection where only read-only tools are preselected and a disclosure that says what will
// run before the button that runs it (D-052). Progress and stop are real; every probe call is
// recorded in History. The key search keeps the provider, type and length, never a value.

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
  if (!origin) return box;

  const send = (m) => chrome.runtime.sendMessage(m).catch((e) => ({ error: String(e?.message ?? e) }));
  const state = { consent: false, running: false, scanning: false, probeFindings: [], secretFindings: [],
    selected: new Set(tools.filter(preselectable).map((tool) => tool.instanceId)) };
  // The review receives both kinds together, whichever ran last.
  const publish = (out) => onFindings([...state.probeFindings, ...state.secretFindings], out);

  const consent = el('input', { type: 'checkbox', id: 'sp-consent', title: t('probes_consentHelp') });
  const consentRow = el('label', { class: 'field-label', for: 'sp-consent' }, [consent, el('span', { text: ` ${t('probes_consent', [origin])}` })]);
  consent.addEventListener('change', async () => {
    const out = await send({ type: 'security-controlled-set', origin, on: consent.checked });
    state.consent = out?.controlled === true;
    consent.checked = state.consent;
    sync();
  });
  box.append(consentRow);

  const disclosure = el('p', { class: 'field-desc nn-notice' });
  const run = el('button', { class: 'primary', text: t('probes_run'), title: t('probes_runHelp') });
  const stop = el('button', { class: 'cancel-call', text: t('probes_stop'), title: t('probes_stopHelp'), hidden: '' });
  const progress = el('p', { class: 'field-note', hidden: '' });
  const status = el('p', { class: 'field-note', hidden: '' });
  const results = el('div', {});
  if (tools.length) {
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
    box.append(list, disclosure, el('div', { class: 'row-inline' }, [run, stop]), progress, status, results);
  }

  // WMCP-SEC-013: provider keys in the page's scripts. No tool is called.
  const scan = el('button', { class: 'sp-secrets-run', text: t('secrets_run'), title: t('secrets_runHelp') });
  const scanStatus = el('p', { class: 'field-note sp-secrets-status', hidden: '' });
  const scanResults = el('div', { class: 'sp-secrets-results' });
  box.append(el('div', { class: 'sp-secrets' }, [
    el('p', { class: 'field-group', text: t('secrets_title') }),
    el('p', { class: 'field-desc', text: t('secrets_intro') }),
    el('div', { class: 'row-inline' }, [scan]), scanStatus, scanResults,
  ]));

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
    state.probeFindings = findings;
    publish(out);
  });
  stop.addEventListener('click', () => { send({ type: 'security-probe-stop', tabId }); });

  scan.addEventListener('click', async () => {
    if (!state.consent || state.scanning) return;
    state.scanning = true;
    scanStatus.hidden = true;
    scanResults.replaceChildren();
    sync();
    const out = await send({ type: 'security-secrets-scan', tabId, topOrigin: origin });
    state.scanning = false;
    sync();
    scanStatus.hidden = false;
    if (out?.error) {
      scanStatus.textContent = out.code === 'consent-required' ? t('secrets_consentRequired') : t('secrets_failed', [String(out.error)]);
      return;
    }
    const found = out.findings ?? [];
    const read = [String(out.scanned?.inline ?? 0), String(out.scanned?.files ?? 0)];
    scanStatus.textContent = found.length ? t('secrets_done', [...read, String(found.length)]) : t('secrets_none', read);
    scanResults.replaceChildren(...found.map((f) => renderFinding(f)));
    state.secretFindings = found;
    publish(out);
  });

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
    stop.hidden = !state.running;
    scan.disabled = !state.consent || state.scanning;
  }
}
