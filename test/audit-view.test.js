// The Audit screen, driven through the same minimal DOM the Runner view test uses: the real
// view module renders, and what is asserted is what a user would see — the score, the worst
// tool first, every finding with its message, and an honest empty state. The engine itself
// (src/core/audit.js) is covered by audit.test.js; this file covers only the screen.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const messages = JSON.parse(readFileSync(new URL('../src/_locales/en/messages.json', import.meta.url), 'utf8'));

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.className = '';
    this._text = '';
    this.dataset = {};
    this.parentNode = null;
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(value) { this._text = String(value ?? ''); this.children = []; }
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
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  replaceChildren(...xs) { this.children = []; this._text = ''; this.append(...xs); }
  get classList() {
    return {
      contains: (x) => this.className.split(/\s+/).includes(x),
      add: (x) => { this.className += ' ' + x; },
      remove: (x) => { this.className = this.className.split(/\s+/).filter((v) => v !== x).join(' '); },
    };
  }
  querySelector(s) { return this.querySelectorAll(s)[0] ?? null; }
  querySelectorAll(selector) {
    return descendants(this).filter((n) => (selector.startsWith('.')
      ? n.classList.contains(selector.slice(1))
      : selector.startsWith('#') ? n.attrs.id === selector.slice(1) : n.tagName === selector.toUpperCase()));
  }
}
function descendants(n) { return n.children.flatMap((c) => [c, ...descendants(c)]); }

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
  runtime: {},
};

const { renderAudit } = await import('../src/ui/views/audit.js');

const good = {
  name: 'search_products',
  description: 'Search the catalogue for products matching a text query and return their prices.',
  inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Text to match.' } } },
  annotations: { readOnlyHint: true },
};
const vague = { name: 'do', description: 'Do things', inputSchema: { type: 'object', properties: {} }, annotations: {} };
const bare = { name: 'submit-order', description: '', annotations: {} };

function render(tools) {
  const host = new Element('main');
  const result = renderAudit(host, { tools, topOrigin: 'shop.example' });
  return { host, result };
}

test('the screen shows one toolset score and every tool listed worst first', () => {
  const { host, result } = render([good, bare, vague]);
  assert.equal(result.perTool.length, 3);
  const names = host.querySelectorAll('.au-tool')
    .map((row) => row.querySelector('.au-name').textContent);
  const scores = result.perTool.map((t) => t.score);
  assert.deepEqual(names, [...result.perTool]
    .sort((a, b) => a.score - b.score).map((t) => t.tool));
  // The listed order really is the score order, not just the same set.
  const shown = host.querySelectorAll('.au-tool').flatMap((row) => row.querySelectorAll('.badge'))
    .map((b) => parseInt(b.textContent, 10)).filter((n) => Number.isFinite(n));
  assert.deepEqual(shown.sort((a, b) => a - b), [...scores].sort((a, b) => a - b));
});

test('the head carries the overall score and the three counts', () => {
  const { host, result } = render([good, bare, vague]);
  const head = host.querySelector('.au-head');
  assert.ok(head.textContent.includes(`${result.overall}/100`), head.textContent);
  for (const key of ['pass', 'warn', 'fail']) {
    const label = messages[`audit_${key}N`].message.replace('$1', String(result.counts[key]));
    assert.ok(head.textContent.includes(label), `missing count ${key}: ${head.textContent}`);
  }
});

test('a clean tool says so and a flagged tool lists its findings', () => {
  const { host } = render([good, bare]);
  const rows = host.querySelectorAll('.au-tool');
  const clean = rows.find((r) => r.textContent.includes('submit-order'));
  const flagged = rows.find((r) => r.textContent.includes('search_products'));
  assert.ok(clean.querySelector('.au-item'), 'the bare tool must list its findings');
  assert.ok(flagged.textContent.includes('No contract findings'), 'the good tool must read as clean');
});

test('an empty toolset renders an honest empty state', () => {
  const { host } = render([]);
  assert.ok(host.textContent.includes('No tools to audit on this page yet.'));
});

test('every visible string comes from the locale file, none from a raw key', () => {
  const { host } = render([good, vague]);
  const text = host.textContent;
  for (const raw of ['audit_', 'sidepanel_', 'exportBar_', 'help_']) {
    assert.ok(!text.includes(raw), `raw i18n key leaked into the screen: ${raw}`);
  }
});

test('the audit replaces the screen it is drawn on, like every other view', () => {
  // Regression: the view used to append, so switching section stacked the audit under the
  // previous screen. It was caught by looking at a real Store capture, not by a test — hence
  // this one. The house convention is root.replaceChildren(...) (tools.js, evals.js).
  const host = new Element('main');
  const stale = new Element('p');
  stale.setAttribute('class', 'stale-screen');
  host.append(stale);
  renderAudit(host, { tools: [vague], topOrigin: 'shop.example' });
  assert.equal(host.querySelector('.stale-screen'), null, 'the previous screen must be gone');
  assert.ok(host.querySelector('.au-head'), 'and the audit must be what is left');
});

test('the safety boundary is stated on screen, not only in code', () => {
  const { host } = render([good]);
  assert.match(host.textContent, /never safety/i);
});

test('onOpenTool renders an Open tool action button on each tool row', () => {
  const host = new Element('main');
  let opened = null;
  renderAudit(host, {
    tools: [{ ...good, instanceId: '0:search_products' }],
    topOrigin: 'shop.example',
    onOpenTool: (item) => { opened = item; },
  });
  const btn = host.querySelector('.au-open-tool');
  assert.ok(btn, 'expected .au-open-tool button');
  for (const fn of btn.listeners.click ?? []) fn();
  assert.equal(opened?.tool, 'search_products');
  assert.equal(opened?.instanceId, '0:search_products');
});
