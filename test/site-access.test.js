import test from 'node:test';
import assert from 'node:assert/strict';
import { describeGrants, ALL_SITES_PATTERNS } from '../src/core/site-access.js';

const providers = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { id: 'manual', label: 'Manual', baseUrl: '' },
];

test('sites, model endpoints and broad grants are told apart and labelled', () => {
  const out = describeGrants([
    'https://shop.example.com/*', 'http://localhost:8777/*',
    'https://api.openai.com/*', 'http://localhost:11434/*',
  ], providers);
  assert.deepEqual(out.all, { https: false, http: false });
  assert.equal(out.allSites, false);
  assert.deepEqual(out.sites.map((s) => s.label), ['http://localhost:8777', 'shop.example.com']);
  assert.deepEqual(out.endpoints.map((e) => e.label), ['api.openai.com — OpenAI', 'localhost:11434 — Ollama']);
  assert.equal(out.total, 4);
});

test('the two broad patterns are reported as "all sites" only when both are present', () => {
  assert.equal(describeGrants(['https://*/*']).allSites, false);
  assert.equal(describeGrants(['https://*/*']).all.https, true);
  assert.equal(describeGrants(ALL_SITES_PATTERNS).allSites, true);
  assert.equal(describeGrants(ALL_SITES_PATTERNS).sites.length, 0);
});

test('a pattern this module does not recognise is still listed, never dropped', () => {
  const out = describeGrants(['file:///*', 'https://a.test/*'], providers);
  assert.deepEqual(out.other.map((o) => o.pattern), ['file:///*']);
  assert.equal(out.sites.length, 1);
});

test('duplicates count once and nothing is granted when the list is empty', () => {
  assert.equal(describeGrants(['https://a.test/*', 'https://a.test/*']).total, 1);
  assert.deepEqual(describeGrants([]), {
    all: { https: false, http: false }, allSites: false, sites: [], endpoints: [], other: [], total: 0,
  });
});
