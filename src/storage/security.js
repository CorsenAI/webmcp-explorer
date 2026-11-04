// Which security findings the person has already looked at, per site. A mark is keyed by the
// finding's code, the tool's name and its contract fingerprint, so it holds while the contract
// holds and the finding returns, as new, the day the contract changes. chrome.storage.local:
// a small per-device note the user can see and clear in Settings (D-063).

const KEY = 'securityReviewed';
const MAX_ORIGINS = 50;
const MAX_PER_ORIGIN = 400;

export function reviewedKey(finding) {
  return `${finding.code}|${finding.toolName ?? ''}|${finding.contractFp ?? ''}`;
}

async function read() {
  try {
    const stored = await chrome.storage.local.get(KEY);
    const value = stored?.[KEY];
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

async function write(state) {
  await chrome.storage.local.set({ [KEY]: state });
}

export async function listReviewed(origin) {
  const state = await read();
  return new Set(Array.isArray(state[origin]?.keys) ? state[origin].keys : []);
}

export async function setReviewed(origin, key, on) {
  const state = await read();
  const keys = new Set(Array.isArray(state[origin]?.keys) ? state[origin].keys : []);
  if (on) keys.add(key); else keys.delete(key);
  if (keys.size === 0) {
    delete state[origin];
  } else {
    state[origin] = { keys: Array.from(keys).slice(-MAX_PER_ORIGIN), at: Date.now() };
  }
  // The oldest site falls off first; fifty sites is far more than anyone reviews at once.
  const origins = Object.keys(state).sort((a, b) => (state[a].at ?? 0) - (state[b].at ?? 0));
  while (origins.length > MAX_ORIGINS) delete state[origins.shift()];
  await write(state);
  return keys.size;
}

export async function countReviewed() {
  const state = await read();
  return Object.values(state).reduce((n, entry) => n + (Array.isArray(entry.keys) ? entry.keys.length : 0), 0);
}

export async function clearReviewed() {
  await chrome.storage.local.remove(KEY);
}

// Sites the person declared they control, which is the only place active probes may run (S2).
// Explicit, per origin, revocable here and in Settings; never inferred from anything.
const CONTROLLED = 'securityControlledOrigins';

export async function listControlled() {
  try {
    const stored = await chrome.storage.local.get(CONTROLLED);
    return new Set(Array.isArray(stored?.[CONTROLLED]) ? stored[CONTROLLED] : []);
  } catch {
    return new Set();
  }
}

export async function isControlled(origin) {
  return (await listControlled()).has(origin);
}

export async function setControlled(origin, on) {
  const set = await listControlled();
  if (on) set.add(origin); else set.delete(origin);
  await chrome.storage.local.set({ [CONTROLLED]: Array.from(set).slice(-MAX_ORIGINS) });
  return set.has(origin);
}

// Posture baselines (S3): one per origin, bounded, with the summary of the last re-check.
const BASELINES = 'securityBaselines';
const RECHECK = 'securityRecheck';
export const RECHECK_ALARM = 'security-recheck';
export const RECHECK_MINUTES = [15, 60, 240];

async function readBaselines() {
  try {
    const stored = await chrome.storage.local.get(BASELINES);
    const value = stored?.[BASELINES];
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export async function getBaseline(origin) {
  return (await readBaselines())[origin] ?? null;
}

export async function listBaselines() {
  return Object.values(await readBaselines()).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

export async function saveBaseline(baseline) {
  if (!baseline?.origin) return null;
  const all = await readBaselines();
  all[baseline.origin] = baseline;
  const origins = Object.keys(all).sort((a, b) => (all[a].at ?? 0) - (all[b].at ?? 0));
  while (origins.length > MAX_ORIGINS) delete all[origins.shift()];
  await chrome.storage.local.set({ [BASELINES]: all });
  return baseline;
}

export async function updateBaselineCheck(origin, lastDiff) {
  const all = await readBaselines();
  if (!all[origin]) return null;
  all[origin] = { ...all[origin], lastCheckAt: lastDiff?.at ?? Date.now(), lastDiff };
  await chrome.storage.local.set({ [BASELINES]: all });
  return all[origin];
}

export async function forgetBaseline(origin) {
  const all = await readBaselines();
  delete all[origin];
  await chrome.storage.local.set({ [BASELINES]: all });
}

export async function countBaselines() {
  return Object.keys(await readBaselines()).length;
}

// The re-check setting: off by default; passive reviews of open, granted tabs only.
export async function getRecheck() {
  try {
    const stored = await chrome.storage.local.get(RECHECK);
    const value = stored?.[RECHECK];
    return { enabled: value?.enabled === true, minutes: RECHECK_MINUTES.includes(value?.minutes) ? value.minutes : 60 };
  } catch {
    return { enabled: false, minutes: 60 };
  }
}

export async function setRecheck({ enabled, minutes }) {
  const next = { enabled: enabled === true, minutes: RECHECK_MINUTES.includes(minutes) ? minutes : 60 };
  await chrome.storage.local.set({ [RECHECK]: next });
  return next;
}

export async function clearSecurityData() {
  await chrome.storage.local.remove([KEY, CONTROLLED, BASELINES, RECHECK]);
}
