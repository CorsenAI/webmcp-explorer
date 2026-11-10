// Origin-trial tokens: decoding, Chrome's origin and expiry rules, signature verification.
// Tokens are built here and signed with a key made for the test; Chrome's own key is a constant
// whose value and signed-data layout were checked once against production tokens (D-146).
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  decodeTrialToken, matchesTokenOrigin, assessTrialToken, verifyTrialToken, splitTokenHeader, reviewTrialTokens, webmcpTrialOf,
  WEBMCP_TRIAL, CHROME_TRIAL_PUBLIC_KEY, MAX_TOKENS,
} from '../src/core/origin-trial.js';
import { diagnoseEnvironment, REQUIRED_SURFACE } from '../src/core/env.js';

const subtle = webcrypto.subtle;
const pair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const TEST_KEY = Buffer.from(await subtle.exportKey('raw', pair.publicKey)).toString('hex');
const NOW = Date.parse('2026-11-09T12:00:00Z');
const inDays = (n) => Math.floor((NOW + n * 86_400_000) / 1000);

async function token(payload, { version = 3, raw = null } = {}) {
  const body = Buffer.from(raw ?? JSON.stringify(payload));
  const length = Buffer.alloc(4); length.writeUInt32BE(body.length);
  const signed = Buffer.concat([Buffer.from([version]), length, body]);
  const signature = Buffer.from(await subtle.sign('Ed25519', pair.privateKey, signed));
  return Buffer.concat([Buffer.from([version]), signature, length, body]).toString('base64');
}
const webmcp = (over = {}) => ({ origin: 'https://shop.example:443', feature: WEBMCP_TRIAL, expiry: inDays(30), ...over });

test('a token decodes to its origin, feature, expiry and flags; Chrome\'s key is 32 bytes of hex', async () => {
  const t = decodeTrialToken(await token(webmcp({ isSubdomain: true, isThirdParty: true, usage: 'subset' })));
  assert.deepEqual({ ok: t.ok, version: t.version, feature: t.feature, origin: t.origin, isSubdomain: t.isSubdomain, isThirdParty: t.isThirdParty, usage: t.usage, expiry: t.expiry },
    { ok: true, version: 3, feature: 'WebMCP', origin: 'https://shop.example', isSubdomain: true, isThirdParty: true, usage: 'subset', expiry: inDays(30) });
  assert.equal(t.signature.length, 64);
  assert.match(CHROME_TRIAL_PUBLIC_KEY, /^[0-9a-f]{64}$/);
  // Version 2 has no third-party or usage field: they stay at their defaults.
  const v2 = decodeTrialToken(await token(webmcp({ isThirdParty: true, usage: 'subset' }), { version: 2 }));
  assert.equal(v2.isThirdParty, false); assert.equal(v2.usage, null);
});

test('malformed tokens are refused for the reason Chrome would refuse them', async () => {
  const good = await token(webmcp());
  const reasons = {
    'not-base64!': 'not-base64', '': 'not-base64', [`${'A'.repeat(6145)}`]: 'not-base64', 'QUJD': 'too-short',
    // Chrome decodes the text as given, strictly: blanks anywhere and missing padding are refused.
    'not base64 !': 'whitespace', [` ${good}`]: 'whitespace', [`${good}\n`]: 'whitespace', [`${good.slice(0, 40)}\n${good.slice(40)}`]: 'whitespace',
    [good.replace(/=+$/, '')]: good.endsWith('=') ? 'not-base64' : undefined, 'QUJ': 'not-base64', 'QUJD-_8=': 'not-base64',
    [await token(webmcp(), { version: 1 })]: 'unknown-version',
    [Buffer.concat([Buffer.from(good, 'base64'), Buffer.from('x')]).toString('base64')]: 'bad-length',
    [await token(null, { raw: '{not json' })]: 'bad-payload',
    [await token(null, { raw: '[1]' })]: 'bad-payload',
    [await token({ feature: 'WebMCP', expiry: inDays(1) })]: 'bad-origin',
    [await token(webmcp({ origin: 'data:text/plain,x' }))]: 'bad-origin',
    [await token(webmcp({ feature: '' }))]: 'bad-feature',
    [await token(webmcp({ expiry: 0 }))]: 'bad-expiry',
    [await token(webmcp({ expiry: 1.5 }))]: 'bad-expiry',
    [await token(webmcp({ isSubdomain: 'yes' }))]: 'bad-payload',
    [await token(webmcp({ usage: 'all' }))]: 'bad-payload',
  };
  for (const [text, reason] of Object.entries(reasons)) if (reason) assert.deepEqual(decodeTrialToken(text), { ok: false, reason }, reason);
});

