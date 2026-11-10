// Instrumentation and emulation both change the registered content scripts. Sent at the same
// instant, the two requests used to interleave: the instrumentation script could stay registered
// after it was turned off, and one request could be rejected (L-39). They now run one at a time.
import test from 'node:test';
import assert from 'node:assert/strict';

// A stand-in for chrome.scripting whose calls take time, as the real ones do, and which fails the
// way Chrome does when a script to update or remove is not registered.
const scripts = new Map();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
globalThis.chrome = {
  permissions: { contains: async () => true },
  scripting: {
    getRegisteredContentScripts: async () => { await pause(2); return [...scripts.values()].map((s) => ({ ...s })); },
    registerContentScripts: async (list) => { await pause(3); for (const s of list) { if (scripts.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`); scripts.set(s.id, { ...s }); } },
    unregisterContentScripts: async ({ ids }) => { await pause(3); for (const id of ids) { if (!scripts.has(id)) throw new Error(`Nonexistent script ID '${id}'`); scripts.delete(id); } },
    // Chrome replaces the registration: with an unregistration in flight, the script comes back.
    updateContentScripts: async (list) => { await pause(1); for (const s of list) { if (!scripts.has(s.id)) throw new Error(`Content script with ID '${s.id}' does not exist`); } await pause(4); for (const s of list) scripts.set(s.id, { ...(scripts.get(s.id) ?? { id: s.id, matches: ['http://shop.example/*'] }), ...s }); },
  },
};
const { setInstrumented, setEmulated, isInstrumented, instrumentedOrigins, forgetInstrumentation } = await import('../src/background/instrument.js');
const URL_ = 'http://shop.example/page';

test('turning instrumentation and emulation off at the same instant leaves neither registered, round after round', async () => {
  for (let round = 0; round < 40; round += 1) {
    assert.equal((await setInstrumented(URL_, true)).on, true);
    const settled = await Promise.allSettled([setInstrumented(URL_, false), setEmulated(URL_, false)]);
    assert.deepEqual(settled.map((s) => s.status), ['fulfilled', 'fulfilled'], `round ${round}`);
    assert.ok(settled.every((s) => !s.value.error), `round ${round}: ${JSON.stringify(settled.map((s) => s.value))}`);
    assert.equal(await isInstrumented(URL_), false, `round ${round}: instrumentation must be off`);
  }
});

test('requests keep their order: on, emulation on, off, forget', async () => {
  const results = await Promise.all([setInstrumented(URL_, true), setEmulated(URL_, true), setInstrumented(URL_, false), setEmulated(URL_, false),
    setInstrumented(URL_, true), forgetInstrumentation(['http://shop.example/*'])]);
  assert.deepEqual(results.slice(0, 5).map((r) => [r.on, r.error ?? null]), [[true, null], [true, null], [false, null], [false, null], [true, null]]);
  assert.deepEqual(results[5], { removed: 1 });
  assert.deepEqual(await instrumentedOrigins(), []);
  // A failure does not block what follows.
  chrome.scripting.unregisterContentScripts = async () => { throw new Error('boom'); };
  await setInstrumented(URL_, true);
  assert.match((await setInstrumented(URL_, false)).error, /boom/);
  assert.equal((await setEmulated(URL_, false)).on, false);
});
