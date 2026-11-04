import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Runner screen's button handlers, driven through a minimal DOM and a stubbed
// chrome.runtime: the real view module is imported unchanged, and what is asserted is the
// message each button actually emits. Not a native-WebMCP E2E — tools/e2e/form-run.mjs and
// tools/e2e/twins.mjs cover the same paths in a real Chrome. The first four cases were
// contributed by the independent audit of 2026-09-05 (D-057).

const messages = JSON.parse(readFileSync(new URL('../src/_locales/en/messages.json', import.meta.url), 'utf8'));

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.className = '';
    this._text = '';
    this.disabled = false;
    this.dataset = {};
    this.parentNode = null;
    this.hidden = false;
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(value) { this._text = String(value ?? ''); this.children = []; }
  get firstChild() { return this.children[0] ?? null; }
  get childElementCount() { return this.children.length; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...xs) {
    for (let x of xs) {
      if (x === null || x === undefined) continue;
      if (!(x instanceof Element)) { const n = new Element('#text'); n.textContent = String(x); x = n; }
      this.children.push(x);
      x.parentNode = this;
    }
  }
  replaceChildren(...xs) { this.children = []; this._text = ''; this.append(...xs); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatchEvent() { return true; }
  get classList() {
    return {
      contains: (x) => this.className.split(/\s+/).includes(x),
      add: (x) => { this.className += ' ' + x; },
      remove: (x) => { this.className = this.className.split(/\s+/).filter((v) => v !== x).join(' '); },
      toggle: (x, on) => { if (on) this.classList.add(x); else this.classList.remove(x); },
    };
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    return descendants(this).filter((n) => (selector.startsWith('.')
      ? n.classList.contains(selector.slice(1))
      : selector.startsWith('#') ? n.attrs.id === selector.slice(1) : n.tagName === selector.toUpperCase()));
  }
  async click() {
    if (this.disabled) return;
    for (const fn of this.listeners.click ?? []) await fn({ target: this, preventDefault() {} });
    await new Promise((r) => setImmediate(r));
  }
}
function descendants(n) { return n.children.flatMap((c) => [c, ...descendants(c)]); }
function button(root, text) {
  const b = descendants(root).find((n) => n.tagName === 'BUTTON' && n.textContent === text);
  assert.ok(b, `missing button "${text}"; buttons: ${descendants(root).filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent).join(' | ')}`);
  return b;
}

let sent = [];
let entries = [];
globalThis.document = {
  createElement: (tag) => new Element(tag),
  createTextNode: (text) => { const n = new Element('#text'); n.textContent = text; return n; },
};
globalThis.chrome = {
  i18n: {
    getMessage: (key, subs) => {
      let s = messages[key]?.message || key;
      for (let i = 0; i < (subs ?? []).length; i += 1) s = s.replaceAll('$' + (i + 1), subs[i]);
      return s;
    },
  },
  runtime: {
    sendMessage: async (msg) => {
      if (msg.type === 'history') return entries;
      if (msg.type === 'run') {
        sent.push(msg);
        return { ok: true, result: 'counter=1', args: msg.call.args, durationMs: 1, roundTripMs: 2, frameId: msg.call.frameId };
      }
      return [];
    },
  },
};

const { renderToolDetails } = await import('../src/ui/views/tool-details.js');
const { replayability, createEntry } = await import('../src/core/history.js');

function tool(frameId, fp = 'fp-A') {
  return {
    name: 'bump', logicalId: 'shared-logical', instanceId: `shared-logical@${frameId}`, frameId,
    contractFp: fp, origin: 'https://widgets.example', description: 'Increment this widget counter',
    inputSchema: { type: 'object', properties: {} }, annotations: {}, registrationType: 'unknown',
  };
}
function render(chosen, currentTools) {
  sent = [];
  const host = new Element('main');
  renderToolDetails(host, { tool: chosen, tabId: 123, topOrigin: 'https://shop.example', currentTools, onBack() {} });
  return host;
}
function entryFor(t) {
  return createEntry({ tool: t, args: {}, outcome: { ok: true, result: 'old-counter=1', durationMs: 1, roundTripMs: 2 }, id: 'history-1', at: 1 });
}

test('control: a normal Run sends the selected frame', async () => {
  const a = tool(6); const b = tool(7);
  entries = [];
  const host = render(b, [a, b]);
  await button(host, 'Run tool').click();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].call.frameId, 7);
});

test('Run again after a successful no-argument call executes again, with the kept arguments', async () => {
  const a = tool(6);
  entries = [];
  const host = render(a, [a]);
  await button(host, 'Run tool').click();
  assert.equal(sent.length, 1);
  await button(host, 'Run again').click();
  assert.equal(sent.length, 2, 'Run again did not issue a second call after the form was folded');
  assert.deepEqual(sent[1].call.args, sent[0].call.args);
  assert.ok(!host.textContent.includes('The JSON is not valid'), 'no invalid-JSON error for a folded editor');
});

test('control: replay while viewing the original instance keeps its frame', async () => {
  const a = tool(6); const b = tool(7);
  entries = [entryFor(a)];
  const host = render(a, [a, b]);
  await button(host, 'History').click();
  await button(host, 'Replay').click();
  assert.equal(sent[0].call.frameId, 6);
});

test('a shared history entry replays in the frame it was recorded in, and the button says so', async () => {
  const a = tool(6); const b = tool(7);
  entries = [entryFor(a)];
  const host = render(b, [a, b]);
  await button(host, 'History').click();
  // Viewing frame 7, the entry from frame 6 is offered as an explicit replay in frame 6.
  await button(host, 'Replay in frame #6').click();
  assert.equal(sent[0]?.call.frameId, 6, 'the historical call must run where it was recorded, not in the sibling on screen');
});

test('the replay verdict and the replayed contract are the same instance', async () => {
  const a = tool(6); const b = tool(7, 'fp-B');
  entries = [entryFor(a)];
  const host = render(b, [a, b]);
  const verdict = replayability(entries[0], [a, b]);
  assert.equal(verdict.status, 'exact');
  assert.equal(verdict.target, a);
  await button(host, 'History').click();
  await button(host, 'Replay in frame #6').click();
  assert.equal(sent[0]?.call.tool.contractFp, entries[0].contractFp);
});

test('a call whose frame is gone, with several instances left, is refused rather than redirected', async () => {
  const gone = tool(5); const a = tool(6); const b = tool(7);
  entries = [entryFor(gone)];
  const verdict = replayability(entries[0], [a, b]);
  assert.equal(verdict.status, 'ambiguous');
  assert.equal(verdict.canReplay, false);
  assert.equal(verdict.target, null);
  const host = render(b, [a, b]);
  await button(host, 'History').click();
  const replay = descendants(host).find((n) => n.tagName === 'BUTTON' && n.textContent.startsWith('Replay'));
  assert.equal(replay.disabled, true);
  await replay.click();
  assert.equal(sent.length, 0);
});

test('a call whose frame is gone, with a single instance left, replays in that instance', async () => {
  const gone = tool(5); const only = tool(9);
  const verdict = replayability(entryFor(gone), [only]);
  assert.equal(verdict.status, 'exact');
  assert.equal(verdict.target, only);
});
