import { finding } from './catalog.js';
import { CONSEQUENTIAL, MUTATING, READ, verbsOf } from './annotations-governance.js';
import { nameWords, modelFacingText, excerptAround } from './text.js';
import { walkSchema, isStringSchema, hasStringConstraint } from './schema-walk.js';

export function mutationVerbs(tool) {
  if (READ.has(nameWords(tool.name)[0])) return [];
  return [...verbsOf(tool)].filter(w => CONSEQUENTIAL.has(w) || MUTATING.has(w));
}

export function reviewPhaseB(tools, { prior = [], originScan = null } = {}) {
  const out = [], notObservable = [];
  const unknown = (code, detail) => notObservable.push({ code, reason: 'not-verified', detail });
  for (const tool of tools) {
    const verbs = mutationVerbs(tool);
    const own = prior.filter(f => f.instanceId === (tool.instanceId ?? null) && f.toolName === tool.name);
    const a = tool.annotations ?? {};
    const evidence = (path, excerpt) => ({ field: 'contract', path, excerpt });
    if (verbs.length && (a.readOnlyHint !== false || a.consequentialHint !== true)
      && !own.some(f => ['consequential-without-hint', 'state-change-without-hint', 'readonly-claim-on-mutating-verb'].includes(f.code))) {
      out.push(finding('mutation-hints-incomplete', { tool,
        evidence: evidence('annotations', `readOnlyHint: ${a.readOnlyHint ?? 'absent'}; consequentialHint: ${a.consequentialHint ?? 'absent'}`), detail: { verbs } }));
    }
    // DOM metadata cannot reveal session authentication, server authorization, CSRF checks,
    // or a submit handler's human confirmation. Never inspect credentials to infer them.
    if (verbs.length) {
      unknown('authentication-consent', tool.name);
      if (tool.registrationType === 'declarative' && tool.autoSubmit === true) {
        out.push(finding('mutating-auto-submit', { tool,
          evidence: evidence('toolautosubmit', 'toolautosubmit is present on a mutating form'),
          detail: { verbs, authentication: 'unknown', confirmationHandler: 'unobservable', agentInvokedIsConsent: false } }));
      }
    }
    if (tool.runtimeId === 'navigator' || tool.registrationSource === 'provideContext-legacy' || tool.registrationSource === 'imperative-navigator-legacy') {
      out.push(finding('legacy-registration', { tool,
        evidence: evidence('registrationSource', tool.registrationSource ?? 'navigator.modelContext'), detail: { runtimeId: tool.runtimeId } }));
    }
    const walked = walkSchema(tool.inputSchema);
    if (walked.limitations.length || tool.schemaComplete === false || tool.schemaError) {
      unknown('schema-limits', `${tool.name}: ${[...walked.limitations, ...(tool.schemaWarnings ?? []), ...(tool.schemaError ? ['invalid-schema'] : [])].join(', ')}`);
    }
    const sensitive = verbs.length || own.some(f => f.code === 'sensitive-parameter');
    const permissive = [], strings = [];
    for (const { node, path, pointer } of walked.nodes) {
      const additional = node.additionalProperties;
      const unrestricted = additional === true || (additional && typeof additional === 'object' && !Array.isArray(additional) && Object.keys(additional).length === 0);
      if (unrestricted || ((node.type === 'object' || node.properties) && sensitive && additional !== false && node.unevaluatedProperties !== false)) {
        permissive.push({ path: path || 'inputSchema', pointer, explicit: Boolean(unrestricted) });
      }
      if (isStringSchema(node) && !hasStringConstraint(node) && !node.$ref && !node.allOf && !node.anyOf && !node.oneOf) strings.push(path || 'inputSchema');
    }
    if (permissive.length) out.push(finding('permissive-object', { tool,
      evidence: evidence('inputSchema', permissive.map(p => p.path).join(', ')), detail: { paths: permissive, sensitive: Boolean(sensitive) } }));
    // Replace the old property-only check at the aggregator, keeping its historical code.
    if (strings.length) out.push(finding('unbounded-string', { tool,
      evidence: evidence(strings.join(', '), strings.join(', ')), detail: { paths: strings } }));
    for (const field of modelFacingText(tool)) {
      const active = field.text.match(/<\s*script\b|!\[[^\]\n]{0,300}\]\(\s*(?:https?:|data:)[^\n)]{1,2000}\)|\bsystem\s+override\b|\bignore[_\s-]+(?:previous|prior)[_\s-]+instructions\b/i);
      if (active) out.push(finding('text-active-payload', { tool,
        evidence: { field: field.field, path: field.path, excerpt: excerptAround(field.text, active.index, active[0].length) }, detail: { marker: active[0].slice(0, 200) } }));
    }
    const text = modelFacingText(tool).map(f => f.text).join('\n');
    const bytes = new TextEncoder().encode(text).length;
    const estimatedTokens = Math.ceil(bytes / 4);
    if (estimatedTokens > 800) out.push(finding('token-estimate-over-budget', { tool,
      evidence: evidence('model-facing text', `${bytes} UTF-8 bytes; ~${estimatedTokens} tokens (bytes / 4)`),
      detail: { bytes, characters: [...text].length, estimatedTokens, exact: false, method: 'ceil(UTF-8 bytes / 4)', budget: 800 } }));
  }
  // Pair work and output are capped independently. A limit is disclosed even if every
  // inspected pair looks clean. This is lexical similarity, not semantic equivalence.
  const words = tools.map(t => new Set((String(t.description ?? '').slice(0, 16384).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])));
  let pairs = 0, matches = 0, limited = false;
  outer: for (let i = 0; i < tools.length; i++) for (let j = i + 1; j < tools.length; j++) {
    if (pairs++ >= 10000) { limited = true; break outer; }
    if (tools[i].name === tools[j].name || words[i].size < 3 || words[j].size < 3) continue;
    const intersection = [...words[i]].filter(w => words[j].has(w)).length;
    const similarity = intersection / (words[i].size + words[j].size - intersection);
    if (similarity < 0.8) continue;
    if (matches++ >= 100) { limited = true; continue; }
    out.push(finding('ambiguous-description', { tool: tools[i],
      evidence: { field: 'description', path: 'description', excerpt: `${tools[i].name} ↔ ${tools[j].name}: ${similarity.toFixed(3)} Jaccard` },
      detail: { otherTool: tools[j].name, otherInstance: tools[j].instanceId ?? null, similarity, threshold: 0.8 } }));
  }
  if (limited || tools.some(t => String(t.description ?? '').length > 16384)) unknown('similarity-limit', '10000 pairs; 100 findings; 16384 characters per description');
  if (!originScan) unknown('origin-scan-not-run', null);
  else if (originScan.page?.error || !originScan.page?.status || originScan.page.status >= 300 || originScan.page.truncatedHeaders?.length || originScan.files?.some(f => f.error || f.truncated || f.truncatedHeaders?.length)) unknown('origin-scan-incomplete', null);
  return { findings: out, notObservable };
}
