// One call's outcome: the facts banner, then the error or the result — and a bounded result.
//
// A tool may answer with hundreds of thousands of characters. Putting all of it in the panel
// at once freezes the side panel for seconds, and the reader gains nothing from the 200 000th
// character they did not ask for. The first characters are shown, the real length is stated,
// and the whole text is one click away — a deliberate, announced cut, never a silent one (C7).
// The history keeps up to LIMITS.maxResultChars of it and says when it cut (storage/db.js).

import { el, t } from '../dom.js';
import { readableValue } from '../components/readable-value.js';
import { parseDisplayJson } from '../../core/json-display.js';

// Enough to read any JSON answer a person would scroll; small enough to render at once.
export const RESULT_DISPLAY_CAP = 20_000;

export function renderResult(root, { result: r, tool }) {
  const ok = r.ok === true;

  const facts = [];
  if (typeof r.durationMs === 'number') facts.push(t('toolDetails_msInPage', [String(r.durationMs)]));
  facts.push(t('toolDetails_msRoundTrip', [String(r.roundTripMs)]));
  if (ok && r.result) facts.push(t('toolDetails_chars', [String(r.result.length)]));
  // A replay may have run in the frame the call was recorded in, not the one this screen was
  // opened on; the result says so rather than letting the reader assume.
  if (Number.isInteger(r.frameId) && r.frameId !== tool.frameId) facts.push(t('toolDetails_ranInFrame', [String(r.frameId)]));

  root.append(el('div', {
    class: ok ? 'result-banner result-ok' : 'result-banner result-error',
    text: (ok ? '✓ ' : '✕ ') + facts.join(' · '),
  }));

  if (r.engine) root.append(el('p',{class:'field-desc',text:t('execution_trace',[r.engine,r.argsEncoding ?? '—',String(r.attempts ?? 0)])}));
  if (r.effectState === 'unknown') root.append(el('p',{class:'field-note',text:t('execution_unknown')}));

  if (!ok) {
    // A cancellation is the user's own act, worded as such rather than as a tool failure.
    root.append(el('p', {
      class: 'field-note',
      text: r.code === 'cancelled' ? t('toolDetails_cancelled') : (r.error ?? t('toolDetails_theToolFailed')),
    }));
    // Measured on Chrome 153 (WMP-0044): whatever the tool threw, the caller gets this one
    // sentence. Said here, so the developer looks for their own message in the page's console
    // rather than in Explorer.
    if (isGenericToolError(r.error)) root.append(el('p', { class: 'field-desc', text: t('toolDetails_genericError') }));
    if (r.code) root.append(el('p', { class: 'card-origin', text: t('toolDetails_code1', [String(r.code)]) }));
    return;
  }

  if (r.navigated) {
    root.append(el('p', { class: 'field-note', text: t('toolDetails_theToolReturnedNoValue') }));
    return;
  }

  const text = typeof r.result === 'string' ? r.result : String(r.result ?? '');
  const large = text.length > RESULT_DISPLAY_CAP;
  // Only a bounded payload is parsed. The original text remains available byte-for-byte;
  // parsing and re-stringifying would silently round large numbers.
  const parsed = large ? null : parseDisplayJson(text);
  root.append(el('div', { class: 'result-head' }, [
    el('span', { text: t('toolDetails_result') }),
    el('span', { class: 'muted mono', text: parsed ? t('toolDetails_stringParsedAsJson') : t('toolDetails_string') }),
  ]));

  const body = el('pre', { class: 'result-body mono', text: large ? text.slice(0, RESULT_DISPLAY_CAP) : text });
  if (parsed) {
    const readable = el('div', { class: 'result-readable' }, [readableValue(parsed)]);
    const raw = el('details', { class: 'result-raw tree-raw' }, [
      el('summary', { text: t('readable_rawJson'), title: t('readable_rawJsonHelp') }), body,
    ]);
    root.append(readable, raw);
  } else {
    root.append(body);
  }

  if (large) {
    const note = el('p', {
      class: 'field-note',
      text: t('toolResult_shownPartial', [String(RESULT_DISPLAY_CAP), String(text.length)]),
    });
    const showAll = el('button', {
      text: t('toolResult_showAll', [String(text.length)]),
      title: t('toolResult_showAllHelp'),
    });
    showAll.addEventListener('click', () => {
      body.textContent = text;
      note.textContent = t('toolResult_shownWhole', [String(text.length)]);
      showAll.remove();
    });
    root.append(note, el('div', { class: 'row-inline' }, [showAll]));
  }

  // Measured on Chrome 152 (e2e/inflight.mjs, C4): a tool whose execute resolves null is
  // handed back as the string "null", indistinguishable from a tool returning that text. The
  // result is shown as received, and the ambiguity is named rather than resolved by a guess.
  if (text === 'null') {
    root.append(el('p', { class: 'field-note', text: t('toolDetails_theToolReturnedNull') }));
  }
  // A runtime that took the arguments as an object rather than a string followed the newer
  // specification; worth knowing when a call behaves differently from another browser.
  if (r.argsEncoding === 'object') {
    root.append(el('p', { class: 'field-desc', text: t('toolDetails_argsSentAsObject') }));
  }
}

// The fixed sentence Chrome 153 substitutes for a tool's own error (WMP-0044).
export function isGenericToolError(text) {
  return typeof text === 'string' && text.startsWith('Tool was executed but the invocation failed');
}