test('origin matching: exact, or subdomains with the same scheme and port; a look-alike host never matches', async () => {
  const exact = decodeTrialToken(await token(webmcp()));
  const sub = decodeTrialToken(await token(webmcp({ origin: 'https://example.com', isSubdomain: true })));
  assert.equal(matchesTokenOrigin(exact, 'https://shop.example'), true);
  assert.equal(matchesTokenOrigin(exact, 'https://www.shop.example'), false);
  for (const [origin, expected] of [['https://example.com', true], ['https://www.example.com', true], ['https://a.b.example.com:443', true],
    ['http://www.example.com', false], ['https://www.example.com:8443', false], ['https://evilexample.com', false], ['https://example.com.evil.test', false]]) {
    assert.equal(matchesTokenOrigin(sub, origin), expected, origin);
  }
});

test('assessment follows Chrome\'s order: origin, then expiry, then the secure context', async () => {
  const at = async (payload, pageOrigin) => assessTrialToken(decodeTrialToken(await token(payload)), { pageOrigin, now: NOW });
  assert.deepEqual(await at(webmcp(), 'https://shop.example'), { status: 'valid', expiresAt: new Date(inDays(30) * 1000).toISOString(), daysLeft: 30 });
  assert.equal((await at(webmcp({ expiry: inDays(-1) }), 'https://shop.example')).status, 'expired');
  // Expired and for another origin: Chrome reports the origin first.
  assert.equal((await at(webmcp({ expiry: inDays(-1) }), 'https://other.example')).status, 'wrong-origin');
  assert.equal((await at(webmcp({ origin: 'http://shop.example' }), 'http://shop.example')).status, 'insecure-origin');
  assert.equal((await at(webmcp({ origin: 'http://localhost:8777' }), 'http://localhost:8777')).status, 'valid');
  // A third-party token is matched against the injecting script, not the page.
  assert.equal((await at(webmcp({ origin: 'https://cdn.widgets.example', isThirdParty: true }), 'https://shop.example')).status, 'third-party');
  assert.equal((await at(webmcp({ origin: 'https://cdn.widgets.example', isThirdParty: true, expiry: inDays(-2) }), 'https://shop.example')).status, 'expired');
  assert.equal((await at(webmcp({ origin: 'https://cdn.widgets.example', isThirdParty: true }), 'http://shop.example')).status, 'insecure-origin');
});

test('the signature is checked against the given keys; a changed byte or another signer is invalid', async () => {
  const good = decodeTrialToken(await token(webmcp()));
  assert.equal(await verifyTrialToken(good, { publicKeys: [TEST_KEY], subtle }), 'valid');
  assert.equal(await verifyTrialToken(good, { subtle }), 'invalid', 'not signed with Chrome\'s key');
  assert.equal(await verifyTrialToken(good, { publicKeys: [CHROME_TRIAL_PUBLIC_KEY, TEST_KEY], subtle }), 'valid');
  const tampered = decodeTrialToken(await token(webmcp()));
  tampered.signed[tampered.signed.length - 2] ^= 1;
  assert.equal(await verifyTrialToken(tampered, { publicKeys: [TEST_KEY], subtle }), 'invalid');
  assert.equal(await verifyTrialToken(good, { publicKeys: [TEST_KEY], subtle: null }), 'not-checked');
  assert.equal(await verifyTrialToken({ ok: false }, { subtle }), 'invalid');
});

test('a header carries one token or a list, quoted or not', () => {
  assert.deepEqual(splitTokenHeader('AAA, "BBB" ,\'CCC\'\nDDD'), ['AAA', 'BBB', 'CCC', 'DDD']);
  assert.deepEqual(splitTokenHeader(''), []);
  assert.equal(splitTokenHeader(Array(50).fill('A').join(',')).length, MAX_TOKENS);
});

