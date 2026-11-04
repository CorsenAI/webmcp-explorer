// What the page tells agents about a tool's side effects, and whether the name and description
// agree with it. Annotations are advisory (spec §6.3.2: "no guarantee that a declared intent
// matches actual behavior"); an agent decides whether to confirm from them (Chrome agent
// security: assume state change unless readOnlyHint). So a consequential verb without
// consequentialHint, or readOnlyHint on a verb that mutates, is worth a person's look.
// Indicators, never proof. Pure JavaScript.

import { finding } from './catalog.js';
import { nameWords, firstSentence } from './text.js';

// Tier A: money, communication, identity, irreversibility (the spec's own examples are booking
// a flight and transferring money). Tier B: ordinary state changes a person can usually undo.
export const CONSEQUENTIAL = new Set(['pay', 'purchase', 'buy', 'checkout', 'order', 'book', 'reserve', 'transfer',
  'refund', 'delete', 'remove', 'erase', 'purge', 'drop', 'destroy', 'cancel', 'send', 'email', 'post', 'publish', 'submit',
  'sign', 'subscribe', 'unsubscribe', 'grant', 'revoke', 'approve', 'reject', 'wire', 'withdraw', 'deposit', 'donate',
  'invite', 'ban', 'unlock', 'authorize', 'authorise', 'charge']);
export const MUTATING = new Set(['add', 'create', 'update', 'change', 'modify', 'edit', 'set', 'reset', 'upload', 'share',
  'register', 'save', 'move', 'rename', 'toggle', 'apply', 'clear', 'assign', 'enable', 'disable', 'write', 'put',
  'insert', 'append', 'mark', 'archive', 'restore', 'schedule', 'start', 'stop', 'launch', 'install', 'connect']);
export const READ = new Set(['get', 'read', 'fetch', 'list', 'show', 'export', 'retrieve', 'view', 'lookup', 'look', 'find',
  'search', 'check', 'describe', 'count', 'query', 'browse', 'load', 'download']);

const SENSITIVE_READ = /\b(address|balance|account|api[_ ]?key|token|password|secret|credential|medical|health|diagnos|prescription|ssn|social security|national id|passport|card|payment method|phone|e-?mail|invoice|order history|salary|tax)\w*/i;
const UGC = /\b(review|comment|post|thread|message|chat|forum|feedback|testimonial|user[- ]generated|user content|markdown|page content|page text|fetch|scrape|read_page|get_page|crawl|html|article body|transcript)\w*/i;

export function verbsOf(tool) {
  // The action is the first word of a verb_noun name ("lookup_order" looks up; "order" is its
  // object) and the opening words of the description ("Pay the open invoice…"). Reading the
  // whole text would turn every noun that is also a verb into a false alarm.
  const words = new Set();
  const [nameVerb] = nameWords(tool.name);
  if (nameVerb) words.add(nameVerb);
  const opening = firstSentence(tool.description, 120).toLowerCase().split(/[^a-z]+/).filter(Boolean).slice(0, 3);
  for (const w of opening) words.add(w);
  return words;
}

const pick = (words, set) => [...words].filter((w) => set.has(w));

export function reviewGovernance(tool) {
  const out = [];
  const annotations = tool.annotations && typeof tool.annotations === 'object' ? tool.annotations : {};
  const readOnly = annotations.readOnlyHint === true;
  const consequential = annotations.consequentialHint === true;
  const untrusted = annotations.untrustedContentHint === true;
  const words = verbsOf(tool);
  // When the name says it reads ("get_orders"), a description opening with a noun that is also
  // a verb ("Order history…") is not a consequential action.
  const [nameVerb] = nameWords(tool.name);
  const nameReads = READ.has(nameVerb);
  const tierA = nameReads ? [] : pick(words, CONSEQUENTIAL);
  const tierB = nameReads ? [] : pick(words, MUTATING);
  const reads = pick(words, READ);
  const haystack = `${tool.name ?? ''} ${tool.title ?? ''} ${tool.description ?? ''}`;

  if (tierA.length && !consequential && !readOnly) {
    out.push(finding('consequential-without-hint', { tool,
      evidence: { field: 'annotations', path: 'annotations.consequentialHint', excerpt: firstSentence(tool.description), verbs: tierA },
      detail: { verbs: tierA, declared: annotations } }));
  } else if (tierB.length && !tierA.length && !consequential && !readOnly) {
    out.push(finding('state-change-without-hint', { tool,
      evidence: { field: 'annotations', path: 'annotations', excerpt: firstSentence(tool.description), verbs: tierB },
      detail: { verbs: tierB, declared: annotations } }));
  }

  if (readOnly && (tierA.length || tierB.length)) {
    const verbs = [...tierA, ...tierB];
    out.push(finding('readonly-claim-on-mutating-verb', { tool,
      evidence: { field: 'annotations', path: 'annotations.readOnlyHint', excerpt: firstSentence(tool.description), verbs },
      detail: { verbs, declared: annotations } }));
  }

  const ugc = haystack.match(UGC);
  if (ugc && !untrusted) {
    out.push(finding('ugc-without-untrusted-hint', { tool,
      evidence: { field: 'annotations', path: 'annotations.untrustedContentHint', excerpt: firstSentence(tool.description), term: ugc[0] },
      detail: { term: ugc[0], declared: annotations } }));
  }

  if (annotations.debugging === true) {
    out.push(finding('debugging-tool-exposed', { tool,
      evidence: { field: 'annotations', path: 'annotations.debugging', excerpt: 'debugging: true' },
      detail: { declared: annotations } }));
  }

  const sensitive = haystack.match(SENSITIVE_READ);
  if (reads.length && sensitive && !consequential) {
    out.push(finding('high-risk-read-without-hint', { tool,
      evidence: { field: 'annotations', path: 'annotations.consequentialHint', excerpt: firstSentence(tool.description), term: sensitive[0], verbs: reads },
      detail: { term: sensitive[0], verbs: reads, declared: annotations } }));
  }

  return out;
}
