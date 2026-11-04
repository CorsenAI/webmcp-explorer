import { el, badge, t } from '../dom.js';
import { filterTools, facetsOf } from '../../core/filter.js';
import { exportBar } from '../components/export-bar.js';
import { renderPageChecks } from './tools-checks.js';
import { toolsReport } from '../../core/export/report.js';
import { renderSnapshots } from './snapshots.js';
import { checkTools } from '../../core/checks.js';
import { checksBadge } from './tool-checks.js';
import { renderMissingRegistrations } from './tool-missing.js';
import { helpIntro } from '../components/help.js';
import { reviewSecurity, maxSeverity } from '../../core/security/review.js';
import { severityBadge, severityLabel } from './security.js';

// Annotations are whatever the browser actually returns. Chrome 152 normalises them and
// does not expose consequentialHint at all, so nothing here is hard-coded to a fixed list.
const ANNOTATION_KIND = {
  readOnlyHint: 'accent',
  consequentialHint: 'warn',
  untrustedContentHint: 'warn',
  debugging: 'accent',
};

function annotationLabel(key) {
  const map = {
    readOnlyHint: t('toolDetails_readOnly'),
    consequentialHint: t('toolDetails_consequential'),
    untrustedContentHint: t('toolDetails_untrustedContent'),
    debugging: t('toolDetails_debugging'),
  };
  return map[key] ?? key;
}

function sortLabel(key) {
  const map = { name: t('tools_name'), origin: t('tools_origin'), frame: t('tools_frame') };
  return map[key] ?? key;
}

function inputSummary(tool) {
  const s = tool.inputSchema;
  if (!s || typeof s !== 'object' || typeof s.properties !== 'object' || !s.properties) return null;
  const keys = Object.keys(s.properties);
  if (keys.length === 0) {
    return el('span', { class: 'card-inputs muted', text: t('tools_inputsNone') });
  }
  const req = Array.isArray(s.required) ? s.required.filter((k) => keys.includes(k)) : [];
  const fmt = (list) => `${list.slice(0, 4).join(', ')}${list.length > 4 ? '…' : ''}`;
  if (req.length > 0) {
    return el('span', { class: 'card-inputs muted', text: t('tools_inputsRequired', [fmt(req)]) });
  }
  return el('span', { class: 'card-inputs muted', text: t('tools_inputsOptional', [fmt(keys)]) });
}

function toolCard(tool, onOpen, allTools = [], checked, severity = null) {
  const meta = el('div', { class: 'card-meta' });

  // Gaps in the declared contract that would trip an agent up: warnings only, on the list.
  const checks = checksBadge(tool, allTools, checked);
  if (checks) meta.append(checks);
  // The highest security severity the review attached to this tool (D-127).
  if (severity) meta.append(severityBadge(severity, t('security_cardBadgeHelp')));

  for (const [key, value] of Object.entries(tool.annotations ?? {})) {
    if (value !== true) continue;
    meta.append(badge(
      annotationLabel(key),
      ANNOTATION_KIND[key] ?? 'accent',
      t('annotationDeclaredHelp'),
    ));
  }

  if (tool.registrationType !== 'unknown') {
    meta.append(badge(tool.registrationType, 'accent', t('registrationHelp')));
  }

  if (tool.inventoryOnly) meta.append(badge(t('emulation_inventoryOnly'),'warn',t('emulation_inventoryHelp')));
  if (tool.notInjected) {
    meta.append(badge(t('notInjected'), 'warn', t('notInjectedHelp')));
  }

  if (tool.schemaError) {
    meta.append(badge(t('tools_schemaError'), 'danger', tool.schemaError));
  }

  const card = el('button', {
    class: 'card card-button',
    type: 'button',
    title: t('tools_open1ToInspectIts', [String(tool.name)]),
  }, [
    el('span', { class: 'card-name', text: tool.name }),
    // A title is what the page calls the tool for people; the name is what an agent calls it.
    tool.title && tool.title !== tool.name
      ? el('span', { class: 'card-title', text: tool.title, title: t('tools_titleHelp') })
      : null,
    tool.description ? el('span', { class: 'card-desc', text: tool.description }) : null,
    inputSummary(tool),
    meta.childElementCount ? meta : null,
    el('span', {
      class: 'card-origin',
      text: tool.frameId === null ? tool.origin : `${tool.origin} · ${t('common_frameN', [String(tool.frameId)])}`,
    }),
  ]);

  card.addEventListener('click', () => onOpen(tool));
  return card;
}

