// Encoders for copy-only snippets. A page string enters JavaScript only as a JSON string literal and
// HTML only as an escaped attribute value or text; comments are always fixed text. Invisible and
// direction-changing characters become visible escapes. Pure JavaScript.

// Format and direction characters (every \p{Cf}, U+034F, U+2028, U+2029), escaped per UTF-16 unit
// so supplementary ones such as U+E0001 become a visible surrogate pair.
export const FORMAT = /[\u034f\u2028\u2029\p{Cf}]/gu;
export const escapeFormat = (text) => String(text).replace(FORMAT, (ch) => ch.split('').map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''));

// A JSON literal safe inside a <script> element and readable in review (quick-fix template).
export const jsonLiteral = (value) => escapeFormat(JSON.stringify(value, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'));

// An attribute value or text node: markup characters, quotes, controls and format characters become
// numeric character references.
export const htmlText = (value) => String(value ?? '').replace(/[&<>"'`\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/gu,
  (ch) => `&#x${ch.codePointAt(0).toString(16)};`);
