import { parseRecipe } from '../core/recipes.js';
import { byteSize, journalRun, keepRecipeRuns, recipeIsActive,
  RECIPE_DEFINITIONS_BYTES } from '../core/recipe-journal.js';

// Serial writes prevent two panel messages from overwriting each other's definitions or
// pre-invocation journals. Failure is propagated; the runner must not call a tool after it.
export function createRecipeStorage(area) {
  let tail = Promise.resolve();
  const serial = task => {
    const next = tail.then(task); tail = next.catch(() => {}); return next;
  };
  const read = async key => (await area.get(key))[key] ?? [];
  return {
    definitions: () => read('recipes'),
    runs: () => read('recipeRuns'),
    save: recipe => serial(async () => {
      const saved = parseRecipe(JSON.stringify(recipe)); saved.updatedAt = Date.now();
      const next = [saved, ...(await read('recipes')).filter(item => item.id !== saved.id)];
      if (next.length > 30 || byteSize(next) > RECIPE_DEFINITIONS_BYTES) throw Error('Saved recipes reached their limit (30 definitions or 2 MB). Export and delete a recipe before saving another.');
      await area.set({ recipes: next }); return saved;
    }),
    delete: id => serial(async () => {
      await area.set({ recipes: (await read('recipes')).filter(item => item.id !== id) });
      return { deleted: true };
    }),
    writeRun: run => serial(async () => {
      const next = journalRun(run);
      await area.set({ recipeRuns: keepRecipeRuns(await read('recipeRuns'), next) });
      return next;
    }),
    clear: () => serial(async () => {
      if ((await read('recipeRuns')).some(recipeIsActive)) throw Error('Stop the active recipes before deleting recipe data.');
      await area.set({ recipes: [], recipeRuns: [] }); return { cleared: true };
    }),
    deleteRun: id => serial(async () => {
      const runs = await read('recipeRuns');
      if (runs.some(run => run.id === id && recipeIsActive(run))) throw Error('Stop this run before deleting its evidence.');
      await area.set({ recipeRuns: runs.filter(run => run.id !== id) }); return { deleted: true };
    }),
  };
}
