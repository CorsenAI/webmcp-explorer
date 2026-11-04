import test from 'node:test';
import assert from 'node:assert/strict';

import { DIALECTS } from '../src/core/agent/providers.js';
import { buildRequest, parseResponse, readError, DEFAULT_SYSTEM }
  from '../src/core/agent/messages.js';

const TRANSCRIPT = [
  { role: 'user', text: 'find a laptop' },
  {
    role: 'assistant',
    text: 'Looking it up.',
    calls: [{ id: 'c1', alias: 'search_products', args: { q: 'laptop' } }],
  },
  { role: 'tool', id: 'c1', alias: 'search_products', ok: true, text: '{"products":[]}' },
];

const DECLS = [{ type: 'function', function: { name: 'search_products', parameters: {} } }];

test('the OpenAI request carries the system turn first', () => {
  const { path, body } = buildRequest({
    dialect: DIALECTS.openaiChat, model: 'gpt-5.1', transcript: TRANSCRIPT,
  });
  assert.equal(path, '/chat/completions');
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[0].content, DEFAULT_SYSTEM);
  assert.equal(body.model, 'gpt-5.1');
});

test('OpenAI tool calls are stringified and results keyed by call id', () => {
  const { body } = buildRequest({
    dialect: DIALECTS.openaiChat, model: 'm', transcript: TRANSCRIPT,
  });
  const assistant = body.messages.find((m) => m.role === 'assistant');
  assert.equal(assistant.tool_calls[0].function.arguments, '{"q":"laptop"}');
  const result = body.messages.find((m) => m.role === 'tool');
  assert.equal(result.tool_call_id, 'c1');
  assert.equal(result.content, '{"products":[]}');
});

test('tools are omitted entirely when there are none to offer', () => {
  const { body } = buildRequest({ dialect: DIALECTS.openaiChat, model: 'm', transcript: [] });
  assert.equal('tools' in body, false);
  assert.equal('tool_choice' in body, false);
});

test('tools are attached when there are some', () => {
  const { body } = buildRequest({
    dialect: DIALECTS.openaiChat, model: 'm', transcript: [], declarations: DECLS,
  });
  assert.equal(body.tools.length, 1);
  assert.equal(body.tool_choice, 'auto');
});

test('Anthropic keeps the system prompt out of the message list', () => {
  const { path, body } = buildRequest({
    dialect: DIALECTS.anthropicMessages, model: 'claude-sonnet-5', transcript: TRANSCRIPT,
  });
  assert.equal(path, '/messages');
  assert.equal(body.system, DEFAULT_SYSTEM);
  assert.ok(body.messages.every((m) => m.role !== 'system'));
  assert.equal(typeof body.max_tokens, 'number');
});

test('Anthropic tool results ride on a user turn', () => {
  const { body } = buildRequest({
    dialect: DIALECTS.anthropicMessages, model: 'm', transcript: TRANSCRIPT,
  });
  const last = body.messages[body.messages.length - 1];
  assert.equal(last.role, 'user');
  assert.equal(last.content[0].type, 'tool_result');
  assert.equal(last.content[0].tool_use_id, 'c1');
});

test('consecutive Anthropic tool results merge into one user turn', () => {
  const { body } = buildRequest({
    dialect: DIALECTS.anthropicMessages,
    model: 'm',
    transcript: [
      { role: 'user', text: 'go' },
      {
        role: 'assistant',
        text: '',
        calls: [{ id: 'a', alias: 't', args: {} }, { id: 'b', alias: 't', args: {} }],
      },
      { role: 'tool', id: 'a', alias: 't', ok: true, text: 'one' },
      { role: 'tool', id: 'b', alias: 't', ok: true, text: 'two' },
    ],
  });
  const last = body.messages[body.messages.length - 1];
  assert.equal(last.content.length, 2);
  assert.equal(body.messages.filter((m) => m.role === 'user').length, 2);
});

test('a failed tool result is marked as an error for Anthropic', () => {
  const { body } = buildRequest({
    dialect: DIALECTS.anthropicMessages,
    model: 'm',
    transcript: [
      { role: 'user', text: 'go' },
      { role: 'assistant', text: '', calls: [{ id: 'a', alias: 't', args: {} }] },
      { role: 'tool', id: 'a', alias: 't', ok: false, text: 'boom' },
    ],
  });
  const last = body.messages[body.messages.length - 1];
  assert.equal(last.content[0].is_error, true);
});

