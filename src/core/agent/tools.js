// Turns the discovered WebMCP tools into the tool declarations a model API expects, and
// says out loud which tools could not be offered and why.
//
// Explorer's honesty rule applies here more than anywhere else. A tool whose schema failed
// to parse (D-025) cannot be described to a model: handing over an empty object schema would
// tell it "this tool takes no arguments", which is a fabrication. Such a tool is excluded and
// named, so the developer sees that their page — not Explorer — is the reason the model never
// called it.

import { DIALECTS } from './providers.js';
import { aliasTools, aliasKey } from './names.js';
import { adaptRoot } from './schema-adapt.js';

// Exclusion reasons, stable so the UI can phrase them and tests can assert on them.
export const EXCLUDED = {
  schemaUnparsed: 'schema-unparsed',
  schemaNotObject: 'schema-not-object',
  disabled: 'disabled-by-override',
  notInjected: 'not-injected',
  inventoryOnly: 'inventory-only',
};

function schemaFor(tool) {
  // A tool with no schema at all genuinely takes no arguments; that is a fact, not a guess.
  if (tool.inputSchema === null || tool.inputSchema === undefined) {
    return { schema: { type: 'object', properties: {} }, reason: null };
  }
  if (typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema)) {
    return { schema: null, reason: EXCLUDED.schemaNotObject };
  }
  return { schema: tool.inputSchema, reason: null };
}

// Splits the registry into what can be offered to a model and what cannot.
export function selectTools(tools = []) {
  const usable = [];
  const excluded = [];

  for (const tool of tools) {
    if (tool.inventoryOnly) { excluded.push({ tool, reason: EXCLUDED.inventoryOnly, detail: null }); continue; }
    if (tool.schemaError) {
      excluded.push({ tool, reason: EXCLUDED.schemaUnparsed, detail: tool.schemaError });
      continue;
    }
    if (tool.disabled) {
      excluded.push({ tool, reason: EXCLUDED.disabled, detail: null });
      continue;
    }
    // Explorer never entered that frame, so it could not run the tool even if the model
    // asked for it (D-023). Offering it would produce a guaranteed failure mid-conversation.
    if (tool.notInjected) {
      excluded.push({ tool, reason: EXCLUDED.notInjected, detail: tool.origin ?? null });
      continue;
    }
    const { schema, reason } = schemaFor(tool);
    if (reason) {
      excluded.push({ tool, reason, detail: typeof tool.inputSchema });
      continue;
    }
    usable.push({ tool, schema });
  }

  return { usable, excluded };
}

// Builds the provider-shaped declarations plus the lookup a tool call needs to come back to
// a real WebMCP tool.
export function declareTools(tools, dialect) {
  const { usable, excluded } = selectTools(tools);
  const { aliases, byAlias, renamed } = aliasTools(usable.map((entry) => entry.tool));

  const adapted = [];
  const declarations = usable.map(({ tool, schema: pageSchema }) => {
    const alias = aliases.get(aliasKey(tool));
    // A root oneOf/anyOf/allOf is refused by Anthropic and inexpressible for OpenAI strict mode and Gemini: the
    // root becomes a plain object and the rule travels in words (schema-adapt.js). Same rule for every dialect.
    const { schema, adapted: changed, rule } = adaptRoot(pageSchema);
    if (changed) adapted.push({ name: tool.name, rule });
    // The description is what a model selects on, so it must be the description the tool
    // actually carries — including an override, since testing exactly that is the point of
    // the Mock Lab (D-030).
    const base = tool.description || `Tool ${tool.name} exposed by ${tool.origin}.`;
    const description = rule ? `${base}\n\nArgument rule: ${rule}` : base;

    if (dialect === DIALECTS.anthropicMessages) {
      return { name: alias, description, input_schema: schema };
    }
    if (dialect === DIALECTS.geminiGenerate) {
      return { name: alias, description, parameters: geminiSchema(schema) };
    }
    return { type: 'function', function: { name: alias, description, parameters: schema } };
  });

  return { declarations, byAlias, aliases, renamed, excluded, adapted };
}

// Gemini's function declarations take an OpenAPI 3.0 Schema subset and reject unknown keywords outright, so
// anything outside the documented fields is dropped rather than sent and refused (FunctionDeclaration / Schema,
// ai.google.dev/api/generate-content, read 2026-10-20). `anyOf` is its combinator: a nested `oneOf` becomes one
// (closest documented meaning), and a JSON Schema type list with "null" becomes `nullable`.
const GEMINI_KEYS = new Set([
  'type', 'format', 'title', 'description', 'nullable', 'enum', 'maxItems', 'minItems',
  'properties', 'required', 'minProperties', 'maxProperties', 'minLength', 'maxLength',
  'pattern', 'example', 'anyOf', 'propertyOrdering', 'default', 'items', 'minimum', 'maximum',
]);

function geminiSchema(schema) {
  if (schema === null || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(geminiSchema);

  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'oneOf' && Array.isArray(value) && !('anyOf' in schema)) {
      out.anyOf = value.map(geminiSchema);
      continue;
    }
    if (!GEMINI_KEYS.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, geminiSchema(v)]));
    } else if (key === 'items' || key === 'anyOf') {
      out[key] = geminiSchema(value);
    } else if (key === 'type' && Array.isArray(value)) {
      const types = value.filter((t) => t !== 'null');
      if (types.length === 1) out.type = types[0];
      if (types.length !== value.length) out.nullable = true;
    } else {
      out[key] = value;
    }
  }
  return out;
}
