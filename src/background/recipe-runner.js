import { toolContract } from '../core/export/safe.js';
// Sequential orchestration only. The injected execute/cancel functions are Explorer's
// existing coordinator; all definitions and bindings remain data, with no provider involved.
import { parseRecipe, recipeInputs, resolveRecipeArguments, reviewRecipeTarget,
  validateRecipeCall } from '../core/recipes.js';
import { interruptedRecipe, journalRun } from '../core/recipe-journal.js';
import { judgeSavedCall } from '../core/saved-calls.js';
import { consumeOnce } from '../core/overrides.js';

const clone = data => structuredClone(data);
const active = context => context && ['ready', 'running', 'paused'].includes(context.run.status);
const message = error => String(error?.message ?? error);

export function createRecipeRunner(io) {
  const contexts = new Map(), reviews = new Map(), busy = new Set();
  const now = () => Date.now();
  const id = () => crypto.randomUUID();

  async function inspect(tabId, recipe, supplied) {
    const tab = await io.tab(tabId);
    if (!tab?.url) throw Error('The selected page is no longer available.');
    if (JSON.stringify(supplied).length > 200_000) throw Error('Recipe input values must fit within 200000 characters.');
    const inputs = recipeInputs(recipe, supplied);
    const discovery = await io.discover(tabId, tab.url);
    if (discovery.error) throw Error(discovery.error);
    if (discovery.topOrigin !== recipe.topOrigin) throw Error('This recipe belongs to another site. Open its recorded page before review.');
    const root = discovery.frames?.find(frame => frame.frameId === 0);
    if (!root?.documentId) throw Error('The top-level page could not be identified. Check site access.');
    const targets = recipe.steps.map((step, index) => {
      const target = reviewRecipeTarget(step, discovery);
      if (target.error) throw Error(`Step ${index + 1}: ${target.error}`);
      // Literal/input-only steps can already be checked. Dependent arguments are checked
      // when the explicitly chosen earlier result exists, immediately before invocation.
      if (!step.bindings.some(binding => binding.source === 'step')) {
        validateRecipeCall(step, resolveRecipeArguments(step, inputs, []), target);
      }
      return target;
    });
    const ids = new Set(recipe.steps.map(step => step.tool.logicalId));
    const overrides = (await io.overrides()).filter(item => ids.has(item.logicalId))
      .sort((a,b) => a.logicalId.localeCompare(b.logicalId));
    return { pageUrl: tab.url, topDocumentId: root.documentId, targets, overrides };
  }

  function pins(review) {
    return JSON.stringify({ url: review.pageUrl, document: review.topDocumentId,
      targets: review.targets.map(({ tool, documentId }) => [tool.instanceId, tool.frameId,
        documentId, tool.contractFp, tool.offeredFp]), overrides: review.overrides });
  }

  async function publish(context) {
    context.run.updatedAt = now();
    const snapshot = journalRun(context.run);
    try { await io.save(snapshot); }
    catch (error) { throw Object.assign(new Error(message(error)), { recipeJournal: true }); }
    context.visible = snapshot;
    io.publish(clone(snapshot));
  }

  // A failed post-call journal may mean an action happened but its answer was not saved.
  // Keep the previous durable evidence, flag uncertainty, and never issue another call.
  async function storageFailure(context, error) {
    context.stopReason = `Run stopped because its evidence could not be saved: ${message(error)}. A pending action may have completed. Nothing will resume automatically.`;
    context.run.status = 'interrupted'; context.run.reason = context.stopReason;
    const visible = { ...(context.visible ?? journalRun({ ...context.run, results: [] })),
      status: 'interrupted', reason: context.stopReason, updatedAt: now() };
    context.visible = visible;
    io.publish(clone(visible));
  }

  async function finish(context, status, reason) {
    context.run.status = status; context.run.reason = reason;
    try { await publish(context); } catch (error) { await storageFailure(context, error); }
    if(!active(context)){
      context.fullResults=[];
      const completed=[...contexts.entries()].filter(([,value])=>!active(value));
      for(const [tabId] of completed.slice(0,Math.max(0,completed.length-8)))contexts.delete(tabId);
    }
  }

  async function drive(context, mode) {
    if (context.driving || !active(context)) throw Error('This recipe is already running or requires a new review.');
    context.driving = true; context.pause = mode === 'next';
    context.run.status = 'running';
    const release = io.hold();
    try {
      while (!context.stopReason && context.run.results.length < context.recipe.steps.length) {
        const fresh = await inspect(context.run.tabId, context.recipe, context.supplied);
        if (pins(fresh) !== pins(context.review)) throw Error('The page, frame, contract or overrides changed after review. Inspect the completed steps and review a new run.');
        if (context.stopReason) break;
        const index = context.run.results.length, step = context.recipe.steps[index];
        const target = fresh.targets[index];
        const args = resolveRecipeArguments(step, context.inputs, context.fullResults);
        const call = validateRecipeCall(step, args, target);
        const callId = id();
        context.run.pending = { stepId: step.id, index, callId, args: clone(args),
          documentId: call.documentId, startedAt: now() };
        context.run.reason = 'Waiting for the tool. Complete any interaction requested by the page; Explorer will not confirm it for you.';
        await publish(context); // Required durable write BEFORE an action is invoked.
        if (context.stopReason) break;
        const unwatch = io.watch?.(context.run.tabId, target.documentId,
          reason => stop(context.run.tabId, reason)) ?? (() => {});
        let outcome;
        try {
          outcome = await io.execute(context.run.tabId, { frameId: target.tool.frameId,
            documentId: target.documentId, toolName: target.tool.name, origin: target.tool.origin,
            args, tool: target.tool, topOrigin: context.recipe.topOrigin, callId,
            expectedOverride: fresh.overrides.find(item => item.logicalId === target.tool.logicalId) ?? null });
        } catch (error) {
          outcome = { ok: false, code: 'execution-interrupted', callId,
            error: `The call could not be confirmed: ${message(error)}. Its action may have happened; it will not be retried automatically.` };
        } finally { unwatch(); }
        io.record(context.run.tabId, outcome);
        const result = { stepId: step.id, index, name: step.tool.name, args: clone(args),
          outcome, check: step.expect ? judgeSavedCall(step, outcome) : null,
          unchecked: call.unchecked };
        const retainedChars=context.fullResults.reduce((sum,item)=>sum+(item.outcome?.result?.length??0),0);
        // Full live JSON is useful for bindings, but never grows without a bound. An excerpt
        // is explicitly ineligible as a binding source; no partial JSON is guessed at.
        context.fullResults.push(retainedChars+(outcome.result?.length??0)>2_000_000
          ? {...result,outcome:{...outcome,result:(outcome.result??'').slice(0,20_000),resultTruncated:true}}
          : result);
        context.run.results.push(journalRun({ results: [result] }).results[0]);
        context.run.pending = null;
        // A reviewed once-mock is expected to be spent by this call, not a silent change.
        if (outcome.mocked) context.review.overrides = context.review.overrides.map(item =>
          item.logicalId === step.tool.logicalId ? consumeOnce(item) : item);
        if (context.stopReason) break;
        if (outcome.cancelled || outcome.code === 'cancelled') {
          await finish(context, 'stopped', 'The call was cancelled. Its page action may already have happened; later steps were not run.'); return;
        }
        if (!outcome.ok || result.check?.verdict === 'fail') {
          await finish(context, 'failed', !outcome.ok ? `Step ${index + 1} failed: ${outcome.error ?? outcome.code ?? 'no result'}` : `Step ${index + 1} check failed: ${result.check.reason}`); return;
        }
        if (context.run.results.length === context.recipe.steps.length) {
          await finish(context, 'completed', 'Every step completed. Inspect the individual results and checks below.'); return;
        }
        if (context.pause) {
          await finish(context, 'paused', 'Paused before the next step. Choose Run next step or Run remaining to continue this reviewed run.'); return;
        }
        await publish(context);
      }
      if (context.stopReason) await finish(context, 'stopped', context.stopReason);
    } catch (error) {
      if (error.recipeJournal) await storageFailure(context, error);
      else await finish(context, 'failed', message(error));
    } finally {
      context.driving = false; release();
    }
  }

  async function stop(tabId, reason = 'Stopped by you. Completed actions are not undone. A pending call may still have applied its action; review the page before another run.') {
    reviews.delete(tabId);
    const context = contexts.get(tabId);
    if (!active(context)) return { stopped: false };
    context.stopReason = reason; context.run.reason = reason;
    // Mark intent immediately; in-flight completion retains its outcome and terminates.
    if (context.run.pending) await io.cancel(tabId, context.run.pending.callId).catch(() => {});
    if (!context.driving) await finish(context, 'stopped', reason);
    return { stopped: true };
  }

  return {
    async recover(runs) {
      let count = 0;
      for (const old of runs) {
        const run = interruptedRecipe(old);
        if (run !== old) { await io.save(run); count += 1; }
      }
      return { recipesInterrupted: count };
    },
    async review({ tabId, recipe: data, inputs = {} }) {
      if (active(contexts.get(tabId))) throw Error('Stop or finish the current recipe before reviewing another.');
      const recipe = parseRecipe(JSON.stringify(data));
      const review = { ...await inspect(tabId, recipe, inputs), token: id(), at: now(), recipe, supplied: clone(inputs) };
      reviews.set(tabId, review);
      return clone(review);
    },
    async start({ tabId, token, mode = 'all' }) {
      if (busy.has(tabId) || active(contexts.get(tabId))) throw Error('A recipe is already starting or running on this page.');
      if (!['next', 'all'].includes(mode)) throw Error('Choose Run next step or Run remaining.');
      busy.add(tabId);
      try {
        const review = reviews.get(tabId);
        if (!review || review.token !== token || now() - review.at > 120_000) throw Error('Review this recipe again before running it.');
        const fresh = await inspect(tabId, review.recipe, review.supplied);
        if (reviews.get(tabId) !== review || pins(fresh) !== pins(review)) throw Error('The reviewed page or tools changed. Review again before starting.');
        reviews.delete(tabId);
        const run = { id: id(), recipeId: review.recipe.id, name: review.recipe.name,
          topOrigin: review.recipe.topOrigin, pageUrl: review.pageUrl, tabId, status: 'ready',
          startedAt: now(), updatedAt: now(), reason: '', results: [], pending: null,
          definition: clone(review.recipe), contracts: review.targets.map(({tool})=>toolContract(tool)), inputValues: clone(review.supplied),
          overrides: clone(review.overrides) };
        const context = { run, recipe: review.recipe, review, supplied: review.supplied,
          inputs: recipeInputs(review.recipe, review.supplied), fullResults: [], driving: false,
          pause: false, stopReason: null, visible: null };
        contexts.set(tabId, context);
        try { await publish(context); }
        catch (error) { await storageFailure(context, error); throw error; }
        if (context.stopReason) await finish(context, 'stopped', context.stopReason);
        else void drive(context, mode);
        return { run: clone(context.visible) };
      } finally { busy.delete(tabId); }
    },
    async continue(tabId, mode) {
      const context = contexts.get(tabId);
      if (!context || context.driving || context.run.status !== 'paused') throw Error('This run cannot resume. Review a new run; completed actions will not be repeated automatically.');
      if (!['next', 'all'].includes(mode)) throw Error('Choose Run next step or Run remaining.');
      void drive(context, mode); return { continued: true };
    },
    async pause(tabId) {
      const context = contexts.get(tabId);
      if (!context?.driving) return { paused: false };
      context.pause = true; context.run.reason = 'Pause requested. The current step may finish; the next step will wait.';
      try { await publish(context); } catch (error) { await storageFailure(context, error); }
      return { paused: true };
    },
    stop,
    state: tabId => clone(contexts.get(tabId)?.visible ?? null),
    activity: tabId => active(contexts.get(tabId)),
    async stopAll(reason) { reviews.clear(); await Promise.all([...contexts.keys()].map(tabId => stop(tabId, reason))); },
    forgetReview: tabId => reviews.delete(tabId),
  };
}
