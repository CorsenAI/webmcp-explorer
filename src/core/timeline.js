// A bounded, pausable event log — the Network panel for WebMCP (D-004 rule 8).
// Pure JavaScript: no chrome.* API.
//
// Two things it refuses to do quietly: grow without limit, and lose events without saying
// so. A page that registers and unregisters tools in a loop will overflow the buffer; the
// UI must be able to state how many events were dropped rather than showing a tidy list
// that silently omits history.

import { CONTRACT_PARTS } from './security/contract-lock.js';

export const EVENT_KINDS = [
  'registered',
  'unregistered',
  // A listed tool whose contract was replaced under its own name, with no removal in between.
  'changed',
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

// One tool's contract as the page watcher fingerprints it: three SHA-256 values in the order of
// CONTRACT_PARTS (description, input schema, annotations), joined by dots.
const TOOL_DIGEST = /^[0-9a-f]{64}\.[0-9a-f]{64}\.[0-9a-f]{64}$/;
export const isToolDigest = (value) => typeof value === 'string' && TOOL_DIGEST.test(value);

// The parts that differ between two fingerprints of one tool name: an empty list when the
// contract is the same, null when either side is unknown. An unknown comparison is never
// reported as "unchanged".
export function changedParts(before, after) {
  if (!isToolDigest(before) || !isToolDigest(after)) return null;
  const a = before.split('.');
  const b = after.split('.');
  return CONTRACT_PARTS.filter((_, index) => a[index] !== b[index]);
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
