import { diagnosticState } from '../../core/diagnostics.js';
import { emulationControl } from '../components/emulation.js';
import { requestOrigins } from '../../shared/permissions.js';
import { el, badge, t } from '../dom.js';
import { reviewSecurity } from '../../core/security/review.js';
import { diffBaseline } from '../../core/security/baseline.js';

function envLabel(state) {
  const map = {
    native: t('status_native'),
    'origin-trial': t('status_originTrial'),
    'testing-flag': t('status_devFlag'),
    'compat-polyfill': t('status_compatibility'),
    unavailable: t('status_unavailable'),
    'api-mismatch': t('status_apiMismatch'),
  };
  return map[state] ?? state;
}

const ENV_KIND = {
  native: 'ok',
  'origin-trial': 'ok',
  'testing-flag': 'ok',
  'compat-polyfill': 'warn',
  unavailable: 'danger',
  'api-mismatch': 'warn',
};

// A count with its own singular and plural: the two halves of "N tools · M frames" are
// independent, so each is composed on its own rather than fixed as one pair.
function count(n, oneKey, manyKey) {
  return n === 1 ? t(oneKey) : t(manyKey, [String(n)]);
}

// The status bar is never hidden: the user must always know which mode they are in
// (D-004 rule 2, D-013).
export function renderStatus(factsEl, result, { onGranted, tabId = null }) {
  const diagnostic=diagnosticState(result);
  const state = result.env.state;
  // The object is native but every call is refused (Chrome 153–155 on a document that is not
  // origin-keyed, WMP-0051): "Native" alone would read as working.
  const refused = result.env.checks?.apiAvailability === 'refused';

  const nodes = [
    badge(
      refused ? t('status_refused') : diagnostic.runtime==='legacy'?t('status_legacy'):diagnostic.runtime==='emulated'?t('status_emulated'):envLabel(state),
      refused ? 'danger' : (ENV_KIND[state] ?? 'warn'),
      refused && result.env.refusal
        ? `${result.env.refusal.name}: ${result.env.refusal.message}`
        : (result.env.missing?.length
          ? t('status_missingApiMethods', [result.env.missing.join(', ')])
          : (diagnostic.runtime==='legacy'?'navigator.modelContext':diagnostic.runtime==='emulated'?'JS emulation':'document.modelContext')+' · '+t('status_webmcpRuntimeDetectedForThis')),
    ),
    el('span', {
      // Each count carries its own singular: "1 tools · 1 frames" was shipping on every page
      // with a single tool — measured in a real capture (Store shot 6). Composing the two
      // units independently fixes the class, not just the one combination.
      text: `${count(result.tools.length, 'status_1Tool', 'status_nTools')}`
        + ` · ${count(result.frames.length, 'status_1Frame', 'status_nFrames')}`,
      title: t('status_toolsDiscoveredAndFramesExplorer'),
    }),
  ];

  const inventory=el('span',{class:'diagnostic-inventory',text:t('status_inventorySplit',[String(diagnostic.imperative),String(diagnostic.declarative),String(diagnostic.unknown)]),title:t('status_inventoryHelp')});
  const grade=reviewSecurity({discovery:result}).score;
  const security=badge(t('status_grade',[grade.grade??'—']),grade.grade===null?'muted':grade.grade==='F'?'danger':'muted',t('security_scoreCaution'));
  security.classList.add('diagnostic-grade');security.setAttribute('aria-label',t('status_grade',[grade.grade??'—'])+' '+t('security_scoreCaution'));
  const bridge=badge('MCP …','muted',t('bridge_title'));bridge.classList.add('diagnostic-bridge');
  const refreshBridge=async()=>{
    const status=await chrome.runtime.sendMessage({type:'local-bridge-state'}).catch(()=>null);
    if(!bridge.isConnected)return;
    const symbol=status?.blocked?'⏸':status?.status==='connected'?'✓':status?.enabled?'…':'–';
    bridge.textContent='MCP '+symbol;bridge.title=status?.blocked?t('bridge_unknown'):t('bridge_status',[t(`bridge_status_${(status?.status??'disabled').replaceAll('-','_')}`)]);
    bridge.setAttribute('aria-label',bridge.title);
  };
  factsEl.__bridgeStatusCleanup?.();
  const listener=msg=>{if(msg?.type==='local-bridge-changed')refreshBridge();};
  chrome.runtime.onMessage.addListener(listener);factsEl.__bridgeStatusCleanup=()=>chrome.runtime.onMessage.removeListener(listener);
  nodes.push(inventory,security,bridge);
  if(diagnostic.canOfferEmulation){
    const copy=el('button',{class:'diagnostic-copy-flag',text:t('status_copyFlag'),title:t('enableFlagWhy')});
    copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText('chrome://flags/#enable-webmcp-testing');copy.title=t('exportBar_copied',[t('status_copyFlag')]);}catch{copy.title=t('discoveryFailed');}});
    nodes.push(copy,emulationControl(result.url,tabId,{compact:true}));
  }
  queueMicrotask(refreshBridge);

  // completeness already merges "tools seen from an origin we could not enter" with
  // "frames referenced but never injected" (core/frames.js, D-023).
  const pending = result.completeness.ungrantedOrigins;

  // Claiming a complete discovery when there was no runtime to discover from is nonsense:
  // the environment screen is the message in that case, not a green badge.
  const canDiscover = result.env.checks.apiAvailability === 'available';

  // Frames Explorer entered whose getTools() the browser refused: their tools were never
  // listed, so discovery is partial whatever the rest says (core/frames.js).
  const refusedFrames = result.completeness.refusedFrames ?? [];
  if (refusedFrames.length) {
    nodes.push(badge(
      refusedFrames.length === 1 ? t('status_partialRefusedOne') : t('status_partialRefusedMany', [String(refusedFrames.length)]),
      'warn',
      t('status_partialRefusedHelp', [refusedFrames.map((f) => `${f.name}: ${f.message}`).join('\n')]),
    ));
  }

  if (!canDiscover) {
    factsEl.replaceChildren(...nodes);
    return;
  }

  if (pending.length === 0 && refusedFrames.length === 0) {
    nodes.push(badge(t('discoveryComplete'), 'ok', t('status_everyOriginExposingToolsIs')));
  } else if (pending.length) {
    nodes.push(badge(
      pending.length === 1 ? t('status_partialOne') : t('status_partialMany', [String(pending.length)]),
      'warn',
      pending.join('\n'),
    ));

    const grant = el('button', {
      text: t('grantMoreOrigins'),
      title: pending.join('\n'),
    });
    grant.addEventListener('click', async () => {
      grant.disabled = true;
      try {
        if (await requestOrigins(pending.map((o) => `${o}/`))) onGranted();
      } finally {
        grant.disabled = false;
      }
    });
    nodes.push(grant);
  }

  factsEl.replaceChildren(...nodes);
}

// Findings the saved baseline does not have (S3), added once the baseline has been read. The
// badge is appended after the synchronous status so the bar never waits for storage.
export async function appendSecurityBadge(factsEl, result) {
  if (!result?.topOrigin || result.env?.checks?.apiAvailability !== 'available') return null;
  const stored = await chrome.runtime.sendMessage({ type: 'security-baseline-get', origin: result.topOrigin }).catch(() => null);
  if (!stored?.baseline) return null;
  const diff = diffBaseline(stored.baseline, reviewSecurity({ discovery: result }), result);
  factsEl.querySelector('.sec-status-badge')?.remove();
  if (!diff?.regressed || !factsEl.isConnected) return diff;
  const node = badge(
    t('status_securityNew', [String(diff.added.length)]),
    diff.maxAdded === 'high' || diff.maxAdded === 'critical' ? 'danger' : 'warn',
    t('status_securityNewHelp', [t(`security_sev_${diff.maxAdded}`)]),
  );
  node.classList.add('sec-status-badge');
  factsEl.append(node);
  return diff;
}
