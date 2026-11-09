// Settings: what Explorer may touch, and what it keeps.
//
// Three things live here and nowhere else: the sites Chrome lets Explorer inspect (read from
// Chrome's own grant, the only source of truth — D-014), the sites where Instrumentation Mode is
// on (the one feature that changes a page), and every class of data stored on this device, each
// with the means to delete it. A stored thing the user cannot see or delete from inside the
// product would contradict the privacy policy the Store is given (D-010, D-044).
//
// Deleting asks once more, on the same button, and disarms by itself. A dialog would have been
// the usual answer; a second click on the button the user already found is the shorter one.

import { el, badge, t, UI_LANGUAGES, getUiLanguage, setUiLanguage } from '../dom.js';
import { describeGrants, ALL_SITES_PATTERNS } from '../../core/site-access.js';
import { requestAllSites, removeOrigins, hasOrigin, requestOrigin } from '../../shared/permissions.js';
import { openDemo } from '../../shared/demo.js';
import { renderBridgeSettings } from '../components/bridge.js';
import { renderVaultSettings } from '../components/key-vault.js';
import { renderSettingsBundle } from '../components/settings-bundle.js';

const ARM_MS = 4000;

// A button that asks once more before acting: first click arms it and changes its label,
// the second click within ARM_MS does the deed, silence disarms it.
export function armedButton({ label, armedLabel, help, onConfirm }) {
  const button = el('button', { text: label, title: help });
  let timer = null;
  const disarm = () => {
    clearTimeout(timer);
    timer = null;
    button.textContent = label;
    button.title = help;
    button.classList.remove('armed');
  };
  button.addEventListener('click', async () => {
    if (timer === null) {
      button.textContent = armedLabel;
      button.title = t('settings_confirmHelp');
      button.classList.add('armed');
      timer = setTimeout(disarm, ARM_MS);
      return;
    }
    disarm();
    button.disabled = true;
    try {
      await onConfirm();
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function heading(text, body) {
  return [el('h2', { text }), ...(body ? [el('p', { class: 'field-desc', text: body })] : [])];
}

function row(label, control, meta = null) {
  return el('div', { class: 'st-row' }, [
    el('span', { class: 'st-label', text: label }),
    meta,
    control,
  ]);
}

const items = (n) => (n === 1 ? t('settings_oneItem') : t('settings_items', [String(n)]));

export async function renderSettings(root, { onChanged = () => {} } = {}) {
  const bridgeHost = el('div', { id: 'bridge-settings' });
  const accessHost = el('div');
  const instrumentHost = el('div');
  const dataHost = el('div');
  const agentHost = el('div');
  const vaultHost = el('div');
  const agentAccessHost = el('div');
  const securityHost = el('div');
  const settingsBundleHost = el('div');
  const status = el('p', { class: 'field-note', hidden: '' });
  const error = el('p', { class: 'field-note error', hidden: '' });

  const langSelect = el('select', {
    id: 'st-language',
    title: t('settings_languageHelp'),
    'aria-label': t('settings_languageLabel'),
  }, UI_LANGUAGES.map((entry) => el('option', {
    value: entry.code,
    text: entry.labelKey ? t(entry.labelKey) : entry.label,
  })));
  langSelect.value = getUiLanguage();
  langSelect.addEventListener('change', async () => {
    await setUiLanguage(langSelect.value);
    onChanged();
  });

  const version = chrome.runtime.getManifest?.().version ?? '';
  const demo = el('button', { text: t('openDemo'), title: t('openDemoHelp') });
  demo.addEventListener('click', () => { openDemo(); });

  root.replaceChildren(
    ...heading(t('settings_siteAccess'), t('settings_siteAccessBody')),
    accessHost,
    ...heading(t('settings_sourceFinder'), t('settings_sourceFinderBody')),
    instrumentHost,
    bridgeHost,
    ...heading(t('settings_data'), t('settings_dataBody')),
    dataHost,
    ...heading(t('settings_agentLab'), t('settings_agentLabBody')),
    agentHost,
    vaultHost,
    ...heading(t('settings_agentAccess'), t('settings_agentAccessBody')),
    agentAccessHost,
    ...heading(t('settings_security'), t('settings_securityBody')),
    securityHost,
    ...heading(t('settings_bundle'), t('settings_bundleIntro')),
    settingsBundleHost,
    ...heading(t('settings_languageHeading'), t('settings_languageDesc')),
    row(t('settings_languageLabel'), langSelect),
    status,
    error,
    ...heading(t('settings_about')),
    el('p', { class: 'field-desc', text: t('settings_version', [version]) }),
    el('p', { class: 'field-desc', text: t('settings_noBackend') }),
    el('div', { class: 'row-inline' }, [demo]),
  );

  // Drawn now with what is known, filled in as the answers arrive (D-047).
  accessHost.append(el('p', { class: 'field-desc', text: t('toolDetails_loading') }));
  dataHost.append(el('p', { class: 'field-desc', text: t('toolDetails_loading') }));

  securityHost.append(el('p', { class: 'field-desc', text: t('toolDetails_loading') }));
  await Promise.all([renderBridgeSettings(bridgeHost), refreshAccess(), refreshData(), refreshAgentAccess(), refreshSecurity(), renderVaultSettings(vaultHost)]);

  // The bundle section is self-contained: it reads the worker at click time, never caches.
  renderSettingsBundle(settingsBundleHost, {
    onApplied: () => { refreshData(); onChanged(); },
    onFail: (text) => fail(text),
  });

  function say(text) {
    status.textContent = text;
    status.hidden = false;
    error.hidden = true;
  }

  function fail(text) {
    error.textContent = text;
    error.hidden = false;
  }

  async function refreshAccess() {
    let granted = { origins: [] };
    try {
      granted = await chrome.permissions.getAll();
    } catch (cause) {
      fail(String(cause?.message ?? cause));
    }
    const catalogue = await chrome.runtime.sendMessage({ type: 'agent-config' }).catch(() => null);
    const grants = describeGrants(granted?.origins ?? [], catalogue?.providers ?? []);
    const nodes = [];

    if (grants.allSites) {
      nodes.push(row(t('settings_allSites'), revokeButton(ALL_SITES_PATTERNS, t('settings_allSites'))));
    } else {
      if (grants.all.https) nodes.push(row(t('settings_allHttps'), revokeButton(['https://*/*'], t('settings_allHttps'))));
      if (grants.all.http) nodes.push(row(t('settings_allHttp'), revokeButton(['http://*/*'], t('settings_allHttp'))));
    }
    for (const site of grants.sites) nodes.push(row(site.label, revokeButton([site.pattern], site.label)));
    for (const other of grants.other) nodes.push(row(other.label, revokeButton([other.pattern], other.label)));

    if (!nodes.length) nodes.push(el('p', { class: 'field-desc', text: t('settings_noSites') }));

    if (!grants.allSites) {
      const allow = el('button', { text: t('settings_allowAll'), title: t('settings_allowAllHelp') });
      allow.addEventListener('click', async () => {
        allow.disabled = true;
        try {
          if (await requestAllSites()) {
            await refreshAccess();
            onChanged();
          }
        } catch (cause) {
          fail(String(cause?.message ?? cause));
        } finally {
          allow.disabled = false;
        }
      });
      nodes.push(el('div', { class: 'row-inline' }, [allow]));
    }

    if (grants.endpoints.length) {
      nodes.push(el('p', { class: 'field-group', text: t('settings_endpoints') }));
      nodes.push(el('p', { class: 'field-desc', text: t('settings_endpointsBody') }));
      for (const endpoint of grants.endpoints) {
        nodes.push(row(endpoint.label, revokeButton([endpoint.pattern], endpoint.host)));
      }
    }
    accessHost.replaceChildren(...nodes);

    const state = await chrome.runtime.sendMessage({ type: 'instrument-state', url: null }).catch(() => null);
    const instrumented = state?.origins ?? [];
    instrumentHost.replaceChildren(...(instrumented.length
      ? instrumented.map((pattern) => {
        const url = pattern.replace(/\*$/, '');
        const off = el('button', { text: t('settings_turnOff'), title: t('settings_turnOffHelp', [pattern]) });
        off.addEventListener('click', async () => {
          off.disabled = true;
          const out = await chrome.runtime.sendMessage({ type: 'instrument-set', url, on: false });
          if (out?.error) fail(out.error);
          await refreshAccess();
        });
        return row(pattern, off, badge(t('settings_instrumented'), 'warn'));
      })
      : [el('p', { class: 'field-desc', text: t('settings_noInstrumented') })]));
    const emulation=await chrome.runtime.sendMessage({type:'emulation-state'}).catch(()=>null);
    for(const pattern of emulation?.origins ?? []) {
      const off=el('button',{text:t('emulation_disable'),title:t('emulation_reload')});
      off.addEventListener('click',async()=>{
        await chrome.runtime.sendMessage({type:'emulation-set',url:pattern.replace(/\*$/,''),on:false});
        say(t('emulation_reload'));await refreshAccess();
      });
      instrumentHost.append(row(pattern,off,badge(t('emulation_active'),'warn')));
    }

  }

  function revokeButton(patterns, label) {
    const button = el('button', { text: t('settings_revoke'), title: t('settings_revokeHelp', [label]) });
    button.addEventListener('click', async () => {
      button.disabled = true;
      error.hidden = true;
      try {
        const removed = await removeOrigins(patterns);
        if (!removed) fail(t('settings_permissionError', [t('settings_notRemoved')]));
      } catch (cause) {
        // Chrome's own reason, verbatim: a grant declared as required by a build cannot be
        // removed, and saying so beats a button that does nothing.
        fail(t('settings_permissionError', [String(cause?.message ?? cause)]));
      } finally {
        button.disabled = false;
      }
      await refreshAccess();
      onChanged();
    });
    return button;
  }

  async function refreshAgentAccess() {
    const out = await chrome.runtime.sendMessage({ type: 'external-grants' }).catch(() => null);
    const allowed = out?.allowed ?? [];
    const granted = new Set((out?.grants ?? []).map((g) => g.origin));
    const nodes = [];
    for (const origin of allowed) {
      const on = granted.has(origin);
      const toggle = el('button', {
        text: on ? t('settings_agentAccessOff') : t('settings_agentAccessOn'),
        title: on ? t('settings_agentAccessOffHelp', [origin]) : t('settings_agentAccessOnHelp', [origin]),
      });
      toggle.addEventListener('click', async () => {
        toggle.disabled = true;
        try {
          if (on) {
            const next = await chrome.runtime.sendMessage({ type: 'external-revoke', origin });
            if (next?.error) fail(next.error);
          } else {
            // Chrome's own host permission first — the bubble is the moment the user says
            // "this site may be touched" — and the bridge is registered only once it is in.
            if (!(await hasOrigin(`${origin}/`)) && !(await requestOrigin(`${origin}/`))) {
              say(t('settings_agentAccessNeedPermission'));
              return;
            }
            const next = await chrome.runtime.sendMessage({ type: 'external-grant', origin });
            if (next?.error) fail(next.error);
          }
        } catch (cause) {
          fail(String(cause?.message ?? cause));
        } finally {
          await refreshAgentAccess();
        }
      });
      nodes.push(row(origin, toggle, on ? badge(t('settings_agentAccessAllowed'), 'ok') : null));
    }
    if (out?.last) {
      nodes.push(el('p', {
        class: 'field-desc',
        text: t('settings_agentAccessLast', [String(out.last.origin), String(out.last.command)]),
      }));
    }
    if (!allowed.length) {
      nodes.push(el('p', { class: 'field-desc', text: t('settings_agentAccessNone') }));
    }
    // The section is findable by the eyes and by tests: the origin names repeat in Site
    // Access above, and a control that could be clicked in the wrong list is a wrong control.
    agentAccessHost.classList.add('st-agent-access');
    agentAccessHost.replaceChildren(...nodes);
  }

  // Audited sites (baselines) and the periodic re-check of open tabs (S3).
  async function refreshSecurity() {
    const send = (m) => chrome.runtime.sendMessage(m).catch(() => null);
    const [list, setting] = await Promise.all([send({ type: 'security-baseline-list' }), send({ type: 'security-recheck-get' })]);
    const nodes = [el('p', { class: 'field-group', text: t('settings_auditedSites') })];
    const baselines = list?.baselines ?? [];
    if (!baselines.length) nodes.push(el('p', { class: 'field-desc', text: t('settings_noAuditedSites') }));
    for (const b of baselines) {
      const forget = el('button', { text: t('settings_forgetBaseline'), title: t('settings_forgetBaselineHelp') });
      forget.addEventListener('click', async () => { await send({ type: 'security-baseline-forget', origin: b.origin }); await refreshSecurity(); });
      const detail = b.lastDiff ? el('span', { class: 'muted', text: t('settings_auditedLastCheck', [new Date(b.lastDiff.at).toLocaleString(), String(b.lastDiff.added)]) }) : null;
      nodes.push(row(t('settings_auditedSite', [b.origin, new Date(b.at).toLocaleDateString(), String(b.findings?.length ?? 0)]), forget, detail));
    }
    const toggle = el('input', { type: 'checkbox', id: 'sec-recheck', title: t('settings_recheckHelp') });
    toggle.checked = setting?.enabled === true;
    const every = el('select', { id: 'sec-recheck-every', title: t('settings_recheckEveryHelp') },
      [15, 60, 240].map((n) => el('option', { value: String(n), text: t('settings_recheckMinutes', [String(n)]) })));
    every.value = String(setting?.minutes ?? 60);
    const alarmLine = el('p', { class: 'field-desc st-alarm', text: setting?.alarm ? t('settings_recheckAlarm', [String(setting.alarm.periodInMinutes)]) : t('settings_recheckOff') });
    const apply = async () => {
      const out = await send({ type: 'security-recheck-set', enabled: toggle.checked, minutes: Number(every.value) });
      if (out?.error) fail(out.error);
      await refreshSecurity();
    };
    toggle.addEventListener('change', apply);
    every.addEventListener('change', () => { if (toggle.checked) apply(); });
    const now = el('button', { text: t('settings_recheckNow'), title: t('settings_recheckNowHelp') });
    now.addEventListener('click', async () => {
      now.disabled = true;
      const out = await send({ type: 'security-recheck-now' });
      now.disabled = false;
      if (out) say(t('settings_recheckResult', [String(out.checked?.length ?? 0), String(out.regressed ?? 0), String(out.drifted ?? 0)]));
      await refreshSecurity();
    });
    nodes.push(
      el('label', { class: 'row-inline', for: 'sec-recheck' }, [toggle, el('span', { text: ` ${t('settings_recheck')}` })]),
      el('div', { class: 'row-inline' }, [el('label', { class: 'field-label', for: 'sec-recheck-every', text: t('settings_recheckEvery') }), every, now]),
      alarmLine,
    );
    securityHost.replaceChildren(...nodes);
  }

  async function refreshData() {
    const summary = await chrome.runtime.sendMessage({ type: 'data-summary' }).catch(() => null);
    if (!summary || summary.error) {
      dataHost.replaceChildren(el('p', { class: 'field-note', text: summary?.error ?? t('discoveryFailed') }));
      return;
    }
    const clearer = (what, label) => armedButton({
      label: t('settings_clear'),
      armedLabel: t('settings_confirm'),
      help: t('settings_clearHelp', [label]),
      onConfirm: async () => {
        const result=await chrome.runtime.sendMessage({ type: 'data-clear', what });
        if(result?.error){fail(result.error);return;}
        say(t('settings_cleared'));
        await refreshData();
      },
    });

    const historyText = summary.history.count === 1
      ? t('settings_oneCall') : t('settings_calls', [String(summary.history.count)]);
    const nodes = [
      row(t('settings_history'), clearer('history', t('settings_history')), el('span', { class: 'muted', text: historyText })),
      row(t('settings_overrides'), clearer('overrides', t('settings_overrides')), el('span', { class: 'muted', text: items(summary.overrides) })),
      row(t('settings_savedCalls'), clearer('saved-calls', t('settings_savedCalls')), el('span', { class: 'muted', text: items(summary.savedCalls) })),
      row(t('recipes_recipesData'), clearer('recipes', t('recipes_recipesData')), el('span', {class:'muted',text:t('recipes_recipesCount',[String(summary.recipes?.definitions??0),String(summary.recipes?.runs??0)])})),
      row(t('settings_snapshots'), clearer('snapshots', t('settings_snapshots')), el('span', {
        class: 'muted',
        text: t('settings_snapshotsCount', [String(summary.snapshots.count), String(summary.snapshots.origins)]),
      })),
      row(t('settings_agentSessions'), clearer('agent-sessions', t('settings_agentSessions')), el('span', {
        class: 'muted',
        text: t('settings_agentSessionsCount', [String(summary.sessions?.count ?? 0), String(summary.sessions?.origins ?? 0)]),
      })),
      row(t('settings_connectors'), clearer('connectors', t('settings_connectors')), el('span', {
        class: 'muted',
        text: t('settings_connectorsCount', [String(summary.connectors?.count ?? 0)]),
      })),
      row(t('settings_evals'), clearer('evals', t('settings_evals')), el('span', {
        class: 'muted',
        text: t('settings_evalsCount', [String(summary.evals.suites), String(summary.evals.results)]),
      })),
      row(t('settings_securityReviewed'), clearer('security-reviewed', t('settings_securityReviewed')), el('span', { class: 'muted', text: items((summary.securityReviewed ?? 0) + (summary.securityBaselines ?? 0)), title: t('settings_securityReviewedHelp') })),
    ];
    if (typeof summary.history.bytes === 'number') {
      nodes.push(el('p', { class: 'field-desc', text: t('settings_storageUse', [String(Math.max(1, Math.round(summary.history.bytes / 1024)))]) }));
    }
    nodes.push(el('div', { class: 'form-actions' }, [armedButton({
      label: t('settings_clearAll'),
      armedLabel: t('settings_confirmAll'),
      help: t('settings_clearAllHelp'),
      onConfirm: async () => {
        const result=await chrome.runtime.sendMessage({ type: 'data-clear', what: 'all' });
        if(result?.error){fail(result.error);return;}
        say(t('settings_cleared'));
        await refreshData();
      },
    })]));
    nodes.push(el('p',{class:'field-desc',text:t('invocation_receiptsHelp',[String(summary.history.invocationCount ?? 0)])}));
    dataHost.replaceChildren(...nodes);
    await renderVaultSettings(vaultHost);

    const agent = summary.agent;
    const describe = !agent.configured
      ? t('settings_agentNotConfigured')
      : t('settings_agentConfigured', [[agent.providerLabel, agent.model].filter(Boolean).join(' · ')]);
    const forget = armedButton({
      label: t('settings_forgetAgent'),
      armedLabel: t('settings_confirmForget'),
      help: t('settings_forgetAgentHelp'),
      onConfirm: async () => {
        await chrome.runtime.sendMessage({ type: 'agent-config-reset' });
        say(t('settings_cleared'));
        await refreshData();
      },
    });
    agentHost.replaceChildren(
      el('p', { class: 'field-desc' }, [
        document.createTextNode(describe),
        agent.hasKey ? document.createTextNode(' ') : null,
        agent.hasKey ? badge(t('settings_keyInMemory'), 'accent', t('settings_keyInMemoryHelp')) : null,
      ]),
      el('div', { class: 'row-inline' }, [forget]),
    );
  }
}
