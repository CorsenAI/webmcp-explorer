// Session/group switcher and zero-network manual mode for Agent Lab.
// Extracted from views/agent.js to keep each view module focused and within the ~400-line ceiling.

import { el, t } from '../dom.js';

export function renderSessionSwitcher(sessionsHost, {
  topOrigin,
  sessions = [],
  groups = [],
  groupFilter = null,
  viewing = null,
  busy = false,
  onNew,
  onSelect,
  onDelete,
  onFilterChange,
  onRefresh,
}) {
  const historyOpen = sessionsHost.querySelector('details')?.open ?? false;
  const newButton = el('button', {
    class: 'ag-new-session', text: t('agentSessions_new'), title: t('agentSessions_newHelp'),
  });
  newButton.disabled = busy;
  newButton.addEventListener('click', onNew);

  const list = el('details', { class: 'ag-sessions-list' });
  list.open = historyOpen;
  list.append(el('summary', {
    title: t('agentSessions_historyHelp'),
    text: sessions.length === 1
      ? t('agentSessions_historyOne')
      : t('agentSessions_historyN', [String(sessions.length)]),
  }));

  if (groups.length || sessions.length) {
    const chips = el('div', { class: 'ag-group-chips' });
    const chip = (label, active, onClick, title) => {
      const b = el('button', { class: `ag-group-chip${active ? ' ag-group-active' : ''}`, title });
      b.textContent = label;
      b.addEventListener('click', onClick);
      return b;
    };
    chips.append(chip(
      groupFilter ? t('agentSessions_allChats') : t('agentSessions_allChatsShort'),
      !groupFilter,
      () => onFilterChange(null),
      t('agentSessions_allChatsHelp'),
    ));
    for (const group of groups) {
      const count = sessions.filter((s) => s.groupId === group.id).length;
      const b = chip(`${group.name} (${count})`, groupFilter === group.id, () => {
        onFilterChange(groupFilter === group.id ? null : group.id);
      }, group.name);
      const del = el('button', {
        class: 'ag-group-del', title: t('agentSessions_groupDeleteHelp'), text: '×',
        'aria-label': `${t('agentSessions_groupDeleteHelp')}: ${group.name}`,
      });
      del.addEventListener('click', async (event) => {
        event.stopPropagation();
        await chrome.runtime.sendMessage({
          type: 'agent-session-group-delete', origin: topOrigin, groupId: group.id,
        });
        if (groupFilter === group.id) onFilterChange(null, { refresh: false });
        await onRefresh();
      });
      chips.append(el('span', { class: 'ag-group-pair' }, [b, del]));
    }
    const newGroup = chip(t('agentSessions_groupNew'), false, async () => {
      const name = window.prompt(t('agentSessions_groupNewPrompt'));
      if (!name) return;
      await chrome.runtime.sendMessage({
        type: 'agent-session-group-create', origin: topOrigin, name,
      });
      await onRefresh();
    }, t('agentSessions_groupNewHelp'));
    newGroup.classList.add('ag-group-add');
    chips.append(newGroup);
    list.append(chips);
  }

  const shownSessions = groupFilter
    ? sessions.filter((s) => s.groupId === groupFilter)
    : sessions;
  if (!shownSessions.length) {
    list.append(el('p', {
      class: 'field-desc',
      text: groupFilter ? t('agentSessions_groupEmpty') : t('agentSessions_empty'),
    }));
  }

  for (const session of shownSessions) {
    const goals = session.transcript.filter((entry) => entry.role === 'user').length;
    const group = groups.find((g) => g.id === session.groupId) ?? null;
    const meta = [
      new Date(session.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
      goals === 1 ? t('agentSessions_oneTurn') : t('agentSessions_nTurns', [String(goals)]),
      ...(group ? [group.name] : []),
    ].join(' · ');
    const open = el('button', { class: 'ag-session-open', title: session.title });
    open.disabled = busy;
    open.append(
      el('span', { class: 'ag-session-title', text: session.title }),
      el('span', { class: 'ag-session-meta', text: meta }),
    );
    if (viewing?.id === session.id) open.classList.add('ag-session-current');
    open.addEventListener('click', () => {
      list.open = false;
      onSelect(session);
    });
    const remove = el('button', {
      class: 'ag-session-delete', text: t('agentSessions_delete'),
      title: t('agentSessions_deleteHelp'),
    });
    remove.disabled = busy;
    remove.addEventListener('click', () => onDelete(session));
    const row = el('div', { class: 'row-inline ag-session-row' }, [open, remove]);
    if (groups.length) {
      const move = el('select', { class: 'ag-session-group', title: t('agentSessions_moveToGroup') });
      move.append(el('option', { value: '', text: t('agentSessions_noGroup') }));
      for (const g of groups) {
        move.append(el('option', { value: g.id, text: g.name }));
      }
      move.value = session.groupId ?? '';
      move.addEventListener('click', (event) => event.stopPropagation());
      move.addEventListener('change', async () => {
        await chrome.runtime.sendMessage({
          type: 'agent-session-group-assign', origin: topOrigin,
          sessionId: session.id, groupId: move.value || null,
        });
        await onRefresh();
      });
      row.append(move);
    }
    list.append(row);
  }

  sessionsHost.replaceChildren(el('div', { class: 'row-inline ag-sessions-bar' }, [list, newButton]));
}

export async function renderManualMode(manualHost, { tabId, isRunning, onRunUpdate }) {
  const { request, error } = await chrome.runtime.sendMessage({
    type: 'agent-manual-prompt', tabId,
  });
  if (error) {
    manualHost.replaceChildren(el('p', { class: 'field-note', text: error }));
    return;
  }

  const box = el('textarea', { id: 'ag-manual-out', rows: '6', class: 'mono', title: t('agent_manualMode') });
  box.value = request;
  box.readOnly = true;

  const copy = el('button', { text: t('agent_copyRequest'), title: t('agent_copyItToTheClipboard') });
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(request);
    copy.textContent = t('agent_copied');
    setTimeout(() => { copy.textContent = t('agent_copyRequest'); }, 1200);
  });

  const reply = el('textarea', {
    id: 'ag-manual-in', rows: '4', class: 'mono',
    placeholder: t('agent_pasteTheModelReplyHere'),
  });
  const feed = el('button', { class: 'primary', text: t('agent_feedTheReplyBack'), title: t('help_manualReply') });
  feed.addEventListener('click', async () => {
    feed.disabled = true;
    const out = await chrome.runtime.sendMessage({
      type: 'agent-manual-reply', tabId, text: reply.value,
    });
    feed.disabled = false;
    if (out?.error) {
      manualHost.append(el('p', { class: 'field-note', text: out.error }));
      return;
    }
    reply.value = '';
    onRunUpdate(out.run);
    if (isRunning(out.run)) await renderManualMode(manualHost, { tabId, isRunning, onRunUpdate });
  });

  manualHost.replaceChildren(
    el('p', { class: 'field-group', text: t('agent_manualMode') }),
    el('p', { class: 'field-desc', text: t('agent_explorerSendsNothingCopyThis') }),
    box,
    el('div', { class: 'row-inline' }, [copy]),
    reply,
    el('div', { class: 'row-inline' }, [feed]),
  );
}
