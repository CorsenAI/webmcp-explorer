// Contract checks: facts about a tool's declared contract that commonly trip agents up. Pure
// JavaScript: no chrome.* API.
//
// A model chooses a tool by its description and fills its arguments from its schema. A tool
// with no description, two tools that share one, a required argument nobody declared — these
// are things a developer wants told before a model tells them by picking the wrong tool. Each
// check is a fact with a stable code and the names involved; the wording lives in the locale.
//
// What this is not (D-004 rule 10, D-008): a score, a risk rating, or a judgement of what the
// tool does. It reads the contract the page declares and reports gaps in it, nothing more.

import { toSchemaObject } from './schema/parse.js';
import { isAcceptableName } from './agent/names.js';

export const CHECK = {
  noDescription: 'no-description',
  shortDescription: 'short-description',
  duplicateDescription: 'duplicate-description',
  noSchema: 'no-schema',
  schemaError: 'schema-error',
  schemaNotObject: 'schema-not-object',
  propertyWithoutDescription: 'property-without-description',
  requiredNotDeclared: 'required-not-declared',
  nameNeedsAlias: 'name-needs-alias',
  duplicateName: 'duplicate-name',
  noAnnotations: 'no-annotations',
};

export const LEVEL = { warn: 'warn', note: 'note' };

// Below this a description is a label, not an explanation.
export const SHORT_DESCRIPTION = 25;

const normalise = (text) => String(text ?? '').trim().toLowerCase();

export function checkTool(tool, allTools = [], index = null) {
  const items = [];
  const add = (code, level, detail = null) => items.push({ code, level, detail });

  // Description: the thing the model chooses by.
  const description = String(tool.description ?? '').trim();
  if (!description) {
    add(CHECK.noDescription, LEVEL.warn);
  } else if (description.length < SHORT_DESCRIPTION) {
    add(CHECK.shortDescription, LEVEL.note, String(description.length));
  }
  // Two tools a model could confuse: a different name, the same words. Two instances of one
  // tool in two frames share a description by construction and are not each other's twins.
  const twins = (index?.descriptions.get(normalise(description)) ?? allTools).filter((other) => other !== tool
    && other.name !== tool.name
    && description && normalise(other.description) === normalise(description));
  if (twins.length) {
    add(CHECK.duplicateDescription, LEVEL.warn, [...new Set(twins.map((other) => other.name))].join(', '));
  }

  // Schema: the thing the model fills in.
  if (tool.schemaError) {
    add(CHECK.schemaError, LEVEL.warn, tool.schemaError);
  } else {
    const { schema, error } = toSchemaObject(tool.inputSchema);
    if (error) {
      add(CHECK.schemaError, LEVEL.warn, error);
    } else if (!schema) {
      add(CHECK.noSchema, LEVEL.note);
    } else {
      if (schema.type !== undefined && schema.type !== 'object') {
        add(CHECK.schemaNotObject, LEVEL.warn, Array.isArray(schema.type) ? schema.type.join(' | ') : String(schema.type));
      }
      const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
      const undescribed = Object.entries(properties)
        .filter(([, prop]) => !(prop && typeof prop === 'object' && String(prop.description ?? '').trim()))
        .map(([name]) => name);
      if (undescribed.length) add(CHECK.propertyWithoutDescription, LEVEL.note, undescribed.join(', '));
      const undeclared = (Array.isArray(schema.required) ? schema.required : [])
        .filter((name) => !(name in properties));
      if (undeclared.length) add(CHECK.requiredNotDeclared, LEVEL.warn, undeclared.join(', '));
    }
  }

  // Name: what a model API will accept.
  if (!isAcceptableName(tool.name)) add(CHECK.nameNeedsAlias, LEVEL.note);
  const sameName = (index?.names.get(tool.name) ?? allTools).filter((other) => other !== tool
    && (other.instanceId ?? other.logicalId) !== (tool.instanceId ?? tool.logicalId)
    && other.name === tool.name);
  if (sameName.length) add(CHECK.duplicateName, LEVEL.note, String(sameName.length));

  // Annotations: what the agent is told about side effects. Only the ones the browser returns
  // count (WMP-0004); an absent set is a fact about the page, a normalised set is not.
  const annotations = tool.annotations && typeof tool.annotations === 'object' ? tool.annotations : {};
  if (!Object.values(annotations).some((value) => value === true)) {
    add(CHECK.noAnnotations, LEVEL.note);
  }

  return {
    items,
    warnings: items.filter((item) => item.level === LEVEL.warn).length,
    notes: items.filter((item) => item.level === LEVEL.note).length,
  };
}

// Every tool of a page at once, keyed by instance, with the page-wide counts.
export function checkTools(tools = []) {
  // Index each discovery snapshot once. Rechecking every peer for every card was
  // quadratic, and repeated again on every filter keystroke. No cache outlives this call.
  const index = { descriptions: new Map(), names: new Map() };
  for (const tool of tools) {
    for (const [map, key] of [[index.descriptions, normalise(tool.description)], [index.names, tool.name]]) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(tool);
    }
  }
  const byTool = new Map();
  let warnings = 0;
  let notes = 0;
  for (const tool of tools) {
    const result = checkTool(tool, tools, index);
    byTool.set(tool.instanceId ?? tool.logicalId ?? tool.name, result);
    warnings += result.warnings;
    notes += result.notes;
  }
  return { byTool, warnings, notes };
}
