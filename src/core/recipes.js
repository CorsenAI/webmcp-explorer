// A recipe is reviewed data: ordered calls with explicit input/result bindings, never code.
import { normalizeExpect } from './saved-calls.js';
import { validateFieldExpectation } from './field-checks.js';
import { jsonType, parseFieldJson, pointerParts, valueAtPointer } from './json-pointer.js';
import { canonicalJson, compareJsonNumbers } from './json-compare.js';
import { validateArguments } from './schema/validate.js';

export const RECIPE_KIND = 'webmcp-explorer/recipe';
export const RECIPE_VERSION = 1;
export const MAX_RECIPE_STEPS = 20;
export const MAX_RECIPE_CHARS = 200_000;
const named = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const copy = value => JSON.parse(JSON.stringify(value));

export function recipeStep(tool, args, { id = crypto.randomUUID(), expect = null } = {}) {
  return { id, tool: { logicalId: tool.logicalId, name: tool.name, origin: tool.origin,
    frameKey: tool.frameKey, frameIndexPath: tool.frameIndexPath ?? [], contractFp: tool.contractFp,
    offeredFp: tool.offeredFp ?? tool.contractFp }, argsJson: JSON.stringify(args ?? {}), bindings: [],
    expect: normalizeExpect(expect) };
}

export function createRecipe({ name = '', topOrigin, sourceUrl = '', steps = [], inputs = [],
  id = crypto.randomUUID(), at = Date.now() }) {
  return { kind: RECIPE_KIND, version: RECIPE_VERSION, id, name: name.trim(), topOrigin,
    sourceUrl, inputs: copy(inputs), steps: copy(steps), createdAt: at, updatedAt: at };
}

export function recipeProblems(recipe) {
  const errors = [];
  if (!recipe || recipe.kind !== RECIPE_KIND || recipe.version !== RECIPE_VERSION) return ['Unsupported recipe kind or version.'];
  if (!identifier(recipe.id)) errors.push('Recipe ID must contain 1–80 letters, digits, underscores or hyphens.');
  if (typeof recipe.name !== 'string' || !recipe.name.trim() || recipe.name.length > 120) errors.push('Give this recipe a name of 1–120 characters.');
  if (typeof recipe.topOrigin !== 'string' || !recipe.topOrigin || recipe.topOrigin.length > 2048) errors.push('A recipe must record its page origin.');
  if (typeof recipe.sourceUrl !== 'string' || recipe.sourceUrl.length > 4096) errors.push('The recorded page address is invalid.');
  if (!Array.isArray(recipe.inputs) || recipe.inputs.length > 20) return [...errors, 'A recipe supports at most 20 named inputs.'];
  if (!Array.isArray(recipe.steps) || !recipe.steps.length || recipe.steps.length > MAX_RECIPE_STEPS) return [...errors, `Choose 1–${MAX_RECIPE_STEPS} steps.`];
  if (JSON.stringify(recipe).length > MAX_RECIPE_CHARS) return [...errors, `A recipe definition must fit within ${MAX_RECIPE_CHARS} characters.`];
  const inputs = new Set();
  for (const input of recipe.inputs) {
    if (!input || !named(input.name) || inputs.has(input.name)) { errors.push('Input names must be unique, start with a letter and contain at most 40 letters, digits, underscores or hyphens.'); continue; }
    inputs.add(input.name);
    try { argumentValue(parseFieldJson(input.defaultJson)); } catch (error) { errors.push(`Input ${input.name}: ${error.message}`); }
  }
  const prior = new Set();
  for (const [index, step] of recipe.steps.entries()) {
    const prefix = `Step ${index + 1}: `;
    if (!step || !identifier(step.id) || prior.has(step.id)) { errors.push(prefix + 'step IDs must be valid and unique.'); continue; }
    if (!step.tool || !['logicalId', 'name', 'origin', 'frameKey', 'contractFp', 'offeredFp'].every(k => typeof step.tool[k] === 'string' && step.tool[k].length > 0 && step.tool[k].length <= 2048)) {
      errors.push(prefix + 'select a tool with a recorded page, frame and contract.');
    }
    if (!Array.isArray(step.tool?.frameIndexPath) || step.tool.frameIndexPath.length > 32
      || step.tool.frameIndexPath.some(n => !Number.isSafeInteger(n) || n < 0)) errors.push(prefix + 'the frame position is invalid.');
    let args;
    try {
      args = parseFieldJson(step.argsJson);
      if (jsonType(args) !== 'object') throw Error('Arguments must be a JSON object.');
      argumentValue(args);
    } catch (error) { errors.push(prefix + error.message); }
    const bindings = step.bindings;
    if (!Array.isArray(bindings) || bindings.length > 50) { errors.push(prefix + 'use at most 50 explicit bindings.'); prior.add(step.id); continue; }
    const destinations = [];
    for (const binding of bindings) {
      try {
        if (!binding || !['input', 'step'].includes(binding.source)) throw Error('Choose a named input or an earlier step result.');
        const parts = pointerParts(binding.path);
        if (destinations.some(old => old.slice(0, Math.min(old.length, parts.length)).every((p,i) => p === parts[i]))) throw Error('Bindings cannot replace the same field or overlap.');
        destinations.push(parts);
        if (args !== undefined && !valueAtPointer(args, binding.path).found) throw Error(`Argument field ${binding.path || '(root)'} is missing; add a reviewed placeholder first.`);
        if (binding.source === 'input' && !inputs.has(binding.input)) throw Error('The selected named input does not exist.');
        if (binding.source === 'step') {
          if (!prior.has(binding.stepId)) throw Error('A result binding must point to an earlier step.');
          pointerParts(binding.pointer);
        }
      } catch (error) { errors.push(prefix + error.message); }
    }
    if (step.expect) {
      const normalized = normalizeExpect(step.expect);
      if (!normalized) errors.push(prefix + 'unknown expectation.');
      else if (['equals', 'json-equals'].includes(normalized.kind)
        && (typeof step.expect.value !== 'string' || step.expect.value.length > 20_000)) {
        errors.push(prefix + 'expected text must contain at most 20000 characters.');
      } else if (normalized.kind === 'json-equals' && canonicalJson(normalized.value) === null) {
        errors.push(prefix + 'the expected result must be valid JSON.');
      }
      else if (normalized.kind === 'fields') {
        const problem = validateFieldExpectation(normalized); if (problem) errors.push(prefix + problem);
      }
    }
    prior.add(step.id);
  }
  return errors;
}

