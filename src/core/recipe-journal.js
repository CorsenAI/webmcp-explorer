// Run evidence is bounded independently of reusable definitions. Full results stay in the
// active runner for bindings; a recovered journal is evidence only and is never resumed.
export const RECIPE_RESULT_CHARS = 20_000;
export const RECIPE_RUN_BYTES = 1_500_000;
export const RECIPE_RUNS_BYTES = 3_000_000;
export const RECIPE_DEFINITIONS_BYTES = 2_000_000;
export const byteSize = data => new TextEncoder().encode(JSON.stringify(data)).length;
export const recipeIsActive = run => ['running', 'paused', 'ready'].includes(run?.status);

export function journalRun(run) {
  const journal = structuredClone(run);
  for (const result of journal.results ?? []) {
    const outcome = result.outcome;
    if (typeof outcome?.result === 'string' && outcome.result.length > RECIPE_RESULT_CHARS) {
      outcome.resultLength = outcome.result.length;
      outcome.result = outcome.result.slice(0, RECIPE_RESULT_CHARS);
      outcome.resultTruncated = true;
    }
  }
  if (byteSize(journal) > RECIPE_RUN_BYTES) throw Error('This run exceeds the 1.5 MB local journal limit. No further step will run. Export the retained evidence before starting a smaller recipe.');
  return journal;
}

export function interruptedRecipe(run) {
  if (!recipeIsActive(run)) return run;
  return { ...run, status: 'interrupted', updatedAt: Date.now(),
    reason: 'Explorer or the browser restarted. This run will not resume. A pending tool may have applied its action; inspect the page before reviewing a new run.',
    pending: run.pending ? { ...run.pending, outcomeUnknown: true } : null };
}

export function keepRecipeRuns(runs, next) {
  const list = [next, ...runs.filter(run => run.id !== next.id)];
  // Evict only old completed evidence. Never displace another running/paused recipe.
  while (list.length > 8 || byteSize(list) > RECIPE_RUNS_BYTES) {
    const index = list.findLastIndex((run, i) => i > 0 && !recipeIsActive(run));
    if (index < 0) throw Error('Active recipe journals fill the 3 MB local limit. Stop and export another run before continuing.');
    list.splice(index, 1);
  }
  return list;
}
