// Snapshots of a page's WebMCP contract, and what changed since one was taken.
//
// It lives inside the Tools screen rather than behind its own rail icon, because a snapshot is
// a thing you do *to* the tool list you are looking at. A fifth icon would have made the rail
// a menu.
//
// Two questions it answers. The first nobody can answer from memory: "did this page's contract
// change since the last time I looked, and how?" The second is the one a deploy raises: "does
// staging expose what production exposes?" — a snapshot taken on another site, compared with
// this page, tools matched by name and frame because every identity differs with the origin.

import { el, badge, t } from '../dom.js';
import { CHANGE, MATCH } from '../../core/snapshots/diff.js';
import { describeSchemaChanges } from '../../core/snapshots/schema-changes.js';
import { reviewSavedCall, REVIEW } from '../../core/saved-calls.js';

function changeBadge(kind) {
  const map = {
    [CHANGE.added]: [t('snapshots_added'), 'ok', t('snapshots_addedHelp')],
    [CHANGE.removed]: [t('snapshots_removed'), 'danger', t('snapshots_removedHelp')],
    [CHANGE.moved]: [t('snapshots_movedFrame'), 'warn', t('snapshots_movedFrameHelp')],
    [CHANGE.changed]: [t('snapshots_contractChanged'), 'warn', null],
    [CHANGE.unchanged]: [t('snapshots_unchanged'), 'accent', null],
  };
  return map[kind];
}

function detailText(detail) {
  const map = {
    title: t('snapshots_title'),
    description: t('snapshots_description'),
    schema: t('snapshots_inputSchema'),
    annotations: t('snapshots_annotations'),
    'schema-error': t('snapshots_whetherItsSchemaCanBe'),
  };
  return map[detail] ?? detail;
}

const when = (ms) => (ms ? new Date(ms).toLocaleString() : t('snapshots_unknownTime'));

const emptyLine = () => el('p', {
  class: 'field-desc',
  text: t('snapshots_noSnapshotOfThisSite'),
});

