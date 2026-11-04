import { createRecipeStorage } from '../storage/recipes.js';
import { createRecipeRunner } from './recipe-runner.js';
import { discover } from './discover.js';
import { runTool, cancelTool } from './execute.js';
import { recordExecution } from './live.js';
import { listOverrides } from '../storage/overrides.js';
import { hold } from './keepalive.js';
import { isDemoTabId } from './demo-bridge.js';
import { demoUrl } from '../shared/demo.js';

export const recipeStorage = createRecipeStorage(chrome.storage.local);

function watchDocument(tabId, documentId, stop) {
  if (isDemoTabId(tabId)) return () => {};
  let ended = false, checking = false;
  const timer = setInterval(async () => {
    if (ended || checking) return;
    checking = true;
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId, documentIds: [documentId] }, func: () => true });
      if (!ended && results[0]?.result !== true) await stop('The running frame is no longer available. No later step was started; inspect the page before reviewing another run.');
    } catch {
      if (!ended) await stop('The running frame navigated away or lost site access. Its action may have happened; no later step will start.');
    } finally { checking = false; }
  }, 1000);
  return () => { ended = true; clearInterval(timer); };
}

export const recipes = createRecipeRunner({
  tab: async tabId => {
    const tab=await chrome.tabs.get(tabId);
    return isDemoTabId(tabId)?{...tab,url:tab.url??demoUrl()}:tab;
  }, discover, overrides: listOverrides,
  execute: runTool, cancel: cancelTool, record: recordExecution, hold,
  save: recipeStorage.writeRun, watch: watchDocument,
  publish: run => { chrome.runtime.sendMessage({ type: 'recipe-progress', tabId: run.tabId, run }).catch(() => {}); },
});

const recovered = recipeStorage.runs().then(runs => recipes.recover(runs));
// Register immediately but gate every request on durable recovery; a failed recovery cannot
// accidentally turn inherited running data into a resumable job.
const ready = fn => async msg => { await recovered; return fn(msg); };
export const recipeHandlers = {
  'recipe-list': ready(() => recipeStorage.definitions()),
  'recipe-save': ready(msg => recipeStorage.save(msg.recipe)),
  'recipe-delete': ready(msg => recipeStorage.delete(msg.id)),
  'recipe-runs': ready(() => recipeStorage.runs()),
  'recipe-run-delete': ready(msg => recipeStorage.deleteRun(msg.id)),
  'recipe-review': ready(msg => recipes.review(msg)),
  'recipe-start': ready(msg => recipes.start(msg)),
  'recipe-next': ready(msg => recipes.continue(msg.tabId, 'next')),
  'recipe-remaining': ready(msg => recipes.continue(msg.tabId, 'all')),
  'recipe-pause': ready(msg => recipes.pause(msg.tabId)),
  'recipe-stop': ready(msg => recipes.stop(msg.tabId)),
  'recipe-state': ready(async msg => ({ run: recipes.state(msg.tabId)
    ?? (await recipeStorage.runs()).find(run => run.tabId === msg.tabId) ?? null })),
};

export const recoverRecipes = () => recovered;
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' || info.url) {
    recipes.stop(tabId, 'The selected page navigated. Completed actions are retained; no later step will run. Review the page before starting again.').catch(() => {});
  }
});
