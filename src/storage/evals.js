// Eval suites and the results of running them.
//
// Suites are small and hand-written, so they live in chrome.storage.local like the overrides.
// Results are kept per suite and capped: a comparison only ever needs the last two, and a
// developer iterating on a description would otherwise fill the profile with transcripts.

const SUITES_KEY = 'evalSuites';
const RESULTS_KEY = 'evalResults';

// Two is what compareSuites needs. A third would only be kept to be ignored.
const KEEP_RESULTS = 2;

async function read(key) {
  const stored = await chrome.storage.local.get(key);
  const value = stored?.[key];
  return value && typeof value === 'object' ? value : {};
}

export async function listSuites() {
  const map = await read(SUITES_KEY);
  return Object.values(map).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function getSuite(id) {
  return (await read(SUITES_KEY))[id] ?? null;
}

export async function saveSuite(suite) {
  const map = await read(SUITES_KEY);
  map[suite.id] = suite;
  await chrome.storage.local.set({ [SUITES_KEY]: map });
  return suite;
}

export async function deleteSuite(id) {
  const suites = await read(SUITES_KEY);
  delete suites[id];
  const results = await read(RESULTS_KEY);
  delete results[id];
  await chrome.storage.local.set({ [SUITES_KEY]: suites, [RESULTS_KEY]: results });
  return { deleted: true };
}

export async function listResults(suiteId) {
  return (await read(RESULTS_KEY))[suiteId] ?? [];
}

// Newest first, so "the last two" is the head of the list.
export async function appendResult(suiteId, result) {
  const map = await read(RESULTS_KEY);
  const kept = [result, ...(map[suiteId] ?? [])].slice(0, KEEP_RESULTS);
  map[suiteId] = kept;
  await chrome.storage.local.set({ [RESULTS_KEY]: map });
  return kept;
}

// How much is stored, for the data screen: suites, and results across all of them.
export async function evalsSummary() {
  const suites = await read(SUITES_KEY);
  const results = await read(RESULTS_KEY);
  return {
    suites: Object.keys(suites).length,
    results: Object.values(results).reduce((sum, list) => sum + (list?.length ?? 0), 0),
  };
}

export async function clearAllEvals() {
  await chrome.storage.local.set({ [SUITES_KEY]: {}, [RESULTS_KEY]: {} });
  return { cleared: true };
}

export async function clearResults(suiteId) {
  const map = await read(RESULTS_KEY);
  delete map[suiteId];
  await chrome.storage.local.set({ [RESULTS_KEY]: map });
  return { cleared: true };
}
