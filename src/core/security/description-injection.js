// Indicators of prompt injection in the text an agent reads: instructions addressed to the
// agent, characters a person cannot see, look-alike scripts, encoded blobs, markup, addresses
// and texts beyond the budgets agents apply. Each finding quotes the exact excerpt. None of
// them proves an attack: a legitimate description can say "always"; the reviewer decides.
//
// Sources: WebMCP spec §6.3.1.1 (metadata attacks), Chrome secure-tools budgets (description
// 500, parameter description 150, names 30), arXiv 2606.06387 (description injection, long
// description overflow), Unicode TR36. Pure JavaScript.

import { finding } from './catalog.js';
import { modelFacingText, excerptAround, walkProperties } from './text.js';

export const BUDGET = { description: 500, parameterDescription: 150, name: 30 };

// Phrases that address the agent rather than describe the tool.
const DIRECTIVES = [
  /\b(always|never|before|after|first)\s+(call|calling|use|using|invoke|invoking|run|running|execute|executing)\b/i,
  /\b(call|invoke|use|run|execute)\s+(this|the|that)\s+tool\s+(first|before|after|instead|again)\b/i,
  /\bignore\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier|other)\s+(instructions?|rules?|prompts?|guidance|tools?)\b/i,
  /\b(system|developer|assistant|hidden)\s+(prompt|instructions?|message|note)\b/i,
  /\b(you|the\s+(agent|assistant|model|ai))\s+(must|should|are\s+required\s+to|need\s+to|have\s+to)\b/i,
  /\bdo\s+not\s+(tell|inform|mention|reveal|show|ask|warn)\s+(this\s+to\s+)?the\s+(user|person|human)\b/i,
  /\bwithout\s+(asking|telling|informing|confirming\s+with)\s+the\s+(user|person|human)\b/i,
  /\b(send|forward|post|email|transmit)\s+(the\s+)?(user'?s?\s+)?(data|history|credentials|conversation|context|cookies|tokens?)\s+to\b/i,
  /<\s*\/?\s*(system|instruction|important|assistant)\s*>/i,
  /\bIMPORTANT\s*[:!]/,
];

// Invisible and direction-changing characters, and control characters other than tab and
// newline. These never belong in a description a person is meant to read. Built from code
// points: a literal escape in source has been mangled by tooling before (D-053).
const cp = (n) => String.fromCodePoint(n);
const range = (a, b) => `${cp(a)}-${cp(b)}`;
const HIDDEN = new RegExp(
  `[${range(0x200b, 0x200f)}${range(0x2028, 0x2029)}${range(0x202a, 0x202e)}${range(0x2060, 0x2064)}${range(0x2066, 0x2069)}${cp(0xfeff)}${cp(0xad)}]`
  + `|[${range(0x0, 0x8)}${range(0xb, 0xc)}${range(0xe, 0x1f)}${range(0x7f, 0x9f)}]`,
  'g',
);

// A word that mixes Latin letters with Cyrillic or Greek ones.
const GREEK_CYRILLIC = `${range(0x370, 0x3ff)}${range(0x400, 0x4ff)}`;
const MIXED = new RegExp(
  `[\\p{L}\\p{N}_]*(?:[A-Za-z][\\p{L}\\p{N}_]*[${GREEK_CYRILLIC}]|[${GREEK_CYRILLIC}][\\p{L}\\p{N}_]*[A-Za-z])[\\p{L}\\p{N}_]*`,
  'u',
);

