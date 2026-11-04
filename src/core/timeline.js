// A bounded, pausable event log — the Network panel for WebMCP (D-004 rule 8).
// Pure JavaScript: no chrome.* API.
//
// Two things it refuses to do quietly: grow without limit, and lose events without saying
// so. A page that registers and unregisters tools in a loop will overflow the buffer; the
// UI must be able to state how many events were dropped rather than showing a tidy list
// that silently omits history.

export const EVENT_KINDS = [
  'registered',
  'unregistered',
  'activated',
  'cancelled',
  'executed',
  'failed',
];

const DEFAULT_CAPACITY = 500;

export function createTimeline({ capacity = DEFAULT_CAPACITY } = {}) {
  let buffer = [];
  let total = 0;
  let dropped = 0;
  let skippedWhilePaused = 0;
  let paused = false;
  let sequence = 0;

  return {
    push(event) {
      if (!EVENT_KINDS.includes(event.kind)) {
        throw new Error(`unknown timeline event kind: ${event.kind}`);
      }
      if (paused) {
        skippedWhilePaused += 1;
        return null;
      }

      sequence += 1;
      total += 1;
      const stored = { id: `ev_${sequence}`, ...event };
      buffer.push(stored);

      if (buffer.length > capacity) {
        buffer = buffer.slice(buffer.length - capacity);
        dropped += 1;
      }
      return stored;
    },

    list({ kinds = null, toolName = null, limit = Infinity } = {}) {
      const out = [];
      for (let i = buffer.length - 1; i >= 0 && out.length < limit; i -= 1) {
        const event = buffer[i];
        if (kinds && !kinds.includes(event.kind)) continue;
        if (toolName && event.toolName !== toolName) continue;
        out.push(event);
      }
      return out;
    },

    pause() { paused = true; },
    resume() { paused = false; },

    clear() {
      buffer = [];
      total = 0;
      dropped = 0;
      skippedWhilePaused = 0;
      sequence = 0;
    },

    stats() {
      return { total, dropped, skippedWhilePaused, capacity, paused };
    },
  };
}

// Which timeline row a finished call becomes. A call cancelled from Explorer is neither a
// success nor a failure of the tool, and the timeline says so with its own kind.
export function executionKind(call) {
  if (call?.ok) return 'executed';
  if (call?.code === 'cancelled') return 'cancelled';
  return 'failed';
}

// The `toolchange` event only says that the set changed, never what changed. Registrations
// and unregistrations are therefore derived by diffing two snapshots of the tool names.
export function diffToolNames(before, after) {
  const previous = new Set(before ?? []);
  const current = new Set(after ?? []);

  const added = [...current].filter((name) => !previous.has(name)).sort();
  const removed = [...previous].filter((name) => !current.has(name)).sort();

  return { added, removed };
}
