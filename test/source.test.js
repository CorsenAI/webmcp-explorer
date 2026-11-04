import test from 'node:test';
import assert from 'node:assert/strict';

import { parseStack, shortLocation, UNKNOWN_REASON } from '../src/core/source.js';

const stack = (...lines) => ['Error', ...lines].join('\n');

test('the first site frame is the answer', () => {
  const out = parseStack(stack(
    '    at registerTool (chrome-extension://abc/page/instrument.js:12:9)',
    '    at setupTools (http://localhost:8777/app.js:42:7)',
    '    at http://localhost:8777/main.js:3:1',
  ));
  assert.equal(out.known, true);
  assert.equal(out.file, 'http://localhost:8777/app.js');
  assert.equal(out.line, 42);
  assert.equal(out.column, 7);
  assert.equal(out.function, 'setupTools');
});

test('the callers below it are kept, so a helper can be traced back', () => {
  const out = parseStack(stack(
    '    at register (http://localhost:8777/helpers.js:8:3)',
    '    at setupTools (http://localhost:8777/app.js:42:7)',
    '    at http://localhost:8777/main.js:3:1',
  ));
  assert.equal(out.file, 'http://localhost:8777/helpers.js');
  assert.deepEqual(out.callers.map((c) => c.line), [42, 3]);
  assert.equal(out.callers[1].function, null);
});

test('frames the caller asks to skip are skipped', () => {
  const out = parseStack(stack(
    '    at wrapper (http://localhost:8777/app.js:1:1)',
    '    at real (http://localhost:8777/app.js:99:1)',
  ), { drop: 1 });
  assert.equal(out.line, 99);
});

test('Explorer’s own frames are never reported as the source', () => {
  const out = parseStack(stack(
    '    at chrome-extension://abc/page/instrument.js:12:9',
    '    at extensions::SafeBuiltins:1:1',
  ));
  assert.equal(out.known, false);
  assert.equal(out.unknownReason, 'no-site-frame');
});

test('a bare frame with no function name still parses', () => {
  const out = parseStack(stack('    at https://example.com/bundle.js:1200:15'));
  assert.equal(out.known, true);
  assert.equal(out.file, 'https://example.com/bundle.js');
  assert.equal(out.line, 1200);
  assert.equal(out.function, null);
});

test('an eval frame points at the file that ran the eval, not at the eval', () => {
  const out = parseStack(stack(
    '    at register (eval at boot (http://localhost:8777/app.js:7:3), <anonymous>:1:1)',
  ));
  assert.equal(out.known, true);
  assert.equal(out.file, 'http://localhost:8777/app.js');
  assert.equal(out.line, 7);
});

test('a query string in the url is preserved', () => {
  const out = parseStack(stack('    at http://localhost:8777/app.js?v=3:10:2'));
  assert.equal(out.known, true);
  assert.equal(out.file, 'http://localhost:8777/app.js?v=3');
  assert.equal(out.line, 10);
});

test('no stack means no answer, and a reason', () => {
  for (const value of [undefined, null, '', '   ', 42]) {
    const out = parseStack(value);
    assert.equal(out.known, false);
    assert.equal(out.unknownReason, 'no-stack');
  }
});

test('a stack with no frames says so rather than guessing', () => {
  const out = parseStack('TypeError: nope');
  assert.equal(out.known, false);
  assert.equal(out.unknownReason, 'no-frames');
});

test('frames that cannot be read are reported as unparsable, not invented', () => {
  const out = parseStack(stack('    at something entirely unexpected'));
  assert.equal(out.known, false);
  assert.equal(out.unknownReason, 'unparsable');
});

test('every reason code has a sentence the interface can show', () => {
  for (const code of ['not-instrumented', 'no-stack', 'no-frames', 'no-site-frame',
    'unparsable']) {
    assert.ok(UNKNOWN_REASON[code], `no text for ${code}`);
  }
});

test('the short label is the file name and the line', () => {
  const out = parseStack(stack('    at go (http://localhost:8777/js/app.bundle.js:42:7)'));
  assert.equal(shortLocation(out), 'app.bundle.js:42');
});

test('a source that is not known has no label at all', () => {
  assert.equal(shortLocation({ known: false }), null);
  assert.equal(shortLocation(null), null);
});

test('a url with no path falls back to the host rather than to nothing', () => {
  const out = parseStack(stack('    at https://example.com:5:1'));
  assert.equal(shortLocation(out), 'example.com:5');
});
