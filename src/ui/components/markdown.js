// Safe, zero-innerHTML Markdown renderer for Agent Lab answers and thoughts (F12, D-019).
//
// Security and honesty guarantees:
//  1. Built exclusively with `el()` (`document.createElement` and `textContent`) — never
//     `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval` or `DOMParser`. Raw HTML tags
//     in model output are always rendered as literal text.
//  2. No clickable `<a>` links and no `<img>` fetches: links render as plain text (`label (url)`)
//     and image syntax renders as `[image: alt]`, so a model response can never trigger an
//     unsolicited network request or navigate the side panel.
//  3. Uses `<div class="md-codeblock">` rather than `<pre>` and `<div class="md-heading">`
//     rather than `<h1>`–`<h4>` so existing transcript and section selectors in E2E tests
//     (`.ag-transcript pre`, `#view h2`) remain unambiguous.

import { el } from '../dom.js';

const INLINE_PATTERN = /(`[^`\n]+`|\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|\*(?!\s)[^*\n]+(?<!\s)\*|!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)|\[[^\]]+\]\([^)\s]+(?:\s+"[^"]*")?\))/g;

export function parseInline(text) {
  const source = String(text ?? '');
  const nodes = [];
  let lastIndex = 0;

  for (const match of source.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(source.slice(lastIndex, index));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(el('code', { class: 'mono md-inline-code', text: token.slice(1, -1) }));
    } else if (token.startsWith('***') && token.endsWith('***')) {
      nodes.push(el('strong', {}, [el('em', { text: token.slice(3, -3) })]));
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(el('strong', { text: token.slice(2, -2) }));
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(el('em', { text: token.slice(1, -1) }));
    } else if (token.startsWith('![')) {
      const m = token.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
      const alt = m?.[1]?.trim() || 'image';
      nodes.push(el('span', { class: 'muted', text: `[image: ${alt}]` }));
    } else if (token.startsWith('[')) {
      const m = token.match(/^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
      const label = m?.[1] ?? token;
      const url = m?.[2] ?? '';
      if (!url || label.trim() === url.trim()) {
        nodes.push(el('span', { class: 'mono md-link-text', text: label }));
      } else {
        nodes.push(
          el('span', { class: 'md-link-text', text: label }),
          ' ',
          el('span', { class: 'muted mono', text: `(${url})` }),
        );
      }
    } else {
      nodes.push(token);
    }
    lastIndex = index + token.length;
  }

  if (lastIndex < source.length) {
    nodes.push(source.slice(lastIndex));
  }
  return nodes.length ? nodes : [source];
}

export function renderMarkdown(rawText, { className = 'ag-text md-body' } = {}) {
  const source = String(rawText ?? '');
  const root = el('div', { class: className });
  if (!source) return root;

  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block: ```lang ... ```
    const fence = line.match(/^\s*```([\w.-]*)\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // skip closing ```
      const codeBox = el('div', {
        class: 'md-codeblock mono',
        ...(lang ? { 'data-lang': lang } : {}),
      }, [
        el('code', { text: codeLines.join('\n') }),
      ]);
      blocks.push(codeBox);
      continue;
    }

    // Blank line between blocks
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Heading: # .. ####
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(el('div', { class: `md-heading md-h${level}` }, parseInline(heading[2].trim())));
      i += 1;
      continue;
    }

    // Unordered list: - item or * item
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*[-*]\s+/, '');
        items.push(el('li', { class: 'md-li' }, parseInline(itemText)));
        i += 1;
      }
      const ul = el('ul', { class: 'md-list' });
      items.forEach((li, idx) => {
        if (idx > 0) ul.append('\n');
        ul.append(li);
      });
      blocks.push(ul);
      continue;
    }

    // Ordered list: 1. item
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*\d+\.\s+/, '');
        items.push(el('li', { class: 'md-li' }, parseInline(itemText)));
        i += 1;
      }
      const ol = el('ol', { class: 'md-list' });
      items.forEach((li, idx) => {
        if (idx > 0) ol.append('\n');
        ol.append(li);
      });
      blocks.push(ol);
      continue;
    }

    // Blockquote: > text
    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push(el('blockquote', { class: 'md-quote' }, parseInline(quoteLines.join('\n'))));
      continue;
    }

    // Paragraph: collect consecutive regular lines
    const paraLines = [];
    while (
      i < lines.length
      && lines[i].trim()
      && !/^\s*```/.test(lines[i])
      && !/^(#{1,4})\s+/.test(lines[i])
      && !/^\s*[-*]\s+/.test(lines[i])
      && !/^\s*\d+\.\s+/.test(lines[i])
      && !/^\s*>\s?/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push(el('p', { class: 'md-p' }, parseInline(paraLines.join('\n'))));
  }

  blocks.forEach((block, idx) => {
    if (idx > 0) root.append('\n');
    root.append(block);
  });
  return root;
}
