// Maps WebMCP tool names onto the names a model API will accept, and back again.
//
// A WebMCP tool name is whatever the site wrote. The tool-calling APIs are stricter — OpenAI
// accepts ^[a-zA-Z0-9_-]{1,64}$ — so a name with a dot, a space or an accent is rejected by
// the endpoint before the model ever sees the tool. Silently dropping such a tool would make
// Explorer lie about what the page offers.
//
// Two tools can also share a name across frames — different frames, or two frames of the same
// URL that even share a logicalId (D-056) — and a model can only be handed one of each. Both
// problems are solved the same way: a stable, reversible alias per live instance, computed
// from the tool list as a whole.

const ALLOWED = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX = 64;

function sanitize(name) {
  const cleaned = String(name ?? '')
    .normalize('NFKD')
    // Anything the API will not take becomes an underscore rather than disappearing, so the
    // alias still reads like the original.
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+/, '');
  return cleaned.slice(0, MAX) || 'tool';
}

// Keeps the alias within the length limit while making room for a suffix.
function withSuffix(base, suffix) {
  return `${base.slice(0, MAX - suffix.length)}${suffix}`;
}

// Returns { aliases: Map<instanceId, alias>, byAlias: Map<alias, tool>, renamed: [...] }.
// Deterministic for a given ordered tool list, so the same page always produces the same
// aliases and a saved conversation still resolves. The key is the instance (falling back to
// the logicalId for tools that have none), never the name.
export function aliasKey(tool) {
  return tool.instanceId ?? tool.logicalId;
}

export function aliasTools(tools = []) {
  const aliases = new Map();
  const byAlias = new Map();
  const renamed = [];
  const used = new Set();

  for (const tool of tools) {
    const base = sanitize(tool.name);
    let alias = base;
    let n = 2;
    while (used.has(alias)) {
      alias = withSuffix(base, `_${n}`);
      n += 1;
    }
    used.add(alias);
    aliases.set(aliasKey(tool), alias);
    byAlias.set(alias, tool);
    if (alias !== tool.name) {
      renamed.push({
        name: tool.name,
        alias,
        reason: ALLOWED.test(tool.name) ? 'duplicate-name' : 'illegal-characters',
      });
    }
  }

  return { aliases, byAlias, renamed };
}

export function isAcceptableName(name) {
  return ALLOWED.test(String(name ?? ''));
}
