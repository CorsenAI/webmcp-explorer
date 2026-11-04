// Chrome 152 can retain a withheld optional origin in its desired-active preferences.
// Removing a later broad grant alone then lets that origin return on browser restart.
// Retain observed optional origins so a broad revoke can name dormant entries too.
// This never grants access and is never consulted to decide whether a site is allowed.
// Chrome's permissions API remains the only authority (D-014).

const KEY = 'knownOptionalOrigins';
const HTTP_ALL = 'http://*/*';
const HTTPS_ALL = 'https://*/*';

function sitePattern(pattern) {
  return typeof pattern === 'string' && /^(https?|\*):\/\/[^/]+\/\*$/.test(pattern)
    && ![HTTP_ALL, HTTPS_ALL, '*://*/*'].includes(pattern);
}

function coveredBy(patterns, origin) {
  if (patterns.includes(origin)) return true;
  if (origin.startsWith('http://')) return patterns.includes(HTTP_ALL);
  if (origin.startsWith('https://')) return patterns.includes(HTTPS_ALL);
  // Do not expand a removal of HTTP alone into a removal of HTTPS too.
  return origin.startsWith('*://') && patterns.includes(HTTP_ALL) && patterns.includes(HTTPS_ALL);
}

export function createPermissionRevocations({ permissions, storage }) {
  let tail = Promise.resolve();
  let removing = [];
  const serial = (work) => {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  };
  const read = async () => {
    const stored = (await storage.get(KEY))?.[KEY];
    return Array.isArray(stored) ? [...new Set(stored.filter(sitePattern))] : [];
  };
  const save = (patterns) => patterns.length
    ? storage.set({ [KEY]: patterns }) : storage.remove(KEY);

  return {
    remember(origins = []) {
      // Observe both grants and removals: a broad native revoke need not name every
      // dormant site separately. Capture this before queuing: our own remove clears the desired
      // patterns. An unrelated Chrome revocation must still be remembered.
      const pending = origins.filter(sitePattern).filter((p) => !coveredBy(removing, p));
      if (!pending.length) return Promise.resolve();
      return serial(async () => save([...new Set([...await read(), ...pending])]));
    },

    remove(origins) {
      if (!Array.isArray(origins) || origins.some((p) => typeof p !== 'string')) {
        return Promise.reject(new Error('Expected a list of origin patterns.'));
      }
      return serial(async () => {
        const active = (await permissions.getAll()).origins ?? [];
        const pending = [...new Set([...await read(), ...active.filter(sitePattern)])];
        // Only complete a remembered removal when Chrome currently covers it. Calling
        // remove on an already-withheld origin does not update Chrome's desired set.
        const completed = pending.filter((p) => coveredBy(origins, p) && coveredBy(active, p));
        const targets = [...new Set([...origins, ...completed])];
        removing = targets;
        try {
          const removed = await permissions.remove({ origins: targets });
          if (!removed) return { removed: false };
          await save(pending.filter((p) => !completed.includes(p)));
          return { removed: true };
        } finally {
          removing = [];
        }
      });
    },
  };
}
