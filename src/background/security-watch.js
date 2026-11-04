// Re-checks the posture of open tabs against their saved baselines (S3). Passive only: it runs
// the ordinary discovery and the ordinary review on tabs that are already open and whose origin
// Explorer may inspect; it never opens a page, never runs a probe, never leaves the device. A
// regression paints the action badge; the panel shows the detail. Off until the person turns
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
    return { checked: [], regressed: 0 };
  }
  const byOrigin = new Map(baselines.map((b) => [b.origin, b]));
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    tabs = [];
  }
  // Every open tab of an origin is reviewed: two pages of one site can expose different tools.
  // The origin's record keeps the tab that moved the most, and says how many tabs were seen.
  const perOrigin = new Map();
  for (const tab of tabs) {
    // A tab's url is visible only for origins Explorer may inspect; others are simply skipped.
    const origin = originOf(tab.url);
    if (!origin || !byOrigin.has(origin)) continue;
    if (!(await hasOrigin(tab.url))) continue;
    try {
      const discovery = await discover(tab.id, tab.url);
      if (!discovery || discovery.error) continue;
      const review = reviewSecurity({ discovery });
      const summary = summarizeDiff(diffBaseline(byOrigin.get(origin), review, discovery));
      const entry = { origin, tabId: tab.id, url: tab.url, ...summary };
      const current = perOrigin.get(origin);
      if (!current) perOrigin.set(origin, { ...entry, tabs: 1 });
      else {
        const worse = (entry.regressed && !current.regressed) || (entry.regressed === current.regressed && entry.added > current.added);
        perOrigin.set(origin, { ...(worse ? entry : current), tabs: current.tabs + 1 });
      }
    } catch {
      // A tab that cannot be inspected right now is skipped; the next check tries again.
    }
  }
  const checked = [...perOrigin.values()];
  // Counts only are stored on the baseline (PRIVACY): the tab's URL stays in this result.
  for (const c of checked) await updateBaselineCheck(c.origin, { at: c.at, added: c.added, maxAdded: c.maxAdded, resolved: c.resolved, toolsAdded: c.toolsAdded, toolsRemoved: c.toolsRemoved, contractsChanged: c.contractsChanged, regressed: c.regressed, tabs: c.tabs });
  const regressed = checked.filter((c) => c.regressed).reduce((n, c) => n + c.added, 0);
  await paintBadge(regressed);
  return { checked, regressed };
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