export function parseRecipe(text) {
  if (typeof text !== 'string' || text.length > MAX_RECIPE_CHARS) throw Error(`Recipe JSON must fit within ${MAX_RECIPE_CHARS} characters.`);
  // Validate duplicate fields and numeric spelling before the ordinary data envelope parse.
  const recipe = argumentValue(parseFieldJson(text));
  const errors = recipeProblems(recipe);
  if (errors.length) throw Error(errors.join('\n'));
  return recipe;
}

export function recipeInputs(recipe, supplied = {}) {
  const inputs = Object.create(null);
  for (const input of recipe.inputs) {
    const text = Object.hasOwn(supplied, input.name) ? supplied[input.name] : input.defaultJson;
    try { inputs[input.name] = parseFieldJson(text); argumentValue(inputs[input.name]); }
    catch (error) { throw Error(`Input ${input.name}: ${error.message}`); }
  }
  for (const name of Object.keys(supplied)) if (!Object.hasOwn(inputs, name)) throw Error(`Unknown recipe input ${name}.`);
  return inputs;
}

// Conversion goes through a checked JSON round trip. The existing executor takes ordinary
// JS data; a number it cannot preserve is rejected instead of quietly changing an ID/value.
export function argumentValue(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Error('Tool arguments require finite JSON numbers.');
    return value;
  }
  if (jsonType(value) === 'number') {
    const number = Number(value.text);
    if (!Number.isFinite(number) || compareJsonNumbers(value.text, JSON.stringify(number)) !== 0) {
      throw Error(`Number ${value.text.slice(0, 100)} cannot be preserved by the tool's JSON argument transport. Use a different value, or text only if the tool's schema allows it.`);
    }
    return number;
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(argumentValue);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, argumentValue(child)]));
}

export function resolveRecipeArguments(step, inputs, results) {
  let args = parseFieldJson(step.argsJson);
  for (const binding of step.bindings) {
    let value;
    if (binding.source === 'input') {
      if (!Object.hasOwn(inputs, binding.input)) throw Error(`Named input ${binding.input} is missing.`);
      value = inputs[binding.input];
    } else {
      const prior = results.find(result => result.stepId === binding.stepId);
      if (!prior || prior.outcome?.ok !== true || prior.outcome.resultTruncated) throw Error('The referenced step has no complete successful result.');
      const picked = valueAtPointer(parseFieldJson(prior.outcome.result), binding.pointer);
      if (!picked.found) throw Error(`Earlier result field ${binding.pointer || '(root)'} is missing.`);
      value = picked.value;
    }
    const parts = pointerParts(binding.path);
    if (!parts.length) { args = value; continue; }
    const target = valueAtPointer(args, '/' + parts.slice(0,-1).map(p=>p.replace(/~/g,'~0').replace(/\//g,'~1')).join('/'));
    const parent = parts.length === 1 ? args : target.value;
    if (!valueAtPointer(args, binding.path).found || parent === null || typeof parent !== 'object') throw Error('The reviewed argument field no longer exists.');
    Object.defineProperty(parent, parts.at(-1), { value, enumerable:true, configurable:true, writable:true });
  }
  if (jsonType(args) !== 'object') throw Error('Resolved arguments must be a JSON object.');
  return argumentValue(args);
}

export function reviewRecipeTarget(step, discovery) {
  const candidates = (discovery.tools ?? []).filter(tool => tool.logicalId === step.tool.logicalId
    && tool.name === step.tool.name && tool.origin === step.tool.origin && tool.frameKey === step.tool.frameKey
    && JSON.stringify(tool.frameIndexPath ?? []) === JSON.stringify(step.tool.frameIndexPath));
  if (candidates.length !== 1) return { error: candidates.length ? 'Several tools match this recorded frame; choose its exact target again.' : 'The recorded tool or frame is missing. Review this step.' };
  const tool = candidates[0];
  if (!Number.isInteger(tool.frameId) || tool.notInjected || tool.disabled) return { error: 'The tool cannot be executed in its recorded frame. Check site access and overrides.' };
  if (tool.contractFp !== step.tool.contractFp || (tool.offeredFp ?? tool.contractFp) !== step.tool.offeredFp) return { error: 'The tool contract changed. Review the current schema and update this step.' };
  const frame = discovery.frames?.find(frame => frame.frameId === tool.frameId);
  if (!frame?.documentId) return { error: 'The current frame document could not be identified.' };
  return { tool, documentId: frame.documentId };
}

export function validateRecipeCall(step, args, target) {
  const checked = validateArguments(target.tool.inputSchema, args);
  if (!checked.valid) throw Error(checked.errors.map(error => error.message).join('; '));
  return { stepId: step.id, args, tool: target.tool, documentId: target.documentId,
    unchecked: checked.unchecked };
}

export function recipeDefinitionText(recipe) {
  const errors = recipeProblems(recipe); if (errors.length) throw Error(errors.join('\n'));
  return JSON.stringify(recipe, null, 2);
}
