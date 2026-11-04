// Agent runs and eval progress, persisted so a service-worker restart cannot make them vanish.
//
// Measured before writing this: Chrome kills the worker mid-run — a 50-second provider call
// loses it between t+35 s and t+40 s — and the run then simply disappeared. `agent-state`
// answered `null`, so the panel showed "no run yet" for work the user had started and that had
// possibly already spent money. Losing it silently is the worst of the three possible
// behaviours, worse than reporting a failure.
//
// chrome.storage.session is the right home: it outlives the worker, it never touches the disk,
// and it dies with the browser session, which is exactly the lifetime of a run.

const AGENT_KEY = 'activeAgentRuns';
const EVALS_KEY = 'activeEvalRuns';

async function read(key) {
  try {
    const stored = await chrome.storage.session.get(key);
    const value = stored?.[key];
    return value && typeof value === 'object' ? value : {};
  } catch {
    // A worker that cannot read its own notes must still work; it just cannot recover.
    return {};
  }
}

async function write(key, value) {
  try {
    await chrome.storage.session.set({ [key]: value });
  } catch {
    // Failing to persist must never fail the run itself.
  }
}

export async function saveRunState(tabId, run) {
  const map = await read(AGENT_KEY);
  map[tabId] = run;
  await write(AGENT_KEY, map);
}

export async function dropRunState(tabId) {
  const map = await read(AGENT_KEY);
  if (!(tabId in map)) return;
  delete map[tabId];
  await write(AGENT_KEY, map);
}

export function loadRunStates() {
  return read(AGENT_KEY);
}

export async function saveEvalState(tabId, progress) {
  const map = await read(EVALS_KEY);
  map[tabId] = progress;
  await write(EVALS_KEY, map);
}

export async function dropEvalState(tabId) {
  const map = await read(EVALS_KEY);
  if (!(tabId in map)) return;
  delete map[tabId];
  await write(EVALS_KEY, map);
}

export function loadEvalStates() {
  return read(EVALS_KEY);
}

export async function replaceRunStates(map) {
  await write(AGENT_KEY, map);
}

export async function replaceEvalStates(map) {
  await write(EVALS_KEY, map);
}