export function renderTools(root, result, { onOpen = () => {}, tabId = null, url = null, recipes = null } = {}) {
  if (result.tools.length === 0) {
    root.replaceChildren(
      helpIntro(),
      el('h2', { text: t('noToolsTitle') }),
      el('p', { class: 'muted', text: t('noToolsBody') }),
    );
    if (recipes) root.append(recipes);
    // What became of the registrations, if Instrumentation Mode was there to see them; the
    // way to turn it on when it was not — a page with no tools is where that question starts.
    if (!renderMissingRegistrations(root, result.registrations)) {
      if (result.registrations?.instrumentedFrames) {
        root.append(el('p', { class: 'field-desc', text: t('noTools_instrumentOn') }));
      } else if (tabId !== null && url) {
        root.append(instrumentOffer(tabId, url));
      }
    }
    if (tabId !== null) {
      renderPageChecks(root, { tools: [], tabId, topOrigin: result.topOrigin ?? null });
    }
    return;
  }

  const checked = checkTools(result.tools).byTool;
  // One passive review per discovery: card badges and the severity facet read from it.
  const review = reviewSecurity({ discovery: result });
  const severityOf = (tool) => maxSeverity(review.byTool.get(tool.instanceId ?? tool.logicalId ?? tool.name) ?? []);
  const state = { query: '', annotations: [], origins: [], severities: [], severityOf, sort: 'name' };
  const facets = facetsOf(result.tools, { severityOf });

  const search = el('input', {
    type: 'search',
    class: 'search',
    placeholder: t('tools_searchTools'),
    'aria-label': t('tools_searchToolsByNameDescription'),
    title: t('tools_filterByNameDescriptionOr'),
  });
  search.addEventListener('input', () => {
    state.query = search.value;
    paint();
  });

  const chips = el('div', { class: 'chips' });
  const count = el('span', { class: 'muted count' });
  const list = el('div', {});

  // Chips are built once and then synced in place. Rebuilding them on every click would
  // destroy focus, so a keyboard user would lose their position on each filter.
  const syncs = [];

  root.replaceChildren(helpIntro(), search, chips, count, list, exportBar({
    label: t('tools_exportThisPageSTools'),
    build: () => toolsReport(result),
    note: t('tools_theReportListsTheTools'),
  }));
  if (recipes) list.before(recipes);

  // Registrations that never made it into the list, right under the list.
  renderMissingRegistrations(root, result.registrations);

  // Every saved check of every tool on the page, runnable in one click after a deploy.
  if (tabId !== null) renderPageChecks(root, { tools: result.tools, tabId, topOrigin: result.topOrigin ?? null });

  if (tabId !== null && url) {
    renderSnapshots(root, { tabId, url, origin: result.topOrigin ?? null });
  }
  buildChips();
  syncChips();
  paint();

  function syncChips() {
    for (const sync of syncs) sync();
  }

  function chip(label, title, active, onToggle) {
    const button = el('button', { class: 'chip', text: label, title });
    const sync = () => {
      button.classList.toggle('chip-active', active());
      button.setAttribute('aria-pressed', String(active()));
    };
    syncs.push(sync);
    button.addEventListener('click', () => {
      onToggle();
      syncChips();
      paint();
    });
    return button;
  }

  function buildChips() {
    chips.replaceChildren();
    syncs.length = 0;

    for (const facet of facets.annotations) {
      chips.append(chip(
        `${annotationLabel(facet.key)} ${facet.count}`,
        t('annotationDeclaredHelp'),
        () => state.annotations.includes(facet.key),
        () => {
          state.annotations = state.annotations.includes(facet.key)
            ? state.annotations.filter((k) => k !== facet.key)
            : [...state.annotations, facet.key];
        },
      ));
    }

    for (const facet of facets.severities) {
      chips.append(chip(
        `${severityLabel(facet.key)} ${facet.count}`,
        t('security_filterSeverity'),
        () => state.severities.includes(facet.key),
        () => {
          state.severities = state.severities.includes(facet.key)
            ? state.severities.filter((k) => k !== facet.key)
            : [...state.severities, facet.key];
        },
      ));
    }

    // Origin chips only earn their space when there is more than one origin.
    if (facets.origins.length > 1) {
      for (const facet of facets.origins) {
        chips.append(chip(
          `${shortOrigin(facet.key)} ${facet.count}`,
          facet.key,
          () => state.origins.includes(facet.key),
          () => {
            state.origins = state.origins.includes(facet.key)
              ? state.origins.filter((o) => o !== facet.key)
              : [...state.origins, facet.key];
          },
        ));
      }
    }

    const sort = el('button', {
      class: 'chip chip-sort',
      text: t('tools_sort1', [String(sortLabel(state.sort))]),
      title: t('tools_changeTheSortOrder'),
    });
    sort.addEventListener('click', () => {
      const order = ['name', 'origin', 'frame'];
      state.sort = order[(order.indexOf(state.sort) + 1) % order.length];
      sort.textContent = t('tools_sort1', [String(sortLabel(state.sort))]);
      paint();
    });
    chips.append(sort);
  }

  function paint() {
    const shown = filterTools(result.tools, state);
    count.textContent = shown.length === result.tools.length
      ? t('tools_countAll', [String(result.tools.length)])
      : t('tools_countShown', [String(shown.length), String(result.tools.length)]);

    if (shown.length === 0) {
      list.replaceChildren(el('p', { class: 'muted', text: t('tools_noToolMatchesTheseFilters') }));
      return;
    }

    list.replaceChildren(...shown.map((tool) => toolCard(tool, onOpen, result.tools, checked.get(tool.instanceId ?? tool.logicalId ?? tool.name), severityOf(tool))));
  }
}

// Turns Instrumentation Mode on for the page's site and reloads it, from the empty state.
function instrumentOffer(tabId, url) {
  const status = el('p', { class: 'field-note', hidden: '' });
  const button = el('button', { text: t('noTools_instrumentButton'), title: t('noTools_instrumentButtonHelp') });
  button.addEventListener('click', async () => {
    button.disabled = true;
    const out = await chrome.runtime.sendMessage({ type: 'instrument-set', url, on: true }).catch((e) => ({ error: String(e?.message ?? e) }));
    if (out?.error) {
      status.textContent = out.error;
      status.hidden = false;
      button.disabled = false;
      return;
    }
    chrome.tabs.reload(tabId).catch(() => {});
  });
  return el('div', {}, [
    el('p', { class: 'field-desc', text: t('noTools_instrumentHint') }),
    el('div', { class: 'row-inline' }, [button]),
    status,
  ]);
}

function shortOrigin(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