const BASE64 = /(?:[A-Za-z0-9+/]{4}){10,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/;
const LONG_HEX = /\b[0-9a-fA-F]{48,}\b/;
const MARKUP = /<\/?[a-zA-Z][^<>]{0,80}>|```|<\|[^|<>]{1,40}\|>|\{\{[^{}]{1,80}\}\}|\[\[[^\]]{1,80}\]\]/;
const ADDRESS = /\bhttps?:\/\/[^\s)<>"']+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/i;

const codePoint = (ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

// The indicators of one text, for callers that judge something other than a contract field
// (the output of a probe, S2). Same patterns, same meaning.
export function scanIndicators(text) {
  const value = String(text ?? '');
  const directives = [];
  for (const re of DIRECTIVES) {
    const m = value.match(re);
    if (m) directives.push(m[0]);
  }
  const hidden = [...new Set([...value.matchAll(HIDDEN)].map((m) => codePoint(m[0])))];
  const mixed = value.match(MIXED);
  const blob = value.match(BASE64) ?? value.match(LONG_HEX);
  const markup = value.match(MARKUP);
  const address = value.match(ADDRESS);
  return {
    directives,
    hidden,
    mixed: mixed ? mixed[0] : null,
    blob: blob ? blob[0].length : null,
    markup: markup ? markup[0] : null,
    address: address ? address[0] : null,
  };
}

export function reviewText(tool) {
  const out = [];
  const fields = modelFacingText(tool);

  for (const f of fields) {
    // Directives: one finding per field, naming every matched phrase.
    const phrases = [];
    for (const re of DIRECTIVES) {
      const m = f.text.match(re);
      if (m) phrases.push({ phrase: m[0], index: m.index });
    }
    if (phrases.length) {
      const first = phrases[0];
      out.push(finding('text-agent-directive', {
        tool,
        evidence: { field: f.field, path: f.path, excerpt: excerptAround(f.text, first.index, first.phrase.length), phrases: phrases.map((p) => p.phrase) },
        // A long description carrying a directive is the overflow pattern (arXiv C4).
        detail: { length: f.text.length, longText: f.text.length > BUDGET.description, phraseCount: phrases.length },
      }));
    }

    const hidden = [...f.text.matchAll(HIDDEN)];
    if (hidden.length) {
      const points = [...new Set(hidden.map((m) => codePoint(m[0])))];
      out.push(finding('text-hidden-characters', {
        tool,
        evidence: { field: f.field, path: f.path, excerpt: excerptAround(f.text, hidden[0].index, 1), codePoints: points, count: hidden.length },
        detail: { count: hidden.length, codePoints: points },
      }));
    }

    const mixed = f.text.match(MIXED);
    if (mixed) {
      out.push(finding('text-mixed-scripts', {
        tool,
        evidence: { field: f.field, path: f.path, excerpt: excerptAround(f.text, mixed.index, mixed[0].length), word: mixed[0] },
        detail: { word: mixed[0] },
      }));
    }

    const blob = f.text.match(BASE64) ?? f.text.match(LONG_HEX);
    if (blob) {
      out.push(finding('text-encoded-blob', {
        tool,
        evidence: { field: f.field, path: f.path, excerpt: excerptAround(f.text, blob.index, Math.min(blob[0].length, 60)), length: blob[0].length },
        detail: { length: blob[0].length },
      }));
    }

    const markup = f.text.match(MARKUP);
    if (markup) {
      out.push(finding('text-markup', {
        tool,
        evidence: { field: f.field, path: f.path, excerpt: excerptAround(f.text, markup.index, markup[0].length), token: markup[0] },
        detail: { token: markup[0] },
      }));
    }

    const address = f.text.match(ADDRESS);
    if (address) {
      out.push(finding('text-embedded-address', {
        tool,
        evidence: { field: f.field, path: f.path, excerpt: excerptAround(f.text, address.index, address[0].length), address: address[0] },
        detail: { address: address[0] },
      }));
    }
  }

  // Budgets: facts about length, reported once per tool with every field over its budget.
  const over = [];
  const description = String(tool.description ?? '');
  if (description.length > BUDGET.description) over.push({ path: 'description', length: description.length, budget: BUDGET.description });
  if (String(tool.name ?? '').length > BUDGET.name) over.push({ path: 'name', length: String(tool.name).length, budget: BUDGET.name });
  const schema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : null;
  for (const { path, name, property } of walkProperties(schema)) {
    if (name.length > BUDGET.name) over.push({ path, length: name.length, budget: BUDGET.name });
    const d = property && typeof property === 'object' && typeof property.description === 'string' ? property.description : '';
    if (d.length > BUDGET.parameterDescription) over.push({ path: `${path}.description`, length: d.length, budget: BUDGET.parameterDescription });
  }
  if (over.length) {
    out.push(finding('text-over-budget', {
      tool,
      evidence: { field: 'contract', path: over.map((o) => o.path).join(', '), excerpt: over.map((o) => `${o.path}: ${o.length} > ${o.budget}`).join('; ') },
      detail: { over },
    }));
  }

  return out;
}
