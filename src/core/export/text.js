// The small text helpers every export shares: dates, file names, Markdown fences and cells.
// Pure JavaScript: no chrome.*, no DOM.

export const ISO = (ms) => new Date(ms).toISOString();

export function slug(text, fallback = 'report') {
  const cleaned = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || fallback;
}

export function stamp(ms) {
  return ISO(ms).replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

// A fenced block that survives whatever the page put inside it: a payload containing ``` would
// otherwise break out of the fence and mangle the rest of the document.
export function fence(body, lang = '') {
  const text = String(body ?? '');
  const longest = (text.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${text}\n${ticks}`;
}

// Markdown table cells cannot contain a raw pipe or newline.
export function cell(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}
