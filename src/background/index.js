import { localBridge, bridgeHandlers } from './bridge/index.js';
import { discover } from './discover.js';
import { keyVaultHandlers } from './key-vault-handlers.js';
import { keyVault } from '../storage/key-vault.js';
const storageProtection = keyVault().protect();
const bridgeReady = storageProtection.then(() => localBridge.init());
bridgeReady.catch(() => {});
import { countReviewed, clearSecurityData, listControlled, setControlled, getBaseline, saveBaseline, forgetBaseline, listBaselines, countBaselines } from '../storage/security.js';
import { recheckOpenTabs, applyRecheckSetting, recheckSetting, installRecheckAlarm } from './security-watch.js';
import { fetchDiscovery } from './security-discovery.js';
import { runProbes, stopProbes, probesRunning } from './security-probes.js';
import { scanSecrets } from './security-secrets.js';
import { runTool, cancelTool } from './execute.js';
import { listCalls, clearCalls, stats } from '../storage/db.js';
import { listOverrides, saveOverride, deleteOverride, clearOverrides } from '../storage/overrides.js';
import { attachLive, receiveLiveEvent, revalidateLiveOrigins, recordExecution, timelineFor, forgetTab, liveDebug } from './live.js';
import { startAgent, cancelAgent, agentRun, forgetAgent, manualPrompt, manualReply, recoverRuns }
  from './agent.js';
import { loadAgentConfig, saveAgentConfig, keyStatus, purgeLegacyDeviceKeys }
  from '../storage/agent-config.js';
import { listModels } from './agent-transport.js';
import { PROVIDERS } from '../core/agent/providers.js';
import { listConnectors, addConnector, updateConnector, deleteConnector, clearAllConnectors,
  isConnectorId, listConnectorIds, resolveProvider, replaceConnectors }
  from '../storage/custom-connectors.js';
import { listGrants, grantOrigin, revokeOrigin, isGranted, clearAllGrants }
  from '../storage/external-access.js';
import { listProfiles, saveProfile, deleteProfile, clearProfiles, replaceProfiles }
  from '../storage/prompt-profiles.js';
import { registerBridge, unregisterBridge, ensureBridgeRegistrations } from './external-bridge.js';
import { EXTERNAL_API, AGENT_ORIGINS, isAllowedAgentOrigin,
  validateExternalRequest, externalReply } from '../core/external/api.js';
import { runSuite, cancelEvals, evalsProgress, forgetEvals, recoverEvals } from './evals.js';
import { keepAliveState } from './keepalive.js';
import { listSuites, getSuite, saveSuite, deleteSuite, listResults, clearResults }
  from '../storage/evals.js';
import { createSuite, suiteFromTools, suiteProblems } from '../core/evals/suite.js';
import { compareSuites } from '../core/evals/compare.js';
import { forgetPanelTab } from '../storage/ui-state.js';
import { demoTabIds } from './demo-bridge.js';
import { listSnapshots, saveSnapshot, getSnapshot, deleteSnapshot, clearSnapshots }
  from '../storage/snapshots.js';
import { createSnapshot } from '../core/snapshots/snapshot.js';
import { diffSnapshots, MATCH } from '../core/snapshots/diff.js';
import { setInstrumented, isInstrumented, instrumentedOrigins, forgetInstrumentation, setEmulated, emulatedOrigins }
  from './instrument.js';
import { listSavedCalls, listAllSavedCalls, saveSavedCall, deleteSavedCall, clearSavedCalls }
  from '../storage/saved-calls.js';
import { listSnapshotOrigins, clearAllSnapshots } from '../storage/snapshots.js';
import { evalsSummary, clearAllEvals } from '../storage/evals.js';
import { listSessions, deleteSession, clearSessions, listSessionOrigins, clearAllSessions }
  from '../storage/agent-sessions.js';
import { listGroups, createGroup, deleteGroup, renameGroup, setSessionGroup, clearAllGroups }
  from '../storage/agent-session-groups.js';
import { resetAgentConfig } from '../storage/agent-config.js';
import { createPermissionRevocations } from './permission-revocations.js';
import { recipes, recipeStorage, recipeHandlers, recoverRecipes } from './recipes.js';

const permissionRevocations = createPermissionRevocations({
  permissions: chrome.permissions, storage: chrome.storage.local,
});

