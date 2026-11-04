// Reading a source location out of a JavaScript stack, without ever inventing one.
//
// The rule set for this feature, and the reason it is worth building at all: Explorer must
// never guess where a tool was registered. Either it has a real frame captured at registration
// time, or it says it does not know and says why. A plausible-looking file and line that turn
// out to be Explorer's own wrapper would be worse than nothing — the developer would go and
// read the wrong file.
//
// Pure JavaScript: no chrome.*, no DOM.

// Anything from the extension itself, or from the engine, describes how the tool was observed
// rather than where it was registered.
const NOT_THE_SITE = [
  /^chrome-extension:\/\//,
  /^extensions::/,
  /^chrome:\/\//,
  /^<anonymous>$/,
  /^native$/,
];

// V8 prints either "at fn (url:line:col)" or "at url:line:col".
const WITH_NAME = /^\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)\s*$/;
const BARE = /^\s*at\s+(.+):(\d+):(\d+)\s*$/;
// "eval at boot (real.js:7:3), <anonymous>:1:1" — the parenthesised group is the location
// that exists on disk, and it is not at the end of the string, so this is not anchored.
const NESTED = /\(([^()]+):(\d+):(\d+)\)/;

function parseLine(line) {
  const named = line.match(WITH_NAME);
  if (named) {
    let [, fn, url, row, column] = named;
    // "at x (eval at y (real.js:1:2))" — the location that matters is the innermost one.
    const inner = url.startsWith('eval at ') ? url.match(NESTED) : null;
    if (inner) [, url, row, column] = inner;
    return { fn, url, line: Number(row), column: Number(column) };
  }
  const bare = line.match(BARE);
  if (bare) {
    const [, url, row, column] = bare;
    return { fn: null, url, line: Number(row), column: Number(column) };
  }
  return null;
}

function isSiteCode(url) {
  return Boolean(url) && !NOT_THE_SITE.some((pattern) => pattern.test(url));
}

// Returns { known: true, ... } only when a frame belonging to the site was found.
// `unknownReason` is a stable code so the interface can phrase it.
export function parseStack(stack, { drop = 0 } = {}) {
  if (typeof stack !== 'string' || !stack.trim()) {
    return { known: false, unknownReason: 'no-stack' };
  }

  const lines = stack.split('\n').filter((line) => /^\s*at\s/.test(line));
  if (!lines.length) return { known: false, unknownReason: 'no-frames' };

  // The first frames are Explorer's own wrapper; the caller says how many to skip, because it
  // is the only thing that knows how deep its own instrumentation goes.
  const candidates = lines.slice(drop).map(parseLine).filter(Boolean);
  const frames = candidates.filter((frame) => isSiteCode(frame.url));

  if (!frames.length) {
    return {
      known: false,
      // Every frame was Explorer's or the engine's, which means the registration did not come
      // from page code that can be pointed at — another extension, or a devtools console.
      unknownReason: candidates.length ? 'no-site-frame' : 'unparsable',
    };
  }

  return {
    known: true,
    file: frames[0].url,
    line: frames[0].line,
    column: frames[0].column,
    function: frames[0].fn,
    // The remaining site frames, so a tool registered inside a helper can still be traced back
    // to the code that called the helper.
    callers: frames.slice(1, 6).map((frame) => ({
      file: frame.url, line: frame.line, column: frame.column, function: frame.fn,
    })),
  };
}

// A short label for the interface: the file's last segment and the line.
export function shortLocation(source) {
  if (!source?.known) return null;
  let name = source.file;
  try {
    const url = new URL(source.file);
    name = url.pathname.split('/').filter(Boolean).pop() || url.host;
  } catch {
    name = source.file.split('/').pop() || source.file;
  }
  return `${name}:${source.line}`;
}

export const UNKNOWN_REASON = {
  'not-instrumented': 'Instrumentation Mode was off when this tool was registered.',
  'no-stack': 'The browser gave no stack for this registration.',
  'no-frames': 'The stack held no frames.',
  'no-site-frame': 'The registration did not come from this page’s own code.',
  unparsable: 'The stack could not be read.',
};
