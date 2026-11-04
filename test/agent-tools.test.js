import test from 'node:test';
import assert from 'node:assert/strict';

import { PROVIDERS, DIALECTS, getProvider, endpointWarnings, configProblems }
  from '../src/core/agent/providers.js';
import { aliasTools, isAcceptableName } from '../src/core/agent/names.js';
import { selectTools, declareTools, EXCLUDED } from '../src/core/agent/tools.js';

const tool = (over = {}) => ({
  name: 'search_products',
  description: 'Search the catalogue',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  schemaError: null,
  annotations: {},
  origin: 'http://localhost:8777',
  frameId: 0,
  notInjected: false,
  logicalId: 'id-1',
  ...over,
});

test('every provider the product promises is in the catalogue', () => {
  const ids = PROVIDERS.map((p) => p.id);
  for (const expected of ['openai', 'anthropic', 'gemini', 'openrouter', 'ollama',
    'lmstudio', 'openai-compatible', 'manual']) {
    assert.ok(ids.includes(expected), `missing provider ${expected}`);
  }
});

test('every provider names a dialect the translator implements', () => {
  const known = new Set(Object.values(DIALECTS));
  for (const provider of PROVIDERS) {
    assert.ok(known.has(provider.dialect), `${provider.id} has dialect ${provider.dialect}`);
  }
});

test('local providers need no key, hosted ones do', () => {
  assert.equal(getProvider('ollama').keyRequired, false);
  assert.equal(getProvider('lmstudio').keyRequired, false);
  assert.equal(getProvider('openai').keyRequired, true);
  assert.equal(getProvider('anthropic').keyRequired, true);
});

test('manual mode needs nothing at all', () => {
  assert.deepEqual(configProblems({ providerId: 'manual' }), []);
});

test('missing key and missing model are separate problems', () => {
  assert.deepEqual(
    configProblems({ providerId: 'openai', model: '', hasKey: false }),
    ['missing-model', 'missing-key']);
  assert.deepEqual(
    configProblems({ providerId: 'openai', model: 'gpt-5.1', hasKey: true }), []);
});

test('an OpenAI-compatible endpoint with no URL is reported, not assumed', () => {
  assert.deepEqual(
    configProblems({ providerId: 'openai-compatible', baseUrl: '', model: 'm', hasKey: true }),
    ['missing-endpoint']);
});

test('plain http is fine on loopback and flagged anywhere else', () => {
  assert.deepEqual(
    endpointWarnings({ providerId: 'ollama', baseUrl: 'http://localhost:11434/v1' }), []);
  assert.deepEqual(
    endpointWarnings({ providerId: 'ollama', baseUrl: 'http://127.0.0.1:8080/v1' }), []);
  assert.deepEqual(
    endpointWarnings({ providerId: 'openai-compatible', baseUrl: 'http://gpu.lan:8000/v1' }),
    ['insecure-remote-endpoint']);
});

test('a malformed endpoint is named rather than thrown', () => {
  assert.deepEqual(
    endpointWarnings({ providerId: 'openai-compatible', baseUrl: 'not a url' }),
    ['invalid-endpoint']);
});

test('manual mode has no endpoint to warn about', () => {
  assert.deepEqual(endpointWarnings({ providerId: 'manual', baseUrl: '' }), []);
});

test('a legal tool name is passed through untouched', () => {
  const { aliases, renamed } = aliasTools([tool()]);
  assert.equal(aliases.get('id-1'), 'search_products');
  assert.deepEqual(renamed, []);
});

test('a name the API would reject is rewritten and the change is reported', () => {
  const { aliases, renamed } = aliasTools([tool({ name: 'search products.v2', logicalId: 'x' })]);
  const alias = aliases.get('x');
  assert.ok(isAcceptableName(alias), `${alias} is not acceptable`);
  assert.equal(alias, 'search_products_v2');
  assert.deepEqual(renamed, [{
    name: 'search products.v2', alias: 'search_products_v2', reason: 'illegal-characters',
  }]);
});

test('two tools sharing a name get distinct aliases, both resolvable', () => {
  const { aliases, byAlias, renamed } = aliasTools([
    tool({ logicalId: 'a' }),
    tool({ logicalId: 'b' }),
  ]);
  assert.notEqual(aliases.get('a'), aliases.get('b'));
  assert.equal(byAlias.get(aliases.get('a')).logicalId, 'a');
  assert.equal(byAlias.get(aliases.get('b')).logicalId, 'b');
  assert.deepEqual(renamed.map((r) => r.reason), ['duplicate-name']);
});

test('aliases never exceed the length the APIs accept', () => {
  const long = 'x'.repeat(200);
  const { aliases } = aliasTools([
    tool({ name: long, logicalId: 'a' }),
    tool({ name: long, logicalId: 'b' }),
  ]);
  for (const alias of aliases.values()) {
    assert.ok(isAcceptableName(alias), `${alias.length} chars`);
  }
  assert.notEqual(aliases.get('a'), aliases.get('b'));
});

test('aliasing is deterministic for the same ordered list', () => {
  const tools = [tool({ logicalId: 'a' }), tool({ logicalId: 'b', name: 'add to cart' })];
  assert.deepEqual([...aliasTools(tools).aliases], [...aliasTools(tools).aliases]);
});

test('a tool with no schema is offered as taking no arguments', () => {
  const { usable, excluded } = selectTools([tool({ inputSchema: null })]);
  assert.equal(excluded.length, 0);
  assert.deepEqual(usable[0].schema, { type: 'object', properties: {} });
});