// The panel is opened from the action's click handler, never through
// setPanelBehavior({ openPanelOnActionClick: true }). Measured on Chrome for Testing 153 with the
// production manifest in a fresh profile: a click that merely toggles the panel does NOT grant
// activeTab, so the panel could not name the site it was about to ask for and the whole
// onboarding path dead-ended (Chrome's stated position since crbug.com/1453437, 2023). A click
// that reaches action.onClicked does grant it, and sidePanel.open() is allowed from that handler
// because it is a user action (WMP-0040, D-071).
// The security re-check alarm (S3), registered at the top level so a woken worker hears it.
installRecheckAlarm();

chrome.action.onClicked.addListener((tab) => {
  const target = tab?.id !== undefined ? { tabId: tab.id } : { windowId: tab?.windowId };
  chrome.sidePanel.open(target).catch(() => {});
});

// Chrome stops this worker whenever it likes, including in the middle of a run — measured at
// about 35 seconds into a 50-second provider call. Anything that was in flight is recovered
// here and marked interrupted, because it cannot be resumed safely and losing it silently
// would be the worst of the three options (D-050).
const recovery = Promise.all([recoverRuns(), recoverEvals(), purgeLegacyDeviceKeys(), recoverRecipes(), ensureBridgeRegistrations(), storageProtection])
  .then(([agent, evals, keys, recipe]) => ({ ...agent, ...evals, ...recipe, legacyKeysPurged: keys.purged }))
  .catch((error) => ({ error: String(error?.message ?? error) }));

// A revoked origin must stop mattering immediately, not at the next reload (D-014).
chrome.permissions.onRemoved.addListener(async (removed) => {
  revalidateLiveOrigins().catch(() => {});
  await recipes.stopAll('Site access was removed. Completed actions remain recorded; review the page and access before a new recipe run.');
  // Retain origin patterns independently of the immediate instrumentation cleanup.
  permissionRevocations.remember(removed?.origins ?? []).catch((error) => {
    console.error('Could not retain optional origin patterns:', error);
  });
  // Instrumentation is a content script on a specific origin; a revoked origin must not keep
  // one, and saying so here rather than relying on the blanket sweep below makes the intent
  // legible (D-048).
  await forgetInstrumentation(removed?.origins ?? []);
  try {
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const ids = registered.map((s) => s.id);
    if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
  } catch {
    // Nothing registered yet; nothing to undo.
  }
  chrome.runtime.sendMessage({ type: 'permissions-changed', removed }).catch(() => {});
});

chrome.permissions.onAdded.addListener((added) => {
  permissionRevocations.remember(added?.origins ?? []).catch((error) => {
    console.error('Could not retain optional origin patterns:', error);
  });
  chrome.runtime.sendMessage({ type: 'permissions-changed', added }).catch(() => {});
});

// Capture existing grants on worker startup as well (including an extension update).
chrome.permissions.getAll().then((granted) => permissionRevocations.remember(granted.origins ?? []))
  .catch((error) => console.error('Could not retain optional origin patterns:', error));

let lastSenderMiss = null;

