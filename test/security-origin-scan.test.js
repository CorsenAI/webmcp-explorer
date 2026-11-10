import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDiscovery } from '../src/background/security-discovery.js';
import { reviewSecurity } from '../src/core/security/review.js';

test('006 sends only four credential-free requests, never follows redirects and reports CORS/CSP evidence', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/.well-known/webmcp')) return new Response(null, { status: 302, headers: { location: 'https://third.test/secret' } });
    if (url.endsWith('.json')) return new Response('{broken', { headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/llms.txt')) return new Response('Documentation');
    return new Response('', { headers: { 'content-security-policy': "default-src 'self'", 'permissions-policy': 'tools=(self)', 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' } });
  });
  globalThis.chrome = { permissions: { contains: async () => true } };
  const scan = await fetchDiscovery({ pageUrl: 'https://shop.test/page#fragment' });
  assert.equal(calls.length, 4);
  assert.ok(calls.every(c => c.options.credentials === 'omit' && c.options.redirect === 'manual'));
  assert.ok(!calls.some(c => c.url.includes('third.test') || c.url.includes('#')));
  assert.equal(scan.files[0].error, 'redirect-not-followed');
  assert.ok(scan.findings.some(f => f.code === 'convention-manifest-invalid'));
  assert.ok(scan.findings.some(f => f.code === 'convention-cors' && f.detail.invalidCredentialsWildcard));
  const r = reviewSecurity({ discovery: { tools: [] }, originScan: scan });
  assert.ok(r.findings.some(f => f.ruleId === 'WMCP-SEC-006' && f.severity === 'medium'));
  assert.ok(r.coverage.notObservable.some(f => f.code === 'origin-scan-incomplete'));
});

test('006 hard-caps bytes, does not mislabel truncated JSON invalid and fetches each URL once', async t => {
  const calls = [];
  globalThis.chrome = { permissions: { contains: async () => true } };
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url); return new Response('x'.repeat(100000), { headers: { 'content-type': 'application/json' } });
  });
  const out = await fetchDiscovery({ pageUrl: 'https://shop.test/.well-known/webmcp.json' });
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls).size, 3);
  assert.ok(out.files.every(f => f.size === 65536 && f.truncated));
  assert.ok(!out.findings.some(f => f.code === 'convention-manifest-invalid'));
  assert.ok(!JSON.stringify(out).includes('x'.repeat(100)));
});

test('006 rejects userinfo, non-HTTP origins and ungranted origins before network', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw Error('unexpected'); });
  globalThis.chrome = { permissions: { contains: async () => false } };
  for (const pageUrl of ['https://user:pass@shop.test/', 'file:///tmp/test', 'https://ungranted.test/']) {
    assert.ok((await fetchDiscovery({ pageUrl })).error);
  }
  assert.equal(calls, 0);
});

test('006 permission revocation and a lost response stay unknown, without a retry or missing-header claim', async t => {
  let calls = 0, allowed = true;
  globalThis.chrome = { permissions: { contains: async () => allowed } };
  t.mock.method(globalThis, 'fetch', async () => { calls++; allowed = false; throw new TypeError('lost response'); });
  const r = await fetchDiscovery({ pageUrl: 'https://shop.test/page' });
  assert.ok(calls >= 1 && calls <= 3);
  assert.ok(r.page.error);
  assert.ok(!r.findings.some(f => f.code === 'convention-permissions-policy-absent'));
});

test('the Origin-Trial header of the page response is decoded into records; its text goes no further', async t => {
  const { webcrypto } = await import('node:crypto');
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const sign = async (payload) => {
    const body = Buffer.from(JSON.stringify(payload));
    const length = Buffer.alloc(4); length.writeUInt32BE(body.length);
    const signature = Buffer.from(await webcrypto.subtle.sign('Ed25519', pair.privateKey, Buffer.concat([Buffer.from([3]), length, body])));
    return Buffer.concat([Buffer.from([3]), signature, length, body]).toString('base64');
  };
  const far = Math.floor(Date.now() / 1000) + 90 * 86400;
  const own = await sign({ origin: 'https://shop.test:443', feature: 'WebMCP', expiry: far });
  const other = await sign({ origin: 'https://shop.test:443', feature: 'SomeOtherTrial', expiry: far });
  t.mock.method(globalThis, 'fetch', async (url) => (new URL(url).pathname === '/page'
    ? new Response('', { headers: { 'origin-trial': `${own}, "${other}"`, 'permissions-policy': 'tools=(self)' } })
    : new Response('nf', { status: 404 })));
  globalThis.chrome = { permissions: { contains: async () => true } };
  const scan = await fetchDiscovery({ pageUrl: 'https://shop.test/page' });
  // Header tokens are reported like the page's meta tokens; this key is not Chrome's.
  assert.deepEqual(scan.page.originTrials.map((x) => [x.source, x.feature, x.status, x.signature]),
    [['header', 'WebMCP', 'valid', 'invalid'], ['header', 'SomeOtherTrial', 'valid', 'invalid']]);
  const text = JSON.stringify(scan);
  assert.ok(!text.includes(own.slice(8, 60)) && !text.includes(other.slice(8, 60)), 'no token text in the scan result');
  assert.equal(scan.page.headers['origin-trial'], undefined);
  // No header: an empty list, not an unknown. A failed page request: unknown.
  t.mock.method(globalThis, 'fetch', async (url) => (new URL(url).pathname === '/page' ? new Response('') : new Response('nf', { status: 404 })));
  assert.deepEqual((await fetchDiscovery({ pageUrl: 'https://shop.test/page' })).page.originTrials, []);
  t.mock.method(globalThis, 'fetch', async () => new Response('nf', { status: 503 }));
  assert.equal((await fetchDiscovery({ pageUrl: 'https://shop.test/page' })).page.originTrials, null);
});
