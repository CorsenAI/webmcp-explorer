// Re-checks the posture of open tabs against their saved baselines (S3). Passive only: it runs
// the ordinary discovery and the ordinary review on tabs that are already open and whose origin
// Explorer may inspect; it never opens a page, never runs a probe, never leaves the device. A
// regression or a changed contract paints the action badge; the panel shows the detail. Off until the person turns
// it on in Settings; the alarm lives and dies with that setting.

import { discover } from './discover.js';
import { reviewSecurity } from '../core/security/review.js';
import { diffBaseline, summarizeDiff } from '../core/security/baseline.js';
import { listBaselines, updateBaselineCheck, getRecheck, setRecheck, RECHECK_ALARM } from '../storage/security.js';
import { hasOrigin } from '../shared/permissions.js';

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export async function recheckOpenTabs() {
  const baselines = await listBaselines();
  if (!baselines.length) {
    // Nothing to compare any more: a badge painted for a forgotten baseline must go.
    await paintBadge(0);
    return { checked: [], regressed: 0, drifted: 0 };
  }
  const byOrigin = new Map(baselines.map((b) => [b.origin, b]));
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    tabs = [];
  }
  // Every open tab of an origin is reviewed: two pages of one site can expose different tools.
  // The origin's record keeps the tab with the most new findings, and the changed contracts of
  // all its tabs by tool name: one page's new findings must not hide another page's rewritten
  // description, and a tool open on two pages counts once.
  const perOrigin = new Map();
  const worse = (a, b) => (a.regressed && !b.regressed) || (a.regressed === b.regressed && a.added > b.added);
  for (const tab of tabs) {
    // A tab's url is visible only for origins Explorer may inspect; others are simply skipped.
    const origin = originOf(tab.url);
    if (!origin || !byOrigin.has(origin)) continue;
    if (!(await hasOrigin(tab.url))) continue;
    try {
      const discovery = await discover(tab.id, tab.url);
      if (!discovery || discovery.error) continue;
      const review = reviewSecurity({ discovery });
      const diff = diffBaseline(byOrigin.get(origin), review, discovery);
      if (!diff) continue;
      const entry = { origin, tabId: tab.id, url: tab.url, ...summarizeDiff(diff) };
      const record = perOrigin.get(origin) ?? { worst: null, tabs: 0, changed: new Set(), described: new Set() };
      record.tabs += 1;
      for (const c of diff.contractsChanged) {
        record.changed.add(c.name);
        if (c.parts?.includes('description')) record.described.add(c.name);
      }
      if (!record.worst || worse(entry, record.worst)) record.worst = entry;
      perOrigin.set(origin, record);
    } catch {
      // A tab that cannot be inspected right now is skipped; the next check tries again.
    }
  }
  const checked = [...perOrigin.values()].map((r) => ({ ...r.worst, tabs: r.tabs,
    contractsChanged: r.changed.size, descriptionsChanged: r.described.size, drifted: r.changed.size > 0 }));
  // Counts only are stored on the baseline (PRIVACY): the tab's URL stays in this result.
  for (const c of checked) await updateBaselineCheck(c.origin, { at: c.at, added: c.added, maxAdded: c.maxAdded, resolved: c.resolved, toolsAdded: c.toolsAdded, toolsRemoved: c.toolsRemoved, contractsChanged: c.contractsChanged, descriptionsChanged: c.descriptionsChanged, regressed: c.regressed, drifted: c.drifted, tabs: c.tabs });
  const regressed = checked.filter((c) => c.regressed).reduce((n, c) => n + c.added, 0);
  // A reviewed tool whose contract moved counts too: nothing new may be flagged, and yet the
  // description an agent reads is no longer the one that was reviewed.
  const drifted = checked.reduce((n, c) => n + (c.contractsChanged ?? 0), 0);
  await paintBadge(regressed + drifted);
  return { checked, regressed, drifted };
}

async function paintBadge(count) {
  try {
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    if (count > 0) await chrome.action.setBadgeBackgroundColor({ color: '#a32d2d' });
  } catch {
    // No action badge on this surface: the panel still shows the diff.
  }
}

export async function applyRecheckSetting(setting) {
  const next = await setRecheck(setting);
  try {
    if (next.enabled) {
      await chrome.alarms.create(RECHECK_ALARM, { periodInMinutes: next.minutes });
    } else {
      await chrome.alarms.clear(RECHECK_ALARM);
      await paintBadge(0);
    }
  } catch (error) {
    return { ...next, error: String(error?.message ?? error) };
  }
  return next;
}

export async function recheckSetting() {
  const setting = await getRecheck();
  let alarm = null;
  try {
    alarm = await chrome.alarms.get(RECHECK_ALARM);
  } catch {
    alarm = null;
  }
  return { ...setting, alarm: alarm ? { periodInMinutes: alarm.periodInMinutes ?? null, scheduledTime: alarm.scheduledTime ?? null } : null };
}

export function installRecheckAlarm() {
  if (!chrome.alarms?.onAlarm) return;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === RECHECK_ALARM) recheckOpenTabs();
  });
}