const HANDLERS = {
  ...bridgeHandlers,
  ...recipeHandlers,
  ...keyVaultHandlers,
  'permissions-remove': (msg) => permissionRevocations.remove(msg.origins),
  discover: (msg) => discover(msg.tabId, msg.url),
  run: async (msg) => {
    const call = await runTool(msg.tabId, msg.call);
    recordExecution(msg.tabId, call);
    return call;
  },
  // Cancels a call still in flight, by the id the caller gave it. The page's controller is
  // aborted first; the call then settles through its own `run` answer with code `cancelled`.
  'run-cancel': (msg) => cancelTool(msg.tabId, msg.callId),
  'live-attach': (msg) => attachLive(msg.tabId).then((ok) => ({ ok })),
  'live-list': (msg) => Promise.resolve({
    events: timelineFor(msg.tabId).list({ kinds: msg.kinds ?? null, limit: msg.limit ?? 200 }),
    stats: timelineFor(msg.tabId).stats(),
    debug: { ...liveDebug(), lastSenderMiss },
  }),
  // Security (S2): the person's own sites, and the active probes that may run only there.
  'security-controlled-list': async () => ({ origins: Array.from(await listControlled()) }),
  'security-controlled-set': async (msg) => ({ controlled: await setControlled(msg.origin, Boolean(msg.on)) }),
  'security-probe-run': (msg) => runProbes({ tabId: msg.tabId, topOrigin: msg.topOrigin, tools: msg.tools ?? [] }),
  'security-probe-stop': (msg) => stopProbes(msg.tabId),
  'security-probe-state': (msg) => Promise.resolve({ running: probesRunning(msg.tabId) }),
  // WMCP-SEC-013, on request and only for a declared controlled site: provider key formats in scripts.
  'security-secrets-scan': (msg) => scanSecrets({ tabId: msg.tabId, topOrigin: msg.topOrigin }),
  // Security (S3): baselines per origin and the re-check of open tabs.
  'security-baseline-get': async (msg) => ({ baseline: await getBaseline(msg.origin) }),
  'security-baseline-save': async (msg) => ({ baseline: await saveBaseline(msg.baseline) }),
  'security-baseline-forget': async (msg) => { await forgetBaseline(msg.origin); return { forgotten: true }; },
  'security-baseline-list': async () => ({ baselines: await listBaselines() }),
  'security-recheck-get': () => recheckSetting(),
  'security-recheck-set': (msg) => applyRecheckSetting({ enabled: msg.enabled, minutes: msg.minutes }),
  'security-recheck-now': () => recheckOpenTabs(),
  // Security (S4): discovery conventions, fetched only on request for a granted origin.
  'security-discovery-fetch': (msg) => fetchDiscovery({ pageUrl: msg.pageUrl }),
  'live-pause': (msg) => {
    const timeline = timelineFor(msg.tabId);
    if (msg.paused) timeline.pause(); else timeline.resume();
    return Promise.resolve(timeline.stats());
  },
  'overrides-list': () => listOverrides(),
  'override-save': (msg) => saveOverride(msg.override),
  'override-delete': (msg) => deleteOverride(msg.logicalId),
  'overrides-clear': () => clearOverrides(),
  'live-clear': (msg) => {
    timelineFor(msg.tabId).clear();
    return Promise.resolve({ cleared: true });
  },
  // Agent Lab. The panel can ask whether a key exists and can set one; it can never read one
  // back (D-004 rule 5), so there is deliberately no 'agent-key-get'.
  'agent-config': async () => {
    const config = await loadAgentConfig();
    const connectors = await listConnectors();
    return {
      config,
      key: await keyStatus(config.providerId),
      promptProfiles: await listProfiles(),
      providers: [...PROVIDERS.map(({ id, label, baseUrl, baseUrlEditable, keyRequired, keyHelp,
        local, manual, suggestedModels, modelsPath }) => ({
        id, label, baseUrl, baseUrlEditable, keyRequired, keyHelp,
        local: Boolean(local), manual: Boolean(manual), suggestedModels,
        canListModels: Boolean(modelsPath),
      })), ...connectors.map(({ id, label, dialect, baseUrl, baseUrlEditable, keyRequired,
        keyHelp, modelsPath, custom }) => ({
        id, label, dialect, baseUrl, baseUrlEditable, keyRequired, keyHelp,
        local: false, manual: false, suggestedModels: [],
        canListModels: Boolean(modelsPath), custom: Boolean(custom),
      }))],
    };
  },
  'agent-config-save': async (msg) => {
    const patch = msg.patch ?? {};
    // A connector can be deleted while the panel holds it; saving it as the active provider
    // would leave the configuration pointing at nothing.
    if (isConnectorId(patch.providerId) && !(await listConnectorIds()).has(patch.providerId)) {
      return { error: 'That connector no longer exists.' };
    }
    const saved = await saveAgentConfig(patch);
    chrome.runtime.sendMessage({ type: 'agent-config-changed' }).catch(() => {});
    return saved;
  },
  // Custom connectors (F10): the user describes an endpoint, Explorer speaks the dialect. The
  // description is stored; the key never is (it lives in the session key map like any other).
  'connector-add': async (msg) => {
    const out = await addConnector(msg);
    if (out.connector) chrome.runtime.sendMessage({ type: 'agent-config-changed' }).catch(() => {});
    return out;
  },
  'connector-update': async (msg) => {
    const out = await updateConnector(msg.id, msg.patch ?? {});
    if (out.connector) chrome.runtime.sendMessage({ type: 'agent-config-changed' }).catch(() => {});
    return out;
  },
  'connector-delete': async (msg) => {
    const out = await deleteConnector(msg.id,msg.passphrase);
    // If the deleted connector was the active provider, the configuration must not be left
    // pointing at a deleted provider: ask the user to choose again.
    const config = await loadAgentConfig();
    if (config.providerId === `custom:${msg.id}`) {
      await saveAgentConfig({ providerId: '' });
    }
    chrome.runtime.sendMessage({ type: 'agent-config-changed' }).catch(() => {});
    return out;
  },
  // Prompt profiles (F13): named system prompts the Agent Lab answers as. Text only — a
  // profile never carries a key or an endpoint, and deleting the active one falls back to
  // the product default, the same way a deleted connector does.
  'prompt-profile-save': async (msg) => {
    const out = await saveProfile(msg);
    if (out.profile) chrome.runtime.sendMessage({ type: 'agent-config-changed' }).catch(() => {});
    return out;
  },
  'prompt-profile-delete': async (msg) => {
    const out = await deleteProfile(msg.id);
    const config = await loadAgentConfig();
    if (config.promptProfileId === msg.id) await saveAgentConfig({ promptProfileId: null });
    chrome.runtime.sendMessage({ type: 'agent-config-changed' }).catch(() => {});
    return out;
  },
  // The settings bundle (F14): everything the user configured that is not a secret, as one
  // JSON file they can carry to another browser or machine. Keys are in memory only (D-051)
  // and therefore cannot be in a bundle by construction — the file names the connectors that
  // need a key, the user re-types it once. Import re-validates every entry (a remote plain-
  // http connector saved elsewhere is dropped here exactly as at creation time).
  'settings-export': async () => {
    const config = await loadAgentConfig();
    return {
      bundle: {
        app: 'webmcp-explorer',
        kind: 'settings',
        version: 1,
        exportedAt: new Date().toISOString(),
        config: {
          providerId: config.providerId,
          baseUrl: config.baseUrl,
          model: config.model,
          maxSteps: config.maxSteps,
          maxToolCalls: config.maxToolCalls,
          promptProfileId: config.promptProfileId ?? null,
        },
        connectors: (await listConnectors()).map(({ id, label, dialect, baseUrl, keyRequired }) =>
          ({ id: id.replace(/^custom:/, ''), label, dialect, baseUrl, keyRequired })),
        promptProfiles: await listProfiles(),
      },
    };
  },
  'settings-import': async (msg) => {
    const bundle = msg.bundle;
    if (!bundle || bundle.app !== 'webmcp-explorer' || bundle.kind !== 'settings'
        || bundle.version !== 1) {
      return { error: 'That file is not a WebMCP Explorer settings bundle (version 1).' };
    }
    const connectors = await replaceConnectors(bundle.connectors ?? []);
    const profiles = await replaceProfiles(bundle.promptProfiles ?? []);
    const patch = {};
    const c = bundle.config ?? {};
    if (typeof c.providerId === 'string') patch.providerId = c.providerId;
    if (typeof c.baseUrl === 'string') patch.baseUrl = c.baseUrl;
    if (typeof c.model === 'string') patch.model = c.model;
    if (Number.isInteger(c.maxSteps)) patch.maxSteps = Math.min(50, Math.max(1, c.maxSteps));
    if (Number.isInteger(c.maxToolCalls)) patch.maxToolCalls = Math.min(200, Math.max(1, c.maxToolCalls));
    if (c.promptProfileId === null || typeof c.promptProfileId === 'string') {
      patch.promptProfileId = c.promptProfileId;
    }
    const saved = await saveAgentConfig(patch);
    chrome.runtime.sendMessage({ type: 'agent-config-changed' }).catch(() => {});
    return {
      applied: true,
      connectors: connectors.count ?? 0,
      droppedConnectors: Array.isArray(bundle.connectors)
        ? bundle.connectors.length - (connectors.count ?? 0) : 0,
      promptProfiles: profiles.count ?? 0,
      config: saved,
    };
  },
  // Agent access (F11): which allowed origins the user switched on. The allowed set itself is
  // fixed in code (src/core/external/api.js) — the screen cannot widen it, only say yes or no
  // per origin. Enabling also needs Chrome's own host permission for the site.
  'external-grants': async () => ({
    allowed: AGENT_ORIGINS,
    grants: await listGrants(),
    last: lastExternal,
  }),
  'external-grant': async (msg) => {
    const registered = await registerBridge(msg.origin);
    if (registered.error) return registered;
    return grantOrigin(msg.origin);
  },
  'external-revoke': async (msg) => {
    await unregisterBridge(msg.origin);
    return revokeOrigin(msg.origin);
  },
  'agent-models': async (msg) => listModels({ ...await loadAgentConfig(), ...(msg.config ?? {}) }),
  'agent-start': (msg) => startAgent({
    tabId: msg.tabId, goal: msg.goal, tools: msg.tools, topOrigin: msg.topOrigin,
    sessionId: msg.sessionId ?? null,
  }),
  // Stored conversations for this site: the session switcher reads these, and a follow-up run
  // continues one of them by id.
  'agent-sessions': (msg) => listSessions(msg.origin),
  'agent-session-delete': (msg) => deleteSession(msg.origin, msg.sessionId),
  'agent-sessions-clear': (msg) => clearSessions(msg.origin),
  // Chat groups: local labels over the session store, per origin (F9).
  'agent-session-groups': (msg) => listGroups(msg.origin),
  'agent-session-group-create': (msg) => createGroup(msg.origin, msg.name),
  'agent-session-group-rename': (msg) => renameGroup(msg.origin, msg.groupId, msg.name),
  'agent-session-group-delete': (msg) => deleteGroup(msg.origin, msg.groupId),
  'agent-session-group-assign': (msg) => setSessionGroup(msg.origin, msg.sessionId, msg.groupId ?? null),
  'agent-cancel': (msg) => Promise.resolve(cancelAgent(msg.tabId)),
  // A real stop: nothing left running, nothing left to come back to. It deliberately does not
  // touch the user's data — suites, results, overrides and history are theirs (D-044).
  'panel-reset': async (msg) => {
    await recipes.stop(msg.tabId);
    cancelEvals(msg.tabId);
    forgetEvals(msg.tabId);
    cancelAgent(msg.tabId);
    forgetAgent(msg.tabId);
    return Promise.resolve({ reset: true });
  },
  // What a reset would actually stop, so the control is never offered as a dead button.
  'panel-activity': (msg) => Promise.resolve({
    agent: Boolean(agentRun(msg.tabId)),
    evals: Boolean(evalsProgress(msg.tabId)),
    recipe: recipes.activity(msg.tabId),
  }),
  'agent-state': async (msg) => {
    // Recovery must have run before the first answer, or an inherited run reads as absent.
    await recovery;
    return { run: agentRun(msg.tabId) };
  },
  'agent-manual-prompt': (msg) => manualPrompt(msg.tabId),
  'agent-manual-reply': (msg) => manualReply(msg.tabId, msg.text),

  // Evals. Suites are data the user wrote; running one is a long job that reports progress.
  'evals-suites': () => listSuites(),
  'evals-suite-save': (msg) => saveSuite(msg.suite),
  'evals-suite-delete': (msg) => deleteSuite(msg.suiteId),
  'evals-suite-new': (msg) => saveSuite(msg.fromTools
    ? suiteFromTools(msg.tools ?? [], msg.origin ?? null)
    : createSuite({ name: msg.name, origin: msg.origin ?? null })),
  'evals-check': async (msg) => {
    const suite = await getSuite(msg.suiteId);
    return { problems: suite ? suiteProblems(suite) : ['no-suite'] };
  },
  'evals-run': async (msg) => {
    const suite = await getSuite(msg.suiteId);
    if (!suite) return { error: 'That suite no longer exists.' };
    return runSuite({
      tabId: msg.tabId, suite, tools: msg.tools, topOrigin: msg.topOrigin, label: msg.label,
    });
  },
  'evals-cancel': (msg) => Promise.resolve(cancelEvals(msg.tabId)),
  'evals-progress': async (msg) => {
    await recovery;
    return { progress: evalsProgress(msg.tabId) };
  },
  'evals-results': (msg) => listResults(msg.suiteId),
  'evals-results-clear': (msg) => clearResults(msg.suiteId),
  'evals-compare': async (msg) => {
    const results = await listResults(msg.suiteId);
    // Newest first, so [1] is the run before the one being examined.
    if (results.length < 2) return { error: 'Run the suite twice to compare.' };
    return { comparison: compareSuites(results[1], results[0]), before: results[1], after: results[0] };
  },

  // Contract snapshots. The capture is made in the service worker from a fresh discovery, so
  // a snapshot always records what the page declares right now rather than what the panel
  // happened to be showing.
  // Source Finder. Off by default, per origin, and a reload is always required — a
  // registration that already happened cannot be observed after the fact.
  'demo-tabs': () => Promise.resolve({ tabs: demoTabIds() }),

  // What this worker inherited when it started, and whether it is currently holding itself
  // awake. Surfaced so the state is observable instead of guessed at.
  'worker-state': async () => ({ recovery: await recovery, keepAlive: keepAliveState() }),

  'instrument-state': async (msg) => ({
    on: await isInstrumented(msg.url),
    origins: await instrumentedOrigins(),
  }),
  'instrument-set': (msg) => setInstrumented(msg.url, msg.on === true),
  'emulation-state': async () => ({ origins: await emulatedOrigins() }),
  'emulation-set': msg => setEmulated(msg.url,msg.on === true),

  'snapshot-list': (msg) => listSnapshots(msg.origin),
  'snapshot-save': async (msg) => {
    const discovery = await discover(msg.tabId, msg.url);
    if (!discovery || discovery.error) {
      return { error: discovery?.error ?? 'Could not read the page.' };
    }
    const snapshot = createSnapshot(discovery, { label: msg.label ?? null });
    return { ...await saveSnapshot(msg.origin, snapshot), snapshot };
  },
  'snapshot-delete': (msg) => deleteSnapshot(msg.origin, msg.id),
  'snapshot-clear': (msg) => clearSnapshots(msg.origin),
  'snapshot-diff': async (msg) => {
    const before = await getSnapshot(msg.origin, msg.id);
    if (!before) return { error: 'That snapshot no longer exists.' };
    const discovery = await discover(msg.tabId, msg.url);
    if (!discovery || discovery.error) {
      return { error: discovery?.error ?? 'Could not read the page.' };
    }
    const after = createSnapshot(discovery, { label: 'the page right now' });
    // A snapshot taken on another site is another environment of the same page: tools are
    // matched by frame and name, and the origin difference is the premise, not a change.
    const matchBy = before.origin && discovery.topOrigin && before.origin !== discovery.topOrigin
      ? MATCH.name : MATCH.identity;
    return { diff: diffSnapshots(before, after, { matchBy }), before, after };
  },
  // Every site that has snapshots, so a page can be compared with a capture taken elsewhere.
  'snapshot-origins': () => listSnapshotOrigins(),

  // Saved calls: named argument sets, per tool, re-checked against the schema by the panel.
  'saved-calls-list': (msg) => listSavedCalls(msg.logicalId),
  'saved-calls-all': () => listAllSavedCalls(),
  'saved-call-save': (msg) => saveSavedCall(msg.saved),
  'saved-call-delete': (msg) => deleteSavedCall(msg.logicalId, msg.id),
  'saved-calls-clear': () => clearSavedCalls(),

  history: (msg) => listCalls({ logicalId: msg.logicalId ?? null, limit: msg.limit ?? 100 }),
  'history-stats': () => stats(),
  'history-clear': () => clearCalls().then(() => ({ cleared: true })),

  // The data screen. What is stored, by class, with the means to delete each class — and all of
  // them — so nothing Explorer keeps is out of the user's reach (D-010, D-044).
  'data-summary': async () => {
    const [history, overrides, savedCalls, snapshotOrigins, evals, instrumented, config, definitions, recipeRuns, sessionOrigins, securityReviewed, securityBaselines] = await Promise.all([
      stats().catch(() => ({ count: 0, bytes: null })),
      listOverrides(),
      listAllSavedCalls(),
      listSnapshotOrigins(),
      evalsSummary(),
      instrumentedOrigins(),
      loadAgentConfig(),
      recipeStorage.definitions(), recipeStorage.runs(),
      listSessionOrigins(),
      countReviewed().catch(() => 0),
      countBaselines().catch(() => 0),
    ]);
    const provider = await resolveProvider(config.providerId);
    const connectorCount = (await listConnectors()).length;
    return {
      securityReviewed,
      securityBaselines,
      history: { count: history.count, bytes: history.bytes },
      overrides: overrides.length,
      savedCalls: savedCalls.length,
      recipes: { definitions: definitions.length, runs: recipeRuns.length },
      snapshots: {
        count: snapshotOrigins.reduce((sum, o) => sum + o.count, 0),
        origins: snapshotOrigins.length,
      },
      sessions: {
        count: sessionOrigins.reduce((sum, o) => sum + o.count, 0),
        origins: sessionOrigins.length,
      },
      connectors: { count: connectorCount },
      evals,
      instrumented,
      agent: {
        providerId: config.providerId,
        providerLabel: provider?.label ?? config.providerId,
        manual: Boolean(provider?.manual),
        configured: Boolean(provider),
        model: config.model ?? '',
        hasKey: (await keyStatus(config.providerId)).hasKey,
      },
    };
  },
  'data-clear': async (msg) => {
    const what = msg.what;
    const all = what === 'all';
    const done = [];
    if (all) { await localBridge.reset(); done.push('local-bridge'); await resetAgentConfig(); done.push('agent-config'); }
    if (all || what === 'recipes') { await recipeStorage.clear(); done.push('recipes'); }
    if (all || what === 'history') { await clearCalls(); done.push('history'); }
    if (all || what === 'overrides') { await clearOverrides(); done.push('overrides'); }
    if (all || what === 'saved-calls') { await clearSavedCalls(); done.push('saved-calls'); }
    if (all || what === 'snapshots') { await clearAllSnapshots(); done.push('snapshots'); }
    if (all || what === 'agent-sessions') {
      await clearAllSessions();
      await clearAllGroups(); // labels without conversations are residue (D-010)
      done.push('agent-sessions');
    }
    if (all || what === 'connectors') { await clearAllConnectors(); done.push('connectors'); }
    if (all || what === 'prompt-profiles') { await clearProfiles(); done.push('prompt-profiles'); }
    if (all || what === 'agent-access') {
      // Closing the channel means taking the bridge out of the pages, not only the grants.
      for (const grant of await listGrants()) await unregisterBridge(grant.origin);
      await clearAllGrants();
      done.push('agent-access');
    }
    if (all || what === 'evals') { await clearAllEvals(); done.push('evals'); }
    if (all || what === 'security-reviewed') { await clearSecurityData(); done.push('security-reviewed'); }
    if (!done.length) return { error: `Nothing called "${what}" is stored.` };
    return { cleared: done };
  },
  'agent-config-reset': async () => {
    const out = await resetAgentConfig();
    chrome.runtime.sendMessage({ type: 'agent-config-changed' }).catch(() => {});
    return out;
  },
};

