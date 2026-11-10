// Indicators of prompt injection in the text an agent reads: instructions addressed to the
// agent, characters a person cannot see, look-alike scripts, encoded blobs, markup, addresses
// and texts beyond the budgets agents apply. Each finding quotes the exact excerpt. None of
// them proves an attack: a legitimate description can say "always"; the reviewer decides.
//
// Sources: WebMCP spec §6.3.1.1 (metadata attacks), Chrome secure-tools budgets (description
// 500, parameter description 150, names 30), Chrome best practices (describe the tool, not what
// the model should do), arXiv 2606.06387 (description injection, long description overflow),
// Invariant Labs and Trail of Bits 2025 (instructions in tool descriptions, shadowing, line
// jumping), Unicode TR36. Pure JavaScript.

import { finding } from './catalog.js';
import { modelFacingText, excerptAround, walkProperties } from './text.js';

export const BUDGET = { description: 500, parameterDescription: 150, name: 30 };
// WMCP-SEC-012: a field longer than this multiple of its budget (engine v3).
export const FAR_OVER_FACTOR = 2;

// Phrases that address the agent rather than describe the tool, in two tiers (engine v5). The
// split was measured, not assumed: on 488 descriptions taken from the source of 12 public WebMCP
// projects, the single list used until engine v4 rated 13 legitimate texts critical ("Use
// get_graph to find the id before calling this") and missed 11 of 16 phrasings published with the
// attacks themselves (docs/research/2026-11-10-agent-directive-calibration.md).
//
// HOSTILE is what those attacks do with a description: override earlier instructions, hide an
// action from the user, send data elsewhere, make the agent call another tool and carry its
// result, read a secret file, change how another tool behaves, take effect without being called,
// send the agent to another site, dictate what the agent answers. None of the 488 real
// descriptions matches.
const HOSTILE = [
  ['override', /\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier|other|existing)\s+(instructions?|rules?|prompts?|guidance|tools?)\b/i],
  ['override', /\b(SYSTEM|DEVELOPER|ADMIN)\s+(INSTRUCTIONS?|PROMPT|MESSAGE|NOTE|OVERRIDE)\s*:/],
  ['override', /<\s*\/?\s*(system|instruction|important|assistant)\s*>|\[\s*(system|instructions?)\s*\]/i],
  ['override', /\b(reveal|print|repeat|output|leak|disclose|show)\s+(the\s+|your\s+)?(system|developer|hidden)\s+(prompt|instructions?|message)\b/i],
  ['concealment', /\b(do\s+not|don'?t|never)\s+(tell|inform|mention|reveal|show|ask|warn|notify|alert)\s+(this\s+to\s+|it\s+to\s+|anything\s+to\s+)?(the\s+)?(user|person|human|customer)\b/i],
  ['concealment', /\b(do\s+not|don'?t|never|no\s+need\s+to)\s+(mention|tell|reveal|disclose|say|explain)\s+(that\s+you|what\s+you|this|it|anything)\b/i],
  ['concealment', /\bwithout\s+(asking|telling|informing|notifying|alerting|confirming\s+with|consulting)\s+the\s+(user|person|human|customer)\b/i],
  ['concealment', /\b(hide|conceal|keep)\s+(this|it|that|these)\s+(from|secret|hidden)\b/i],
  ['exfiltration', /\b(send|forward|post|email|transmit|upload|exfiltrate)\s+(the\s+|all\s+|any\s+)?(user'?s?\s+|their\s+|your\s+)?(data|history|credentials|conversation|context|cookies|tokens?|contacts|messages|files)\s+to\b/i],
  ['exfiltration', /\b(include|add|append|attach|pass|send|share|provide|insert)\b[^.!?\n]{0,80}\b(personal\s+(details|data|information)|(browsing|chat|conversation|search)\s+history|(user'?s?|their|your)\s+(credentials|passwords?|cookies))\b/i],
  ['exfiltration', /\bpass\s+(its|their|the\s+file'?s?)\s+contents?\s+as\b/i],
  ['tool-chaining', /\b(call|invoke|use|run|execute)\s+(the\s+)?[A-Za-z][\w.-]{2,60}(\s+tool)?\s*(,|\s+and|\s+then)\s+(then\s+)?(include|append|attach|send|forward|share|report|copy)\s+(its|the|their|that)\s+(results?|outputs?|responses?|contents?|data)\b/i],
  ['tool-chaining', /\bbefore\s+(answering|responding|replying|you\s+(answer|respond|reply)|returning\s+(an?\s+|the\s+)?(answer|response))\b[^.!?\n]{0,80}\b(call|invoke|use|run|execute|read|fetch|send|include)\b/i],
  ['secret-file', /\b(read|open|load|cat|access|fetch)\s+(the\s+(file|contents?\s+of)\s+)?[`'"]?[~.]?\/?[\w.\/-]*(\.ssh\b|id_rsa|\.env\b|mcp\.json|\.aws\b|\.npmrc|\.git-credentials|\/etc\/passwd|credentials\.json)/i],
  ['shadowing', /\bthe\s+[A-Za-z][\w.-]{2,60}\s+tool\s+(must|should|needs?\s+to|has\s+to|shall)\s+(always\s+|now\s+|instead\s+)?(send|use|forward|include|redirect|route|copy|bcc|cc|add|call|post|write|set)\b/i],
  ['no-invocation', /\beven\s+(without|if\s+you\s+(do\s+not|don'?t|never))\s+(calling|call|using|use|invoking|invoke)\s+(this|the)\s+tool\b/i],
  ['cross-site', /\b(navigate|go|browse|redirect)\s+to\s+(https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,24}\b/i],
  ['answer-steering', /\b(in|to|with)\s+(every|each|all)\s+(of\s+)?(your\s+)?(answers?|responses?|replies|messages?)\b|\b(in|to|with)\s+your\s+(final\s+)?(answers?|responses?|repl(?:y|ies)|messages?)\b/i],
  ['answer-steering', /\ball\s+(commands?|answers?|responses?|replies|messages?|emails?)\s+must\s+(include|contain|start\s+with|begin\s+with|end\s+with|be\s+sent)\b/i],
];

// GUIDANCE tells the agent when or in what order to call tools, or that it must. Real descriptions
// do it (11 of the 488), Chrome's guidance prefers language that "describes the actions the tool
// can take" to "telling the model what to do", and it is how a tool claims priority over its
// neighbours: reported, at low severity.
const GUIDANCE = [
  ['ordering', /\b(always|never|before|after|first)\s+(call|calling|use|using|invoke|invoking|run|running|execute|executing|consult|consulting)\b/i],
  ['ordering', /\b(call|invoke|use|run|execute|consult)\s+(this|the|that)\s+tool\s+(first|before|after|instead|again|immediately)\b/i],
  ['obligation', /\b(you|the\s+(agent|assistant|model|ai))\s+(must|should|are\s+required\s+to|have\s+to|need\s+to\s+(call|use|invoke|run|execute|consult|include|provide|pass|send))\b/i],
  ['emphasis', /\b(IMPORTANT|CRITICAL|WARNING|ATTENTION)\s*[:!]/],
  ['ordering', /\b(as|at)\s+the\s+(very\s+)?first\s+step\b|\b(must|should)\s+be\s+(called|used|invoked|run)\s+(first|before|immediately)\b/i],
];

// In a tool's output, where nothing should address the agent at all, a bare mention of a system
// prompt is worth reading as well. In a description it is often the name of a parameter.
const OUTPUT_ONLY = [/\b(system|developer|assistant|hidden)\s+(prompt|instructions?|message|note)\b/i];

// "Never request credentials" protects: an exfiltration verb under a negation is not an order.
const NEGATED = /\b(never|not|don'?t|no)\s+(\w+\s+){0,2}$/i;

// Every phrase of a text that addresses the agent, hostile ones first, each with where it starts.
export function agentDirectives(text) {
  const value = String(text ?? '');
  const hostile = [];
  const guidance = [];
  for (const [family, re] of HOSTILE) {
    const m = value.match(re);
    if (!m) continue;
    if (family === 'exfiltration' && NEGATED.test(value.slice(Math.max(0, m.index - 24), m.index))) continue;
    hostile.push({ family, phrase: m[0], index: m.index });
  }
  for (const [kind, re] of GUIDANCE) {
    const m = value.match(re);
    if (m) guidance.push({ kind, phrase: m[0], index: m.index });
  }
  const byPosition = (a, b) => a.index - b.index;
  return { hostile: hostile.sort(byPosition), guidance: guidance.sort(byPosition) };
}

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
  const found = agentDirectives(value);
  const directives = [...found.hostile, ...found.guidance].map((d) => d.phrase);
  for (const re of OUTPUT_ONLY) {
    const m = value.match(re);
    if (m && !directives.some((phrase) => phrase.includes(m[0]))) directives.push(m[0]);
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
    // Directives: one finding per field, naming every matched phrase. A field that carries a
    // hostile phrase is reported once, as that, with its guidance phrases listed next to it.
    const { hostile, guidance } = agentDirectives(f.text);
    const phrases = [...hostile, ...guidance];
    if (phrases.length) {
      const first = phrases[0];
      out.push(finding(hostile.length ? 'text-agent-directive' : 'text-usage-instruction', {
        tool,
        evidence: { field: f.field, path: f.path, excerpt: excerptAround(f.text, first.index, first.phrase.length), phrases: phrases.map((p) => p.phrase) },
        // A long description carrying a directive is the overflow pattern (arXiv C4).
        detail: { length: f.text.length, longText: f.text.length > BUDGET.description, phraseCount: phrases.length,
          ...(hostile.length ? { families: [...new Set(hostile.map((h) => h.family))] } : { kinds: [...new Set(guidance.map((g) => g.kind))] }) },
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
  const fieldsOver = [];
  const description = String(tool.description ?? '');
  if (description.length > BUDGET.description) fieldsOver.push({ path: 'description', length: description.length, budget: BUDGET.description, text: description });
  if (String(tool.name ?? '').length > BUDGET.name) fieldsOver.push({ path: 'name', length: String(tool.name).length, budget: BUDGET.name, text: String(tool.name) });
  const schema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : null;
  for (const { path, name, property } of walkProperties(schema)) {
    if (name.length > BUDGET.name) fieldsOver.push({ path, length: name.length, budget: BUDGET.name, text: name });
    const d = property && typeof property === 'object' && typeof property.description === 'string' ? property.description : '';
    if (d.length > BUDGET.parameterDescription) fieldsOver.push({ path: `${path}.description`, length: d.length, budget: BUDGET.parameterDescription, text: d });
  }
  const over = fieldsOver.map(({ text, ...rest }) => rest);
  if (over.length) {
    out.push(finding('text-over-budget', {
      tool,
      evidence: { field: 'contract', path: over.map((o) => o.path).join(', '), excerpt: over.map((o) => `${o.path}: ${o.length} > ${o.budget}`).join('; ') },
      detail: { over },
    }));
  }

  // More than twice a budget leaves room to bury an instruction (arXiv 2606.06387, long-description
  // overflow). Invisible characters or an encoded blob in the same field read as concealment.
  const far = fieldsOver.filter((o) => o.length > o.budget * FAR_OVER_FACTOR);
  if (far.length) {
    const concealment = far.filter((o) => new RegExp(HIDDEN.source).test(o.text) || BASE64.test(o.text) || LONG_HEX.test(o.text)).map((o) => o.path);
    out.push(finding('text-far-over-budget', {
      tool,
      severity: concealment.length ? 'high' : 'medium',
      evidence: { field: 'contract', path: far.map((o) => o.path).join(', '), excerpt: far.map((o) => `${o.path}: ${o.length} > ${FAR_OVER_FACTOR} × ${o.budget}`).join('; ') },
      detail: { fields: far.map(({ text, ...rest }) => rest), factor: FAR_OVER_FACTOR, concealment },
    }));
  }

  return out;
}