export function renderSnapshots(root, { tabId, url, origin }) {
  // Rendered now, not after the round trip: an empty box that fills in a moment later reads
  // as a bug the first time and as slowness every time after.
  const listHost = el('div', {}, [emptyLine()]);
  const otherHost = el('div');
  const diffHost = el('div');
  const status = el('p', { class: 'field-note', hidden: '' });

  const label = el('input', {
    type: 'text', id: 'sn-label', placeholder: t('snapshots_labelThisSnapshotBeforeDeploy'),
  });

  const take = el('button', {
    class: 'primary',
    text: t('snapshots_saveASnapshot'),
    title: t('snapshots_recordTheToolsThisPage'),
  });
  take.addEventListener('click', async () => {
    take.disabled = true;
    const out = await chrome.runtime.sendMessage({
      type: 'snapshot-save', tabId, url, origin, label: label.value.trim() || null,
    });
    take.disabled = false;
    if (out?.error) return say(out.error);
    label.value = '';
    say(t('snapshots_saved', [String(out.kept)]));
    await refresh();
  });

  const box = el('details', { class: 'sn-bar' });
  box.append(
    el('summary', { text: t('snapshots_snapshots'), title: t('help_snapshots') }),
    el('p', {
      class: 'field-desc',
      text: t('snapshots_aToolListIsA'),
    }),
    el('div', { class: 'field' }, [label]),
    el('div', { class: 'row-inline' }, [take]),
    status,
    listHost,
    otherHost,
    diffHost,
  );
  root.append(box);

  refresh();

  function say(text) {
    status.textContent = text;
    status.hidden = false;
  }

  async function refresh() {
    const [snapshots, origins] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'snapshot-list', origin }),
      chrome.runtime.sendMessage({ type: 'snapshot-origins' }),
    ]);
    const list = Array.isArray(snapshots) ? snapshots : [];
    listHost.replaceChildren(...(list.length ? list.map((snapshot) => row(snapshot)) : [emptyLine()]));
    renderOtherSites((Array.isArray(origins) ? origins : []).filter((o) => o.origin !== origin));
  }

  function row(snapshot) {
    const chips = [badge(t('tools_countAll', [String(snapshot.tools.length)]), 'accent')];
    if (snapshot.complete === false) {
      chips.push(badge(t('snapshots_partialCapture'), 'warn',
        t('snapshots_someFramesWereNotObserved')));
    }

    const compare = el('button', {
      text: t('snapshots_compareWithNow'),
      title: t('snapshots_whatChangedBetweenThisSnapshot'),
    });
    compare.addEventListener('click', () => compareWith(origin, snapshot.id, compare));

    const remove = el('button', { text: t('evals_delete'), title: t('snapshots_deleteThisSnapshot') });
    remove.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'snapshot-delete', origin, id: snapshot.id });
      diffHost.replaceChildren();
      await refresh();
    });

    return el('div', { class: 'card sn-row' }, [
      el('p', { class: 'card-name', text: snapshot.label || when(snapshot.takenAt) }),
      snapshot.label
        ? el('p', { class: 'card-origin', text: when(snapshot.takenAt) })
        : null,
      el('div', { class: 'card-meta' }, chips),
      el('div', { class: 'row-inline' }, [compare, remove]),
    ]);
  }

  async function compareWith(fromOrigin, id, button) {
    button.disabled = true;
    const out = await chrome.runtime.sendMessage({
      type: 'snapshot-diff', tabId, url, origin: fromOrigin, id,
    });
    button.disabled = false;
    if (out?.error) return say(out.error);
    renderDiff(diffHost, out.diff, { currentOrigin: origin });
  }

  // Snapshots of other sites: the same page in another environment, one pick away.
  function renderOtherSites(others) {
    if (!others.length) {
      otherHost.replaceChildren();
      return;
    }
    const site = el('select', { id: 'sn-site', title: t('snapshots_pickSite') });
    for (const other of others) {
      site.append(el('option', { value: other.origin, text: `${other.origin} (${other.count})` }));
    }
    const pick = el('select', { id: 'sn-other', title: t('snapshots_pickSnapshot') });
    const compare = el('button', { text: t('snapshots_compareCross'), title: t('snapshots_compareCrossHelp') });

    const fill = async () => {
      const list = await chrome.runtime.sendMessage({ type: 'snapshot-list', origin: site.value });
      pick.replaceChildren(...(Array.isArray(list) ? list : []).map((snapshot) => el('option', {
        value: snapshot.id, text: snapshot.label || when(snapshot.takenAt),
      })));
      compare.disabled = pick.childElementCount === 0;
    };
    site.addEventListener('change', fill);
    compare.addEventListener('click', () => compareWith(site.value, pick.value, compare));

    otherHost.replaceChildren(
      el('p', { class: 'field-group', text: t('snapshots_otherSites') }),
      el('p', { class: 'field-desc', text: t('snapshots_otherSitesHelp') }),
      el('div', { class: 'row-inline' }, [
        el('label', { class: 'field-label', for: 'sn-site', text: t('snapshots_pickSite') }), site,
      ]),
      el('div', { class: 'row-inline' }, [
        el('label', { class: 'field-label', for: 'sn-other', text: t('snapshots_pickSnapshot') }), pick, compare,
      ]),
    );
    fill();
  }
}