test('a review lists each distinct token once, without its text, and names the WebMCP token that counts', async () => {
  const valid = await token(webmcp());
  const expired = await token(webmcp({ expiry: inDays(-3) }));
  const other = await token(webmcp({ feature: 'SomeOtherTrial' }));
  const list = await reviewTrialTokens([{ source: 'meta', token: expired }, { source: 'header', token: valid }, { source: 'meta', token: valid },
    { source: 'meta', token: other }, { source: 'meta', token: 'garbage!' }], { pageOrigin: 'https://shop.example', now: NOW, publicKeys: [TEST_KEY], subtle });
  assert.deepEqual(list.map((t) => [t.source, t.feature, t.status, t.signature, t.webmcp]),
    [['meta', 'WebMCP', 'expired', 'valid', true], ['header+meta', 'WebMCP', 'valid', 'valid', true], ['meta', 'SomeOtherTrial', 'valid', 'valid', false], ['meta', null, 'malformed', 'invalid', false]]);
  assert.ok(!JSON.stringify(list).includes(valid.slice(0, 40)), 'the token text is not kept');
  const trial = webmcpTrialOf(list);
  assert.deepEqual([trial.present, trial.active, trial.token.status], [true, true, 'valid']);
  // Without a token Chrome honours, the WebMCP token closest to working explains why.
  const stale = webmcpTrialOf(list.filter((t) => t.status !== 'valid'));
  assert.deepEqual([stale.present, stale.active, stale.token.status], [true, false, 'expired']);
  // Not signed with a known key: Chrome ignores it, whatever its dates say.
  const forged = await reviewTrialTokens([{ source: 'meta', token: valid }], { pageOrigin: 'https://shop.example', now: NOW, subtle });
  assert.deepEqual([forged[0].signature, webmcpTrialOf(forged).active], ['invalid', false]);
  assert.deepEqual(webmcpTrialOf([]), { present: false, active: false, token: null, count: 0 });
});

test('several tokens: the honoured one that lasts longest counts, as in Chrome; a renewed token ends the expiry warning', async () => {
  const review = (entries, pageOrigin = 'https://shop.example') => reviewTrialTokens(entries, { pageOrigin, now: NOW, publicKeys: [TEST_KEY], subtle });
  const old = { source: 'meta', token: await token(webmcp({ expiry: inDays(5) })) };
  const renewed = { source: 'meta', token: await token(webmcp({ expiry: inDays(90) })) };
  for (const entries of [[old, renewed], [renewed, old]]) {
    const trial = webmcpTrialOf(await review(entries));
    assert.deepEqual([trial.active, trial.count, trial.token.daysLeft], [true, 2, 90]);
  }
  // A first-party token covers the page; a third-party one only the script that adds it.
  const third = { source: 'script', token: await token(webmcp({ origin: 'https://cdn.widgets.example', isThirdParty: true, expiry: inDays(200) })) };
  const mixed = webmcpTrialOf(await review([third, old]));
  assert.deepEqual([mixed.active, mixed.token.status, mixed.token.daysLeft], [true, 'valid', 5]);
  const onlyThird = webmcpTrialOf(await review([third]));
  assert.deepEqual([onlyThird.active, onlyThird.token.status], [true, 'third-party']);
});

