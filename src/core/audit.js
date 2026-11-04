// Tool contract audit: pure, platform-free, fact-based scoring of tool descriptions and
// schemas. This is quality inspection of what a page declares — not security analysis.
// (D-108 supersedes the earlier scope note: scoring declared quality is in-product.)

// ---- Factual findings ----------------------------------------------------

// Each rule returns null (pass) or a finding { rule, tool, points, message }.
// Points are the weight the rule costs the overall score when it fires.

const WORD_RE = /[A-Za-zÀ-ÿ0-9]+(?:['’-][A-Za-z]+)?/g;

function wordCount(text) {
  return (text ?? '').match(WORD_RE)?.length ?? 0;
}

function firstLine(text) {
  const line = (text ?? '').split(/\r?\n/)[0] ?? '';
  return line.trim();
}

function isGenericDescription(text) {
  const t = (text ?? '').toLowerCase().trim();
  if (!t) return true;
  // A description that only repeats the tool name (or a trivial transform of it) says nothing.
  const stripped = t.replace(/[^a-z0-9]/g, '');
  return stripped === '' || /^[a-z0-9]+$/.test(t);
}

function hasActionVerb(description) {
  // Imperative opening verbs a calling model needs to choose between tools.
  const verb = /^\s*(?:please\s+)?((?:re|un)?(?:triev|get|fetch|load|list|search|find|look|add|create|make|update|modify|edit|delete|remove|set|put|send|show|display|open|close|start|stop|run|execute|check|read|write|submit|confirm|cancel|book|order|buy|apply|compare|sort|filter|count|summar|translat|calcul|navigat|click|fill|select|scroll|subscrib|replac|renam|mov|cop)[a-z]*)\b/i;
  return verb.test(description ?? '');
}

function nameParts(name) {
  return (name ?? '').split(/[^a-zA-Z0-9]+/).filter((p) => p.length > 1).map((p) => p.toLowerCase());
}

function wordsInDescriptionOverlap(name, description) {
  const desc = new Set(((description ?? '').toLowerCase().match(WORD_RE) ?? []));
  const parts = nameParts(name);
  if (!parts.length || !desc.size) return 0;
  let hits = 0;
  for (const p of parts) if (desc.has(p)) hits++;
  return Math.round((hits / parts.length) * 100) / 100;
}

function normalizeDescription(text) {
  return (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?:;]+$/, '');
}

function msg(key, fallback, subs, translate) {
  const tr = typeof translate === 'function'
    ? translate
    : (globalThis.__WEBMCP_TRANSLATE__ ?? globalThis.chrome?.i18n?.getMessage);
  if (typeof tr === 'function') {
    const out = tr(key, subs);
    if (out && out !== key) return out;
  }
  return fallback;
}

function findDuplicateDescriptions(tools) {
  const findings = new Map(); // normalized description -> [tools]
  const seen = new Map();
  for (const tool of tools) {
    const key = normalizeDescription(tool.description);
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(tool);
  }
  for (const [key, group] of seen) {
    // Only flag when distinct tool names share an identical description (same-name tools in
    // multiple frames are frame duplicates, not sibling tools competing for a model's choice).
    const distinctNames = new Set(group.map((t) => t.name));
    if (distinctNames.size > 1) findings.set(key, group);
  }
  return findings;
}

// Walk a JSON schema and collect property paths with their metadata.
export function schemaProperties(schema, prefix = '', depth = 0, out = []) {
  if (!schema || typeof schema !== 'object' || depth > 6) return out;
  const props = schema.properties;
  if (props && typeof props === 'object') {
    for (const [key, value] of Object.entries(props)) {
      const path = prefix ? `${prefix}.${key}` : key;
      out.push({ path, schema: value ?? {}, depth });
      if (value && typeof value === 'object') {
        if (value.type === 'array' && value.items) {
          schemaProperties(value.items, `${path}[]`, depth + 1, out);
        } else {
          schemaProperties(value, path, depth + 1, out);
        }
        for (const combiner of ['anyOf', 'oneOf', 'allOf']) {
          if (Array.isArray(value[combiner])) for (const branch of value[combiner]) schemaProperties(branch, path, depth + 1, out);
        }
      }
    }
  }
  return out;
}

// ---- The audit -----------------------------------------------------------

const RULES = [
  {
    id: 'desc-missing',
    points: 10,
    applies(tool) { return !(tool.description ?? '').trim(); },
    message: (_tool, tr) => msg('audit_rule_descMissing', 'No description: a calling model cannot decide when to use this tool.', undefined, tr),
  },
  {
    id: 'desc-generic',
    points: 6,
    applies(tool) { return !!tool.description && isGenericDescription(tool.description) && tool.description.length < 12; },
    message: (_tool, tr) => msg('audit_rule_descGeneric', 'Description only repeats the name and adds no information.', undefined, tr),
  },
  {
    id: 'desc-no-action-verb',
    points: 5,
    applies(tool) { return !!tool.description && !isGenericDescription(tool.description) && !hasActionVerb(firstLine(tool.description)); },
    message: (_tool, tr) => msg('audit_rule_descNoAction', 'First line starts without an action verb — prefer “Search…”, “Add…”, “Get…” so the intent is scannable.', undefined, tr),
  },
  {
    id: 'desc-too-short',
    points: 5,
    applies(tool) { return !!tool.description && wordCount(tool.description) > 0 && wordCount(tool.description) < 4; },
    message: (_tool, tr) => msg('audit_rule_descTooShort', 'Under four words: not enough to separate this tool from its siblings.', undefined, tr),
  },
  {
    id: 'desc-too-long',
    points: 3,
    applies(tool) { return wordCount(tool.description) > 80; },
    message: (_tool, tr) => msg('audit_rule_descTooLong', 'Over 80 words in the description: long prompts crowd every other tool’s context.', undefined, tr),
  },
  {
    id: 'schema-missing',
    points: 6,
    applies(tool) {
      const s = tool.inputSchema;
      return !s || (typeof s === 'object' && s.type !== 'object' && !s.properties);
    },
    message: (_tool, tr) => msg('audit_rule_schemaMissing', 'No object input schema: arguments arrive as guesses.', undefined, tr),
  },
];

function auditOne(tool, duplicateGroups, translate) {
  const findings = [];
  for (const rule of RULES) {
    if (rule.params || !rule.applies(tool)) continue;
    findings.push({ rule: rule.id, tool: tool.name, points: rule.points, message: rule.message(tool, translate) });
  }
  // Schema property rules.
  const props = schemaProperties(tool.inputSchema);
  let missingDesc = 0;
  let untyped = 0;
  for (const p of props) {
    if (!(p.schema?.description ?? '').trim()) missingDesc++;
    if (!p.schema?.type && !p.schema?.anyOf && !p.schema?.oneOf && !p.schema?.allOf && !Array.isArray(p.schema?.enum)) untyped++;
  }
  if (missingDesc) {
    findings.push({
      rule: 'param-missing-desc',
      tool: tool.name,
      points: 4,
      message: msg(
        'audit_rule_paramMissingDesc',
        `${missingDesc} of ${props.length} input properties have no description.`,
        [String(missingDesc), String(props.length)],
        translate,
      ),
      count: missingDesc,
    });
  }
  if (untyped) {
    findings.push({
      rule: 'param-untyped',
      tool: tool.name,
      points: 3,
      message: msg(
        'audit_rule_paramUntyped',
        `${untyped} of ${props.length} input properties have no resolvable type.`,
        [String(untyped), String(props.length)],
        translate,
      ),
      count: untyped,
    });
  }

  // Name/description redundancy.
  const overlap = wordsInDescriptionOverlap(tool.name, tool.description);
  if (overlap === 1 && wordCount(tool.description) <= 6) {
    findings.push({
      rule: 'desc-restates-name',
      tool: tool.name,
      points: 3,
      message: msg('audit_rule_descRestatesName', 'Description is the tool name rephrased with no new facts.', undefined, translate),
    });
  }

  // Duplicate description across tools with distinct names.
  const group = duplicateGroups.get(normalizeDescription(tool.description));
  if (group) {
    const otherNames = new Set(group.filter((t) => t.name !== tool.name).map((t) => t.name));
    if (otherNames.size > 0) {
      findings.push({
        rule: 'desc-duplicate',
        tool: tool.name,
        points: 5,
        message: msg(
          'audit_rule_descDuplicate',
          `Identical description shared with ${otherNames.size} other tool(s): a model must guess between them.`,
          [String(otherNames.size)],
          translate,
        ),
      });
    }
  }

  // Annotations (spec-declared intent) — a declared hint is a plus, absence a small miss.
  const ann = tool.annotations ?? {};
  const hasHint = Object.keys(ann).length > 0;
  return { findings, hasHint };
}

// Score is 0-100 per tool, and overall = weighted by tool count.
export function auditToolset(tools, { translate } = {}) {
  const list = Array.isArray(tools) ? tools : [];
  const duplicateGroups = findDuplicateDescriptions(list);
  const perTool = list.map((tool) => {
    const { findings, hasHint } = auditOne(tool, duplicateGroups, translate);
    const lost = findings.reduce((s, f) => s + f.points, 0);
    const bonus = hasHint ? 2 : 0;
    const score = Math.max(0, Math.min(100, 100 - lost + bonus));
    return {
      tool: tool.name,
      instanceId: tool.instanceId ?? tool.logicalId ?? null,
      score,
      findings,
      annotated: hasHint,
    };
  });
  const overall = perTool.length
    ? Math.round(perTool.reduce((s, t) => s + t.score, 0) / perTool.length)
    : 0;
  const counts = { fail: 0, warn: 0, pass: 0 };
  for (const t of perTool) {
    if (t.score < 50) counts.fail++;
    else if (t.findings.length) counts.warn++;
    else counts.pass++;
  }
  return { overall, counts, perTool };
}
