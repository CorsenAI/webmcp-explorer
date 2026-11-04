// Saved calls: a named set of arguments for a tool, kept so it can be run again later — after a
// reload, after a deploy, on another day. Pure JavaScript: no chrome.* API.
//
// The point is not the saving, it is the review. A saved call records the contract it was
// written against; when the tool's schema moves, the call is re-checked against the new one and
// flagged `needs-review` rather than run blindly or dropped (ARCHITECTURE section 2). Nothing is
// deleted on the user's behalf: a call that no longer validates is still theirs to fix.

import { validateArguments } from './schema/validate.js';
import { canonicalJson } from './json-compare.js';
import { validateFieldExpectation, judgeFieldExpectation } from './field-checks.js';

// Twenty per tool is more than anyone maintains by hand and still small: a saved call is a few
// arguments, not a transcript. The oldest goes rather than the save being refused.
export const SAVED_CALLS_PER_TOOL = 20;

export const REVIEW = {
  ok: 'ok',
  needsReview: 'needs-review',
  toolGone: 'tool-gone',
};

// What a saved call may expect of its result, which turns it into a check: the call must
// succeed (`ok`), must fail (`error`), must return exactly this text (`equals`), or must return
// JSON equivalent to this text (`json-equals` — key order and whitespace are not a difference).
// A saved call without an expectation is only a bookmark, and running it judges nothing.
export const EXPECT = {
  ok: 'ok',
  error: 'error',
  equals: 'equals',
  jsonEquals: 'json-equals',
  fields: 'fields',
};

export const VERDICT = {
  pass: 'pass',
  fail: 'fail',
  notAcheck: 'not-a-check',
};

