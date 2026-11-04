import test from 'node:test';
import assert from 'node:assert/strict';

import { joinEndpoint } from '../src/core/agent/endpoint.js';

test('the dialect path is appended to the base path', () => {
  assert.equal(
    joinEndpoint('https://api.openai.com/v1', '/chat/completions').url,
    'https://api.openai.com/v1/chat/completions');
});

test('a trailing slash on the base does not double up', () => {
  assert.equal(
    joinEndpoint('http://localhost:11434/v1/', '/chat/completions').url,
    'http://localhost:11434/v1/chat/completions');
});

test('a query on the base survives, and the path lands before it', () => {
  // Azure OpenAI requires ?api-version=. Appending to the string would have produced
  // .../deployments/x?api-version=2024-02-01/chat/completions, which 404s.
  const out = joinEndpoint(
    'https://x.openai.azure.com/openai/deployments/gpt?api-version=2024-02-01',
    '/chat/completions');
  assert.equal(out.url,
    'https://x.openai.azure.com/openai/deployments/gpt/chat/completions?api-version=2024-02-01');
});

test('a base with no path still works', () => {
  assert.equal(joinEndpoint('https://host', '/messages').url, 'https://host/messages');
});

test('a port is preserved', () => {
  assert.equal(joinEndpoint('http://127.0.0.1:8080/v1', '/models').url,
    'http://127.0.0.1:8080/v1/models');
});

test('a model name in the path is not mangled', () => {
  assert.equal(
    joinEndpoint('https://generativelanguage.googleapis.com/v1beta',
      '/models/gemini-3-flash:generateContent').url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent');
});

test('a bad address is reported, not thrown', () => {
  const out = joinEndpoint('not a url', '/chat/completions');
  assert.equal(out.ok, false);
  assert.match(out.error, /not a valid URL/);
});

test('an empty address is reported', () => {
  assert.equal(joinEndpoint('', '/x').ok, false);
});

test('a scheme that cannot carry a request is refused', () => {
  const out = joinEndpoint('file:///etc/passwd', '/chat/completions');
  assert.equal(out.ok, false);
  assert.match(out.error, /http or https/);
});

// --- plain http is a blocker anywhere but the user's own machine (D-051) ---

import { endpointBlocker, isLoopbackHost } from '../src/core/agent/endpoint.js';

test('loopback hosts are recognised in every spelling', () => {
  for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '[::1]', '::1', 'ollama.localhost']) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ['gpu.lan', 'example.com', '10.0.0.5', 'localhost.example.com']) {
    assert.equal(isLoopbackHost(host), false, host);
  }
});

test('https is always acceptable', () => {
  assert.equal(endpointBlocker('https://api.openai.com/v1'), null);
  assert.equal(endpointBlocker('https://gpu.lan:8000/v1'), null);
});

test('plain http is acceptable on the machine itself — Ollama and LM Studio live there', () => {
  assert.equal(endpointBlocker('http://localhost:11434/v1'), null);
  assert.equal(endpointBlocker('http://127.0.0.1:1234/v1'), null);
  assert.equal(endpointBlocker('http://[::1]:8080/v1'), null);
});

test('plain http to any other host is refused, with a stable code', () => {
  assert.equal(endpointBlocker('http://gpu.lan:8000/v1'), 'insecure-remote-endpoint');
  assert.equal(endpointBlocker('http://10.0.0.5:8000/v1'), 'insecure-remote-endpoint');
  assert.equal(endpointBlocker('http://api.example.com/v1'), 'insecure-remote-endpoint');
});

test('the refusal happens where every request URL is built, so no path can bypass it', () => {
  const out = joinEndpoint('http://gpu.lan:8000/v1', '/chat/completions');
  assert.equal(out.ok, false);
  assert.match(out.error, /unencrypted/);
  assert.match(out.error, /https/);
});

test('a local endpoint still joins normally', () => {
  assert.equal(joinEndpoint('http://localhost:11434/v1', '/chat/completions').url,
    'http://localhost:11434/v1/chat/completions');
});
