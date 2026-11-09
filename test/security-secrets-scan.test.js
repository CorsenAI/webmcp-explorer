// WMCP-SEC-013 on request: refused without the control declaration, limited to the top document's
// inline scripts and same-origin files, credential-free, and no key value in what comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSecrets } from '../src/background/security-secrets.js';
import { FIXTURE_KEYS } from '../fixtures/secret-keys.mjs';

const ORIGIN = 'https://shop.test';
function stubChrome({ controlled = [ORIGIN], page = null, granted = true } = {}) {
  const calls = { executeScript: 0 };
  globalThis.chrome = {
    storage: { local: { get: async () => ({ securityControlledOrigins: controlled }) } },
    permissions: { contains: async () => granted },
    scripting: { executeScript: async (options) => { calls.executeScript += 1; calls.options = options; return [{ result: page }]; } },
  };
  return calls;
}
const PAGE = { url: `${ORIGIN}/checkout?step=2`, inline: [{ index: 0, text: `const pay = "${FIXTURE_KEYS.stripeLive}"; const pub = "${FIXTURE_KEYS.stripePublishable}";` }],
  files: [`${ORIGIN}/assets/app.js?v=3`], otherOrigins: 1 };

test('013 is refused without the control declaration and reads nothing', async (t) => {
  const calls = stubChrome({ controlled: [] });
  t.mock.method(globalThis, 'fetch', async () => { throw Error('unexpected'); });
  assert.deepEqual(await scanSecrets({ tabId: 7, topOrigin: ORIGIN }), { error: 'consent-required', code: 'consent-required' });
  assert.equal(calls.executeScript, 0);
  stubChrome({ granted: false });
  assert.equal((await scanSecrets({ tabId: 7, topOrigin: ORIGIN })).code, 'origin-not-granted');
  assert.equal((await scanSecrets({ tabId: 'x', topOrigin: ORIGIN })).error, 'A tab and its origin are required.');
});

test('013 reads the top document and same-origin files without cookies; only type, provider and length come back', async (t) => {
  const calls = stubChrome({ page: PAGE });
  const fetched = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { fetched.push({ url, options }); return new Response(`window.repo = "${FIXTURE_KEYS.github}";`); });
  const out = await scanSecrets({ tabId: 7, topOrigin: ORIGIN });
  assert.deepEqual(calls.options.target, { tabId: 7, frameIds: [0] });
  assert.deepEqual(fetched.map((f) => [f.url, f.options.credentials, f.options.redirect]), [[`${ORIGIN}/assets/app.js?v=3`, 'omit', 'manual']]);
  assert.deepEqual(out.scanned, { inline: 1, files: 1, skipped: 0, otherOrigins: 1 });
  assert.deepEqual(out.findings.map((f) => [f.code, f.severity, f.ruleId, f.evidence.path]).sort(),
    [['client-secret-exposed', 'critical', 'WMCP-SEC-013', '/assets/app.js'], ['client-secret-exposed', 'critical', 'WMCP-SEC-013', 'inline script #1']]);
  const text = JSON.stringify(out);
  for (const key of Object.values(FIXTURE_KEYS)) assert.ok(!text.includes(key), 'no key value leaves the scan');
  assert.ok(!text.includes('step=2') && !text.includes('?v=3'), 'labels carry paths, not queries');
});

test('013 skips an unreadable file and refuses a page that changed origin', async (t) => {
  stubChrome({ page: PAGE });
  t.mock.method(globalThis, 'fetch', async () => new Response('gone', { status: 404 }));
  const out = await scanSecrets({ tabId: 7, topOrigin: ORIGIN });
  assert.deepEqual(out.scanned, { inline: 1, files: 0, skipped: 1, otherOrigins: 1 });
  assert.equal(out.findings.length, 1);
  stubChrome({ page: { ...PAGE, url: 'https://elsewhere.test/' } });
  assert.equal((await scanSecrets({ tabId: 7, topOrigin: ORIGIN })).code, 'origin-changed');
});