test('no honoured token: the one closest to working is named, whatever the order on the page', async () => {
  const review = (entries, pageOrigin) => reviewTrialTokens(entries, { pageOrigin, now: NOW, publicKeys: [TEST_KEY], subtle });
  // A site that serves one token per host: on www, the apex token is for another origin and the
  // www token has expired. The expired one is the developer's problem.
  const apex = { source: 'meta', token: await token(webmcp({ origin: 'https://shop.example' })) };
  const www = { source: 'meta', token: await token(webmcp({ origin: 'https://www.shop.example', expiry: inDays(-2) })) };
  for (const entries of [[apex, www], [www, apex]]) {
    const trial = webmcpTrialOf(await review(entries, 'https://www.shop.example'));
    assert.deepEqual([trial.active, trial.count, trial.token.status, trial.token.origin], [false, 2, 'expired', 'https://www.shop.example']);
  }
  // A token Chrome signed, even for another origin, before one it did not sign.
  const other = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const body = Buffer.from(JSON.stringify(webmcp()));
  const length = Buffer.alloc(4); length.writeUInt32BE(body.length);
  const signature = Buffer.from(await subtle.sign('Ed25519', other.privateKey, Buffer.concat([Buffer.from([3]), length, body])));
  const forged = { source: 'meta', token: Buffer.concat([Buffer.from([3]), signature, length, body]).toString('base64') };
  const elsewhere = { source: 'meta', token: await token(webmcp({ origin: 'https://other.example' })) };
  const trial = webmcpTrialOf(await review([forged, elsewhere], 'https://shop.example'));
  assert.deepEqual([trial.active, trial.token.status, trial.token.signature], [false, 'wrong-origin', 'valid']);
  assert.equal(webmcpTrialOf(await review([forged], 'https://shop.example')).token.signature, 'invalid');
});

test('a third-party token counts only when a script adds it: in a header or the served markup Chrome has no script origin to match', async () => {
  const third = await token(webmcp({ origin: 'https://cdn.widgets.example', isThirdParty: true }));
  const review = async (sources) => (await reviewTrialTokens(sources.map((source) => ({ source, token: third })), { pageOrigin: 'https://shop.example', now: NOW, publicKeys: [TEST_KEY], subtle }))[0];
  assert.deepEqual([(await review(['header'])).status, (await review(['header'])).source], ['not-injected', 'header']);
  assert.equal((await review(['markup'])).status, 'not-injected');
  assert.deepEqual([(await review(['header', 'markup'])).status, (await review(['header', 'markup'])).source], ['not-injected', 'header+markup']);
  // One copy added by a script is enough for Chrome to match it against that script.
  assert.deepEqual([(await review(['header', 'script'])).status, (await review(['header', 'script'])).source], ['third-party', 'header+script']);
  assert.equal((await review(['script'])).status, 'third-party');
  // An extension sees meta elements without knowing how they got there: nothing is ruled out.
  assert.equal((await review(['meta'])).status, 'third-party');
  assert.equal((await review(['something-else'])).source, 'meta');
  // Chrome reports the origin before the date: a static third-party token is refused, expired or not.
  const stale = decodeTrialToken(await token(webmcp({ origin: 'https://cdn.widgets.example', isThirdParty: true, expiry: inDays(-3) })));
  assert.equal(assessTrialToken(stale, { pageOrigin: 'https://shop.example', now: NOW, staticOnly: true }).status, 'not-injected');
  assert.equal(assessTrialToken(stale, { pageOrigin: 'https://shop.example', now: NOW }).status, 'expired');
  // Delivery does not matter for a first-party token.
  const first = decodeTrialToken(await token(webmcp()));
  assert.equal(assessTrialToken(first, { pageOrigin: 'https://shop.example', now: NOW, staticOnly: true }).status, 'valid');
  const ignored = webmcpTrialOf([await review(['header'])]);
  assert.deepEqual([ignored.present, ignored.active, ignored.token.status], [true, false, 'not-injected']);
});