test('a tool whose schema failed to parse is excluded, never faked', () => {
  const { usable, excluded } = selectTools([
    tool({ inputSchema: null, schemaError: 'inputSchema is not valid JSON: bad' }),
  ]);
  assert.equal(usable.length, 0);
  assert.equal(excluded[0].reason, EXCLUDED.schemaUnparsed);
  assert.match(excluded[0].detail, /not valid JSON/);
});

test('a tool Explorer could not reach is excluded rather than offered to fail', () => {
  const { usable, excluded } = selectTools([tool({ notInjected: true, frameId: null })]);
  assert.equal(usable.length, 0);
  assert.equal(excluded[0].reason, EXCLUDED.notInjected);
});

test('a tool disabled by an override is withheld from the model', () => {
  const { usable, excluded } = selectTools([tool({ disabled: true })]);
  assert.equal(usable.length, 0);
  assert.equal(excluded[0].reason, EXCLUDED.disabled);
});

test('the OpenAI dialect nests the declaration under function', () => {
  const { declarations } = declareTools([tool()], DIALECTS.openaiChat);
  assert.equal(declarations[0].type, 'function');
  assert.equal(declarations[0].function.name, 'search_products');
  assert.deepEqual(declarations[0].function.parameters.required, ['q']);
});

test('the Anthropic dialect uses input_schema', () => {
  const { declarations } = declareTools([tool()], DIALECTS.anthropicMessages);
  assert.equal(declarations[0].name, 'search_products');
  assert.deepEqual(declarations[0].input_schema.required, ['q']);
  assert.equal(declarations[0].parameters, undefined);
});

// Gemini's Schema fields, as documented (ai.google.dev/api/generate-content, FunctionDeclaration/Schema, read
// 2026-10-20): pattern, minLength and maxLength are among them; additionalProperties and $schema are not.
test('the Gemini dialect drops keywords it would reject', () => {
  const rich = tool({
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      properties: {
        q: { type: 'string', pattern: '^a', description: 'query' },
        tags: { type: 'array', items: { type: 'string', maxLength: 8 } },
      },
      required: ['q'],
    },
  });
  const { declarations } = declareTools([rich], DIALECTS.geminiGenerate);
  const params = declarations[0].parameters;
  assert.equal(params.additionalProperties, undefined);
  assert.equal(params.$schema, undefined);
  assert.equal(params.properties.q.pattern, '^a');
  assert.equal(params.properties.q.description, 'query');
  assert.equal(params.properties.tags.items.maxLength, 8);
  assert.equal(params.properties.tags.items.type, 'string');
  assert.deepEqual(params.required, ['q']);
});

test('an overridden description is what the model is shown', () => {
  const overridden = tool({
    description: 'Search the product catalogue by keyword, category and maximum price.',
    originalDescription: 'Search the catalogue',
    overridden: true,
  });
  const { declarations } = declareTools([overridden], DIALECTS.openaiChat);
  assert.match(declarations[0].function.description, /maximum price/);
});

test('a tool with an empty description still gets one the model can read', () => {
  const { declarations } = declareTools([tool({ description: '' })], DIALECTS.openaiChat);
  assert.match(declarations[0].function.description, /search_products/);
  assert.match(declarations[0].function.description, /localhost:8777/);
});

test('a tool call comes back to the exact tool it named', () => {
  const { declarations, byAlias } = declareTools([
    tool({ logicalId: 'a', name: 'add to cart' }),
    tool({ logicalId: 'b', name: 'add to cart' }),
  ], DIALECTS.openaiChat);
  const [first, second] = declarations.map((d) => d.function.name);
  assert.equal(byAlias.get(first).logicalId, 'a');
  assert.equal(byAlias.get(second).logicalId, 'b');
});

test('excluded tools never reach the declarations', () => {
  const { declarations, excluded } = declareTools([
    tool({ logicalId: 'ok' }),
    tool({ logicalId: 'bad', name: 'broken', schemaError: 'boom' }),
  ], DIALECTS.openaiChat);
  assert.equal(declarations.length, 1);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].tool.logicalId, 'bad');
});

// --- an insecure endpoint stops the run rather than decorating it (D-051) ---

test('a remote http endpoint is a configuration problem, not a remark', () => {
  const problems = configProblems({
    providerId: 'openai-compatible', baseUrl: 'http://gpu.lan:8000/v1', model: 'm', hasKey: true,
  });
  assert.ok(problems.includes('insecure-remote-endpoint'), problems.join(','));
});

test('a local http endpoint is not a problem at all', () => {
  for (const baseUrl of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1']) {
    assert.deepEqual(
      configProblems({ providerId: 'openai-compatible', baseUrl, model: 'm', hasKey: false }), []);
  }
  assert.deepEqual(configProblems({ providerId: 'ollama', model: 'llama3', hasKey: false }), []);
});

test('an https endpoint is not a problem', () => {
  assert.deepEqual(
    configProblems({ providerId: 'openai-compatible', baseUrl: 'https://gpu.lan:8000/v1',
      model: 'm', hasKey: false }), []);
});

test('endpoint warnings and configuration problems agree on what is blocked', () => {
  const remote = { providerId: 'openai-compatible', baseUrl: 'http://gpu.lan:8000/v1' };
  assert.deepEqual(endpointWarnings(remote), ['insecure-remote-endpoint']);
  assert.ok(configProblems({ ...remote, model: 'm', hasKey: true })
    .includes('insecure-remote-endpoint'));
});