export function renderDiff(root, diff, { currentOrigin = null } = {}) {
  const chips = [];
  for (const kind of [CHANGE.added, CHANGE.removed, CHANGE.moved, CHANGE.changed]) {
    if (diff.counts[kind]) {
      const [label, tone] = changeBadge(kind);
      chips.push(badge(`${diff.counts[kind]} ${label}`, tone));
    }
  }
  if (!chips.length) chips.push(badge(t('snapshots_nothingChanged'), 'ok'));

  const cross = diff.matchBy === MATCH.name;
  const fromLabel = diff.from.label || when(diff.from.takenAt);
  const nodes = [
    el('p', { class: 'field-group', text: t('snapshots_sinceThatSnapshot') }),
    el('p', {
      class: 'field-desc',
      text: cross
        ? t('snapshots_crossHeader', [String(fromLabel), String(diff.from.origin ?? '?'),
          String(diff.to.origin ?? currentOrigin ?? '?')])
        : t('snapshots_1ThePageRightNow', [String(fromLabel)]),
    }),
    el('div', { class: 'card-meta' }, chips),
  ];

  // Across environments the origin differs by construction; saying so keeps a reader from
  // looking for an origin change in the list.
  if (cross) nodes.push(el('p', { class: 'field-desc sn-cross', text: t('snapshots_crossNote') }));

  // The honest caveat: an absence cannot be asserted from a capture that did not see
  // everything. Said before the list, not after it.
  if (diff.removalsUncertain) {
    nodes.push(el('p', {
      class: 'field-note',
      text: t('snapshots_oneOfTheTwoCaptures'),
    }));
  }

  for (const entry of diff.entries) {
    if (entry.change === CHANGE.unchanged) continue;
    const [text, tone, help] = changeBadge(entry.change);
    const meta = [badge(text, tone, help)];
    for (const detail of entry.details) {
      meta.push(badge(detailText(detail), 'accent', t('snapshots_whatChanged')));
    }

    const lines = [];
    if (entry.change === CHANGE.moved) {
      lines.push(el('p', {
        class: 'field-desc',
        text: t('snapshots_fromArrowTo', [
          entry.movedFrom ?? t('snapshots_unknownFrame'),
          entry.movedTo ?? t('snapshots_unknownFrame'),
        ]),
      }));
    }
    if (entry.details.includes('description')) {
      lines.push(snippet(t('snapshots_was'), entry.before?.description));
      lines.push(snippet(t('snapshots_now'), entry.after?.description));
    }
    if (entry.details.includes('title')) {
      lines.push(snippet(t('snapshots_was'), entry.before?.title));
      lines.push(snippet(t('snapshots_now'), entry.after?.title));
    }
    // What moved in the schema, in words — and what it does to the calls saved against it.
    const impacts = el('div', { class: 'sn-impacts' });
    if (entry.details.includes('schema') || (entry.fingerprintChanged && entry.after)) {
      const changes = entry.before && entry.after
        ? describeSchemaChanges(entry.before.inputSchema, entry.after.inputSchema)
        : [];
      if (changes.length) {
        lines.push(el('p', { class: 'field-desc', text: t('snapshots_schemaChanges') }));
        lines.push(el('ul', { class: 'sn-changes' }, changes.map((c) => el('li', { class: 'field-desc mono', text: c.text }))));
      } else if (entry.details.includes('schema')) {
        lines.push(el('p', { class: 'field-desc', text: t('snapshots_schemaMoved') }));
      }
      if (entry.after?.logicalId) savedCallImpacts(entry.after, impacts);
    }

    nodes.push(el('div', { class: 'card' }, [
      el('p', { class: 'card-name', text: entry.name }),
      el('div', { class: 'card-meta' }, meta),
      ...lines,
      impacts,
      el('p', { class: 'card-origin', text: entry.origin ?? '' }),
    ]));
  }

  if (diff.counts.unchanged) {
    nodes.push(el('p', {
      class: 'field-desc',
      text: diff.counts.unchanged === 1
        ? t('snapshots_oneToolUnchanged')
        : t('snapshots_nToolsUnchanged', [String(diff.counts.unchanged)]),
    }));
  }

  root.replaceChildren(el('div', { class: 'sn-diff' }, nodes));
}

// The saved calls of this tool, judged against the schema as it is now: the line a reader
// needs after "the contract changed" — how many calls that breaks, and the first reason.
// Filled in after the round trip; nothing is claimed until the calls have been read.
async function savedCallImpacts(afterTool, host) {
  const send = globalThis.chrome?.runtime?.sendMessage;
  if (typeof send !== 'function') return;
  let list;
  try {
    list = await chrome.runtime.sendMessage({ type: 'saved-calls-list', logicalId: afterTool.logicalId });
  } catch {
    return;
  }
  const calls = Array.isArray(list) ? list : [];
  if (!calls.length) return;
  const broken = calls
    .map((saved) => ({ saved, review: reviewSavedCall(saved, afterTool) }))
    .filter(({ review }) => review.status === REVIEW.needsReview);
  host.replaceChildren(broken.length
    ? el('p', { class: 'field-note sn-broken', text: t('snapshots_savedCallsAffected', [String(broken.length), broken[0].review.problems[0] ?? '']) })
    : el('p', { class: 'field-desc', text: t('snapshots_savedCallsFine', [String(calls.length)]) }));
}

function snippet(prefix, text) {
  return el('p', {
    class: 'field-desc',
    text: t('snapshots_prefixColonText', [String(prefix), String(text || t('snapshots_empty'))]),
  });
}