test('Gemini 3 keeps unsigned historical tool calls as context, without invalid function replay', () => {
  const { path, body } = buildRequest({
    dialect: DIALECTS.geminiGenerate, model: 'gemini-3-flash', transcript: TRANSCRIPT,
  });
  assert.equal(path, '/models/gemini-3-flash:generateContent');
  assert.equal(body.systemInstruction.parts[0].text, DEFAULT_SYSTEM);
  assert.equal(body.contents[1].role, 'model');
  assert.match(body.contents[1].parts[0].text, /Earlier tool call search_products/);
  assert.match(body.contents[2].parts[0].text, /Earlier tool result search_products/);
});

test('Gemini wraps declarations the way it expects', () => {
  const { body } = buildRequest({
    dialect: DIALECTS.geminiGenerate,
    model: 'm',
    transcript: [],
    declarations: [{ name: 't', description: 'd', parameters: {} }],
  });
  assert.equal(body.tools[0].functionDeclarations.length, 1);
});

test('an OpenAI response yields text, calls and usage', () => {
  const out = parseResponse(DIALECTS.openaiChat, {
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        content: 'ok',
        tool_calls: [{
          id: 'call_1',
          function: { name: 'search_products', arguments: '{"q":"mac"}' },
        }],
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 4 },
  });
  assert.equal(out.text, 'ok');
  assert.equal(out.stop, 'tool_calls');
  assert.deepEqual(out.calls[0].args, { q: 'mac' });
  assert.equal(out.calls[0].argsError, null);
  assert.deepEqual(out.usage, { input: 10, output: 4 });
});

test('arguments that are not valid JSON are reported, not replaced', () => {
  const out = parseResponse(DIALECTS.openaiChat, {
    choices: [{
      message: { tool_calls: [{ id: 'c', function: { name: 't', arguments: '{"q":' } }] },
    }],
  });
  assert.match(out.calls[0].argsError, /not valid JSON/);
  assert.equal(out.calls[0].argsRaw, '{"q":');
  assert.deepEqual(out.calls[0].args, {});
});

test('arguments that parse to a non-object are reported too', () => {
  const out = parseResponse(DIALECTS.openaiChat, {
    choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 't', arguments: '"x"' } }] } }],
  });
  assert.match(out.calls[0].argsError, /did not parse to an object/);
});

test('empty arguments mean an empty object, not an error', () => {
  const out = parseResponse(DIALECTS.openaiChat, {
    choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 't', arguments: '' } }] } }],
  });
  assert.deepEqual(out.calls[0].args, {});
  assert.equal(out.calls[0].argsError, null);
});

test('an Anthropic response splits text blocks from tool_use blocks', () => {
  const out = parseResponse(DIALECTS.anthropicMessages, {
    content: [
      { type: 'text', text: 'Let me look. ' },
      { type: 'tool_use', id: 'tu_1', name: 'search_products', input: { q: 'mac' } },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 7, output_tokens: 3 },
  });
  assert.equal(out.text, 'Let me look. ');
  assert.equal(out.calls[0].id, 'tu_1');
  assert.deepEqual(out.calls[0].args, { q: 'mac' });
  assert.deepEqual(out.usage, { input: 7, output: 3 });
});

test('a Gemini response gets a synthetic but unique call id', () => {
  const out = parseResponse(DIALECTS.geminiGenerate, {
    candidates: [{
      finishReason: 'STOP',
      content: {
        parts: [
          { text: 'sure' },
          { functionCall: { name: 'a', args: { x: 1 } } },
          { functionCall: { name: 'b', args: { x: 2 } } },
        ],
      },
    }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
  });
  assert.equal(out.text, 'sure');
  assert.equal(out.calls.length, 2);
  assert.notEqual(out.calls[0].id, out.calls[1].id);
  assert.deepEqual(out.usage, { input: 5, output: 2 });
});

test('a response with no tool calls parses to plain text', () => {
  const out = parseResponse(DIALECTS.openaiChat, {
    choices: [{ finish_reason: 'stop', message: { content: 'done' } }],
  });
  assert.deepEqual(out.calls, []);
  assert.equal(out.text, 'done');
});

test('an empty or malformed payload does not throw', () => {
  for (const dialect of [DIALECTS.openaiChat, DIALECTS.anthropicMessages,
    DIALECTS.geminiGenerate]) {
    const out = parseResponse(dialect, {});
    assert.equal(out.text, '');
    assert.deepEqual(out.calls, []);
  }
});

test('provider error bodies are reduced to their message', () => {
  assert.equal(readError({ error: { message: 'Invalid API key' } }, 401), 'Invalid API key');
  assert.equal(readError({ message: 'model not found' }, 404), 'model not found');
  assert.match(readError({}, 500), /500/);
});

test('a gateway string error preserves the upstream explanation', () => {
  // Actual Verboo response, 2026-09-12: the previous parser incorrectly said no message.
  assert.equal(readError({ error: 'upstream temporarily unavailable' }, 503),
    'upstream temporarily unavailable');
});