function copy(value) {
  return value === undefined ? {} : JSON.parse(JSON.stringify(value));
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createSavedCall({ tool, name, args, at = Date.now(), id, expect = null, topOrigin = null }) {
  const label = String(name ?? '').trim();
  return {
    id: id ?? newId(),
    name: label || defaultName(args),
    logicalId: tool.logicalId,
    toolName: tool.name,
    origin: tool.origin ?? null,
    // A cross-origin frame may disappear later. Retain the embedding origin separately
    // from the tool origin so its check remains visible on the original site.
    topOrigin,
    // The contract the arguments were written for. When it changes, the call is reviewed.
    contractFp: tool.contractFp ?? null,
    args: copy(args),
    savedAt: at,
    // Optional: { kind: EXPECT.*, value?: string } — what makes the call a check.
    expect: normalizeExpect(expect),
  };
}

// Logical identity already scopes a live tool to its top origin. For missing tools use
// their recorded embedding origin; old calls without this field keep the same-origin fallback.
export function savedChecksForPage(savedCalls, tools, topOrigin) {
  const ids = new Set(tools.map((tool) => tool.logicalId));
  return savedCalls.filter((saved) => saved.expect && (ids.has(saved.logicalId)
    || (topOrigin && (saved.topOrigin ? saved.topOrigin === topOrigin : saved.origin === topOrigin))));
}

export function normalizeExpect(expect) {
  if (!expect || typeof expect !== 'object') return null;
  const kind = Object.values(EXPECT).includes(expect.kind) ? expect.kind : null;
  if (!kind) return null;
  // Preserve invalid/future definitions for review; never silently turn them into a
  // successful-result check or drop their rules. Storage refuses newly invalid definitions.
  if (kind === EXPECT.fields) return { kind, ...copy({ version: expect.version, rules: expect.rules }) };
  if (kind === EXPECT.equals || kind === EXPECT.jsonEquals) {
    return { kind, value: typeof expect.value === 'string' ? expect.value : '' };
  }
  return { kind };
}

// An expectation drawn from a result the user has in front of them: a successful call becomes
// a check on its text (JSON when it parses as JSON, so a reordered key is not a failure); a
// failed call becomes a check that it still fails.
export function expectationFromOutcome(outcome) {
  if (!outcome) return null;
  if (outcome.ok !== true) return { kind: EXPECT.error };
  const text = typeof outcome.result === 'string' ? outcome.result : '';
  return { kind: canonicalJson(text) !== null ? EXPECT.jsonEquals : EXPECT.equals, value: text };
}

const EXCERPT = 120;
const excerpt = (text) => {
  const t = String(text ?? '');
  return t.length > EXCERPT ? `${t.slice(0, EXCERPT - 1)}…` : t;
};

// Judges one outcome against the saved call's expectation. A cancelled call is not a verdict
// on the page: it is reported as neither pass nor fail. The reason is written for a person.
export function judgeSavedCall(saved, outcome) {
  const expect = normalizeExpect(saved?.expect);
  if (!expect) return { verdict: VERDICT.notAcheck, reason: 'This saved call has no expectation; running it judges nothing.' };
  if (!outcome) return { verdict: VERDICT.fail, reason: 'The call produced no outcome.' };
  if (outcome.code === 'cancelled' || outcome.cancelled === true) {
    return { verdict: VERDICT.notAcheck, reason: 'The call was cancelled before it settled; nothing was judged.' };
  }
  const ok = outcome.ok === true;
  const text = typeof outcome.result === 'string' ? outcome.result : '';
  switch (expect.kind) {
    case EXPECT.fields:
      return judgeFieldExpectation(expect, outcome);
    case EXPECT.ok:
      return ok
        ? { verdict: VERDICT.pass, reason: 'The call succeeded, as expected.' }
        : { verdict: VERDICT.fail, reason: `Expected the call to succeed; it failed: ${excerpt(outcome.error ?? outcome.code ?? 'unknown error')}` };
    case EXPECT.error:
      return ok
        ? { verdict: VERDICT.fail, reason: `Expected the call to fail; it succeeded with ${text.length} characters.` }
        : { verdict: VERDICT.pass, reason: `The call failed, as expected: ${excerpt(outcome.error ?? outcome.code ?? '')}` };
    case EXPECT.equals:
      if (!ok) return { verdict: VERDICT.fail, reason: `Expected a result; the call failed: ${excerpt(outcome.error ?? outcome.code ?? '')}` };
      return text === expect.value
        ? { verdict: VERDICT.pass, reason: 'The result is exactly the expected text.' }
        : { verdict: VERDICT.fail, reason: `The result differs from the expected text (${text.length} vs ${expect.value.length} characters): ${firstDifference(expect.value, text)}` };
    case EXPECT.jsonEquals: {
      if (!ok) return { verdict: VERDICT.fail, reason: `Expected a JSON result; the call failed: ${excerpt(outcome.error ?? outcome.code ?? '')}` };
      const want = canonicalJson(expect.value);
      const got = canonicalJson(text);
      if (got === null) return { verdict: VERDICT.fail, reason: `The result is not JSON any more: ${excerpt(text)}` };
      return want === got
        ? { verdict: VERDICT.pass, reason: 'The result is the expected JSON (key order and whitespace aside).' }
        : { verdict: VERDICT.fail, reason: `The JSON differs from what was expected: ${firstDifference(want, got)}` };
    }
    default:
      return { verdict: VERDICT.notAcheck, reason: 'Unknown expectation.' };
  }
}

// Where two texts part ways, shown around the first differing character.
function firstDifference(want, got) {
  let i = 0;
  while (i < want.length && i < got.length && want[i] === got[i]) i += 1;
  const from = Math.max(0, i - 20);
  return `at character ${i}, expected “${excerpt(want.slice(from, i + 40))}” but got “${excerpt(got.slice(from, i + 40))}”`;
}

// A name the user did not have to type: the arguments themselves, shortened.
export function defaultName(args) {
  const text = JSON.stringify(args ?? {});
  if (text === '{}') return 'no arguments';
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
}

// Newest first, capped per tool. Saving the same name again replaces the earlier call rather
// than piling up copies of it.
export function addSavedCall(list, saved, { limit = SAVED_CALLS_PER_TOOL } = {}) {
  const kept = (list ?? []).filter((entry) => entry.name !== saved.name && entry.id !== saved.id);
  return [saved, ...kept].slice(0, limit);
}

// Judges a saved call against the tool as it is now. Three answers, never a guess:
//  - ok: the arguments still validate against the current schema;
//  - needs-review: they do not (a field became required, a type changed, an enum shrank), or
//    the contract moved and the arguments only pass because the validator cannot check it;
//  - tool-gone: no live instance of the tool exists on the page.
export function reviewSavedCall(saved, tool) {
  if (!tool) {
    return { status: REVIEW.toolGone, contractChanged: false, problems: [] };
  }
  const contractChanged = Boolean(saved.contractFp && tool.contractFp
    && saved.contractFp !== tool.contractFp);
  if (saved.expect?.kind === EXPECT.fields) {
    const problem = validateFieldExpectation(saved.expect);
    if (problem) return { status: REVIEW.needsReview, contractChanged, problems: [problem] };
  }
  const check = validateArguments(tool.inputSchema, saved.args);
  const problems = check.errors.map((error) => error.message);
  if (!check.valid) {
    return { status: REVIEW.needsReview, contractChanged, problems };
  }
  // The contract moved, and the validator could not vouch for part of the schema: the call
  // may or may not still mean what it meant. Said, not assumed.
  if (contractChanged && check.unchecked.length > 0) {
    return {
      status: REVIEW.needsReview,
      contractChanged,
      problems: ['The tool contract changed since this call was saved, and part of the new schema cannot be checked automatically.'],
    };
  }
  return { status: REVIEW.ok, contractChanged, problems };
}