// Live events arrive from content scripts, not from the panel, and carry their own sender.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'live-event') return false;
  // A content script always has sender.tab; keeping the guard but recording the miss means
  // a lost event is visible instead of silently discarded.
  if (!sender.tab) {
    lastSenderMiss = { hasTab: false, url: sender.url ?? null, frameId: sender.frameId ?? null };
    return false;
  }
  receiveLiveEvent(msg.payload,sender).catch(() => {});
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  recipes.stop(tabId, 'The page was closed. No later step will run; a pending action may have completed.').catch(() => {});
  forgetTab(tabId);
  forgetAgent(tabId);
  forgetEvals(tabId);
  forgetPanelTab(tabId);
});

// Navigating away used to purge the tab's snapshots here, on tabs.onUpdated "loading". Chrome
// reports a history.pushState the same way, and the purge then swallowed the next real change
// of a page that had not actually reloaded (measured, e2e/navigation.mjs). The document token
// carried by every snapshot now tells a new document from the old one (D-055); the timeline
// itself is kept across navigations either way, because the user still wants to see what
// happened before the reload.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // With external surfaces in the build, the internal channel answers only this extension's
  // own pages and frames — and never an agent-envelope message, whatever it carries: the
  // external channel below owns `api`. chrome.runtime.getURL('') is this extension's base URL.
  if (!sender.url || !sender.url.startsWith(chrome.runtime.getURL(''))) return false;
  if (msg?.api) return false; // an envelope is the external surface's traffic, even from our own frame
  const handler = HANDLERS[msg?.type];
  if (!handler) return false;
  (msg?.type?.startsWith('local-bridge-') ? bridgeReady : storageProtection).then(() => handler(msg))
    .then(sendResponse)
    .catch((error) => sendResponse({ error: String(error?.message ?? error) }));
  return true;
});