test('delivery faults come first: a meta element outside <head> is never read, a token with blanks does not decode', async () => {
  const review = (entries, pageOrigin = 'https://shop.example') => reviewTrialTokens(entries, { pageOrigin, now: NOW, publicKeys: [TEST_KEY], subtle });
  const good = await token(webmcp());
  // Chrome reads origin-trial meta elements only inside <head> (http_equiv.cc).
  const [body] = await review([{ source: 'markup', token: good, inHead: false }]);
  assert.deepEqual([body.status, body.otherwise, body.webmcp, body.signature, body.daysLeft], ['outside-head', 'valid', true, 'valid', 30]);
  assert.deepEqual([webmcpTrialOf([body]).active, webmcpTrialOf([body]).token.status], [false, 'outside-head']);
  // One copy in a place Chrome reads is enough: in <head>, or in the response header.
  assert.equal((await review([{ source: 'markup', token: good, inHead: false }, { source: 'script', token: good, inHead: true }]))[0].status, 'valid');
  assert.equal((await review([{ source: 'header', token: good }, { source: 'markup', token: good, inHead: false }]))[0].status, 'valid');
  assert.equal((await review([{ source: 'meta', token: good }]))[0].status, 'valid', 'placement not stated: nothing is ruled out');
  // The attribute reaches the decoder unchanged and Base64 decoding is strict.
  for (const text of [`\n  ${good}\n`, ` ${good}`, `${good.slice(0, 50)}\n${good.slice(50)}`]) {
    const [spaced] = await review([{ source: 'markup', token: text, inHead: true }]);
    assert.deepEqual([spaced.status, spaced.reason, spaced.otherwise, spaced.feature, spaced.webmcp, spaced.origin, spaced.signature],
      ['malformed', 'whitespace', 'valid', 'WebMCP', true, 'https://shop.example', 'valid']);
    assert.equal(webmcpTrialOf([spaced]).active, false);
  }
  // Outside <head> comes before the blanks: Chrome never gets as far as decoding.
  assert.equal((await review([{ source: 'markup', token: ` ${good} `, inHead: false }]))[0].status, 'outside-head');
  // Blanks around something that is no token stay an unknown malformed token.
  assert.deepEqual((await review([{ source: 'markup', token: ' garbage! ' }]))[0], { source: 'markup', status: 'malformed', reason: 'whitespace', feature: null, webmcp: false, signature: 'invalid' });
  // The same token with and without blanks are two texts: the clean copy is honoured.
  const pair = await review([{ source: 'header', token: good }, { source: 'markup', token: `${good}\n`, inHead: true }]);
  assert.deepEqual(pair.map((t) => t.status), ['valid', 'malformed']);
  assert.deepEqual([webmcpTrialOf(pair).active, webmcpTrialOf(pair).count], [true, 2]);
  // A token that only needs moving or cleaning is named before one that has expired.
  const expired = { source: 'markup', token: await token(webmcp({ expiry: inDays(-2) })), inHead: true };
  const misplaced = { source: 'markup', token: good, inHead: false };
  for (const entries of [[expired, misplaced], [misplaced, expired]]) assert.equal(webmcpTrialOf(await review(entries)).token.status, 'outside-head');
  const misplacedExpired = { source: 'markup', token: await token(webmcp({ expiry: inDays(-9) })), inHead: false };
  const stale = webmcpTrialOf(await review([expired, misplacedExpired]));
  assert.deepEqual([stale.token.status, stale.token.otherwise], ['outside-head', 'expired']);
});

test('the environment says "origin trial" only for a WebMCP token Chrome honours on this page', async () => {
  const signals = { apiHost: 'document', methods: REQUIRED_SURFACE.slice(), secureContext: true, originTrialToken: true, isTopLevel: true };
  const review = (payload) => reviewTrialTokens([{ source: 'meta', token: payload }], { pageOrigin: 'https://shop.example', now: NOW, publicKeys: [TEST_KEY], subtle });
  // Without reviewed tokens the older rule stands: a meta tag is taken at its word.
  assert.equal(diagnoseEnvironment(signals).state, 'origin-trial');
  assert.equal(diagnoseEnvironment(signals).originTrial, null);
  const honoured = diagnoseEnvironment({ ...signals, originTrials: await review(await token(webmcp())) });
  assert.deepEqual([honoured.state, honoured.originTrial.active, honoured.originTrial.token.daysLeft], ['origin-trial', true, 30]);
  const expired = diagnoseEnvironment({ ...signals, originTrials: await review(await token(webmcp({ expiry: inDays(-1) }))) });
  assert.deepEqual([expired.state, expired.originTrial.active, expired.originTrial.token.status], ['native', false, 'expired']);
  const unrelated = diagnoseEnvironment({ ...signals, originTrials: await review(await token(webmcp({ feature: 'SomeOtherTrial' }))) });
  assert.deepEqual([unrelated.state, unrelated.originTrial.present, unrelated.originTrial.others], ['native', false, 1]);
});
