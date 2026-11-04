import test from 'node:test';
import assert from 'node:assert/strict';

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.className = '';
    this._text = '';
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
    }
  }
  querySelectorAll(selector) {
    return descendants(this).filter((n) => (selector.startsWith('.')
      ? n.className.split(/\s+/).includes(selector.slice(1))
      : n.tagName === selector.toUpperCase()));
  }
}
function descendants(n) { return n.children.flatMap((c) => [c, ...descendants(c)]); }

globalThis.document = {
  createElement: (tag) => new Element(tag),
  createTextNode: (text) => { const n = new Element('#text'); n.textContent = text; return n; },
};

const { renderMarkdown } = await import('../src/ui/components/markdown.js');

test('renders headings, bold, italic, inline code, lists and fenced code blocks', () => {
  const md = [
    '# Summary',
    '',
    'Found **2 products** matching `jacket` in *stock*:',
    '',
    '- Alpine Shell (**$189**)',
    '- Rain Coat (`#rc-2`)',
    '',
    '1. First step',
    '2. Second step',
    '',
    '```json',
    '{"ok": true}',
    '```',
  ].join('\n');

  const node = renderMarkdown(md);
  assert.ok(node.className.includes('ag-text'));
  assert.ok(node.className.includes('md-body'));
  assert.equal(node.querySelectorAll('.md-h1').length, 1);
  assert.equal(node.querySelectorAll('.md-h1')[0].textContent, 'Summary');
  assert.equal(node.querySelectorAll('strong').map((n) => n.textContent).join(','), '2 products,$189');
  assert.equal(node.querySelectorAll('em')[0].textContent, 'stock');
  assert.equal(node.querySelectorAll('.md-inline-code').map((n) => n.textContent).join(','), 'jacket,#rc-2');
  assert.equal(node.querySelectorAll('ul').length, 1);
  assert.equal(node.querySelectorAll('ol').length, 1);
  assert.equal(node.querySelectorAll('li').length, 4);
  const codeblocks = node.querySelectorAll('.md-codeblock');
  assert.equal(codeblocks.length, 1);
  assert.equal(codeblocks[0].getAttribute('data-lang'), 'json');
  assert.equal(codeblocks[0].textContent, '{"ok": true}');
  // Never emits <pre> inside .md-body so .ag-transcript pre stays exclusive to .ag-execution
  assert.equal(node.querySelectorAll('pre').length, 0);
});

test('never creates clickable <a> links or remote <img> elements', () => {
  const md = 'See [Documentation](https://evil.example/track) and ![pixel](https://evil.example/p.png)';
  const node = renderMarkdown(md);
  assert.equal(node.querySelectorAll('a').length, 0);
  assert.equal(node.querySelectorAll('img').length, 0);
  assert.match(node.textContent, /Documentation \(https:\/\/evil\.example\/track\)/);
  assert.match(node.textContent, /\[image: pixel\]/);
});

test('hostile HTML and script payloads are rendered as literal text, never elements', () => {
  const hostile = [
    '<script>window.pwned = true;</script>',
    '<img src=x onerror="alert(1)">',
    '**[click](javascript:alert(1))**',
    '`<svg onload=alert(1)>`',
  ].join('\n');
  const node = renderMarkdown(hostile);
  assert.equal(node.querySelectorAll('script').length, 0);
  assert.equal(node.querySelectorAll('img').length, 0);
  assert.equal(node.querySelectorAll('svg').length, 0);
  assert.equal(node.querySelectorAll('a').length, 0);
  assert.ok(node.textContent.includes('<script>window.pwned = true;</script>'));
  assert.ok(node.textContent.includes('<img src=x onerror="alert(1)">'));
});