// Third-party agent access (F11/D-114). A separate listener on purpose: the panel channel above
// is our own pages, this one answers requests that arrive from web pages allowed by the
// manifest. Three gates, in order: the sender must be a real page on an allowed origin, the
// user must have granted that origin, and the message must match the versioned schema. The
// agent sees the tools of its own tab only — never another tab, never the panel's data.
let lastExternal = null; // the most recent external request, answer included: the screen shows
// who talked to Explorer and what came back, so the channel is never a blind door.

// One request gate, shared by both doors. answer() applies the three gates in order: the
// sender must be a real page on an allowed origin, the user must have granted that origin,
// and the message must match the versioned schema. The agent sees the tools of its own tab
// only — never another tab, never the panel's data.
async function answerExternal(msg, sender) {
  const origin = sender.tab?.url ? new URL(sender.tab.url).origin : null;
  if (!origin || !isAllowedAgentOrigin(sender.tab.url)) {
    return externalReply('error', { error: 'This page is not allowed to talk to Explorer.' });
  }
  if (!(await isGranted(origin))) {
    return externalReply('error', {
      error: `Access is not turned on for ${origin}. Open Explorer's Settings and allow agent access for it.`,
    });
  }
  const checked = validateExternalRequest(msg);
  if (!checked.ok) return externalReply('error', { error: checked.error });

  const tabId = sender.tab.id;
  const topUrl = sender.tab.url;
  if (checked.request.command === 'ping') {
    return externalReply('pong', {
      extension: 'webmcp-explorer',
      version: chrome.runtime.getManifest().version,
    });
  }
  const found = await discover(tabId, topUrl);
  if (found.error) return externalReply('error', { error: found.error });
  // The external agent sees exactly the list the panel shows for this page — same registry,
  // same overrides, nothing hidden on either side.
  const tools = found.tools ?? [];
  if (checked.request.command === 'list-tools') {
    return externalReply('tools', {
      tools: tools.map((t) => ({
        name: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? null,
      })),
    });
  }
  const matches = tools.filter(t => t.name === checked.request.tool && !t.inventoryOnly);
  if (matches.length > 1) return externalReply('error', { error: 'The tool name is ambiguous across frames or runtimes.' });
  const tool = matches[0];
  if (!tool) return externalReply('error', { error: `No tool named ${checked.request.tool} is declared on this page.` });
  const out = await runTool(tabId, {
    frameId: tool.frameId ?? 0, documentId: tool.documentId, toolName: tool.name,
    origin: tool.origin ?? origin, args: checked.request.args, tool, topOrigin: origin,
    ...(checked.request.requestId ? {callId:`external:${sender.documentId}:${checked.request.requestId}`} : {}),
  });
  return externalReply('result', out);
}

function noteExternal(msg, sender, reply) {
  lastExternal = {
    origin: sender.tab?.url ? new URL(sender.tab.url).origin : null,
    command: msg?.command ?? null, at: Date.now(),
    kind: reply?.kind ?? 'error',
  };
  return reply;
}

// Door one: a one-shot message from an allowed page. (Chrome routes a page's
// runtime.sendMessage to this listener only when externally_connectable matches; measured in
// the agent-access scenario.)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.api !== EXTERNAL_API) return false; // not addressed to this surface
  answerExternal(msg, sender)
    .then((reply) => sendResponse(noteExternal(msg, sender, reply)))
    .catch((error) => sendResponse(noteExternal(msg, sender,
      externalReply('error', { error: String(error?.message ?? error) }))));
  return true;
});

// Door two: a port, the documented path for a page that keeps talking. The same gate answers
// every message; the port itself is never a privilege.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== EXTERNAL_API) return; // not our channel
  port.onMessage.addListener((msg) => {
    answerExternal(msg, port.sender)
      .then((reply) => port.postMessage(noteExternal(msg, port.sender, reply)))
      .catch((error) => port.postMessage(noteExternal(msg, port.sender,
        externalReply('error', { error: String(error?.message ?? error) }))));
  });
});
