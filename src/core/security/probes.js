// Active probes (S2): a bounded, fixed set of calls that ask a tool's own code what it does with
// inputs the schema forbids, and what comes back from a valid call. The runtime validates
// nothing (WMP-0046), so the tool is the validation layer (spec §6.3.1.3, Chrome: validate
// strictly in code). Planning and judging are pure; the calls themselves go through the
// existing executor, on a site the person declared they control. Pure JavaScript.

import { finding } from './catalog.js';
import { walkProperties } from './text.js';
import { scanIndicators } from './description-injection.js';
import { sampleArguments } from '../schema/sample.js';

export const OUTPUT_BUDGET = 1500;
export const LONG_INPUT = 10000;
export const MAX_PROBES_PER_TOOL = 5;

const PERSONAL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b|\b(?:\+?\d[\d\s().-]{8,}\d)\b|\b(?:\d[ -]?){13,19}\b/;

// Which probes a tool admits. A tool whose schema has no properties admits only the output
// probe; one with required properties admits the missing-required probe; and so on. The list is
// deterministic and never longer than MAX_PROBES_PER_TOOL.
export function planProbes(tool) {
  const schema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : null;
  const base = sampleArguments(schema ?? {}, { requiredOnly: true, includeOptionalDefaults: true });
  const steps = [];
  const properties = schema ? walkProperties(schema, { maxDepth: 0 }) : [];
  const typeOf = (p) => (Array.isArray(p.property?.type) ? p.property.type[0] : p.property?.type);

  steps.push({ id: 'output-check', args: base, expects: 'ok' });

  const typed = properties.find((p) => ['string', 'number', 'integer', 'boolean'].includes(typeOf(p)));
  if (typed) {
    const wrong = typeOf(typed) === 'string' ? 12345 : 'not-the-declared-type';
    steps.push({ id: 'schema-wrong-type', args: { ...base, [typed.name]: wrong }, expects: 'rejection', path: typed.name, sent: typeof wrong });
  }
  const required = properties.filter((p) => p.required);
  if (required.length) {
    const omitted = required[0].name;
    const { [omitted]: _drop, ...rest } = base;
    steps.push({ id: 'schema-missing-required', args: rest, expects: 'rejection', path: omitted });
  }
  if (schema) {
    steps.push({ id: 'schema-extra-property', args: { ...base, explorerProbeUnknownProperty: 'x' }, expects: 'any', path: 'explorerProbeUnknownProperty' });
  }
  const free = properties.find((p) => typeOf(p) === 'string' && p.property.maxLength === undefined && !p.property.enum && !p.property.pattern && !p.property.format);
  if (free) {
    steps.push({ id: 'long-string', args: { ...base, [free.name]: 'A'.repeat(LONG_INPUT) }, expects: 'rejection', path: free.name, length: LONG_INPUT });
  }
  return steps.slice(0, MAX_PROBES_PER_TOOL);
}

// A tool may be probed only when the person has selected it; a tool that is not read-only is
// never preselected (it may change state), and the interface says why.
export function preselectable(tool) {
  return tool?.annotations?.readOnlyHint === true && tool?.annotations?.consequentialHint !== true;
}

// Turns a call outcome into findings. Nothing here invents: a probe that was cancelled, mocked
// or refused by Explorer yields nothing.
export function judgeProbe(tool, step, outcome) {
  const out = [];
  const explorerSide = new Set(['cancelled', 'tool-disabled', 'override-changed', 'tool-not-found', 'tool-not-in-frame', 'ambiguous-tool', 'navigated', 'tab-closed', 'no-result', 'demo-bridge-lost']);
  if (!outcome || outcome.mocked || explorerSide.has(outcome.code)) return out;
  const evidenceBase = { field: 'probe', probe: step.id, path: step.path ?? null };
  const accepted = outcome.ok === true;
  const excerptOf = (text) => String(text ?? '').slice(0, 160);

  if (step.id === 'output-check') {
    if (!accepted) {
      out.push(finding('probe-call-failed', { tool, evidence: { ...evidenceBase, excerpt: excerptOf(outcome.error ?? outcome.code), args: step.args }, detail: { code: outcome.code ?? null } }));
      return out;
    }
    const text = String(outcome.result ?? '');
    if (text.length > OUTPUT_BUDGET) {
      out.push(finding('output-over-budget', { tool, evidence: { ...evidenceBase, excerpt: `${text.length} characters`, length: text.length }, detail: { length: text.length, budget: OUTPUT_BUDGET } }));
    }
    const scan = scanIndicators(text);
    if (scan.directives.length) {
      const first = scan.directives[0];
      const at = text.indexOf(first);
      out.push(finding('output-directive', { tool, evidence: { ...evidenceBase, excerpt: text.slice(Math.max(0, at - 40), at + first.length + 40), phrases: scan.directives }, detail: { phraseCount: scan.directives.length } }));
    }
    if (scan.markup) {
      out.push(finding('output-markup', { tool, evidence: { ...evidenceBase, excerpt: excerptOf(scan.markup), token: scan.markup }, detail: { token: scan.markup } }));
    }
    const personal = text.match(PERSONAL);
    if (personal && tool.annotations?.untrustedContentHint !== true) {
      out.push(finding('output-personal-data', { tool, evidence: { ...evidenceBase, excerpt: excerptOf(personal[0]) }, detail: { sample: excerptOf(personal[0]) } }));
    }
    return out;
  }
  if (step.id === 'schema-wrong-type' && accepted) {
    out.push(finding('accepts-out-of-schema-input', { tool, evidence: { ...evidenceBase, excerpt: `${step.path} sent as ${step.sent}; the tool answered: ${excerptOf(outcome.result)}` }, detail: { path: step.path, sent: step.sent } }));
  } else if (step.id === 'schema-missing-required' && accepted) {
    out.push(finding('accepts-missing-required', { tool, evidence: { ...evidenceBase, excerpt: `${step.path} omitted; the tool answered: ${excerptOf(outcome.result)}` }, detail: { path: step.path } }));
  } else if (step.id === 'schema-extra-property' && accepted) {
    out.push(finding('accepts-unknown-property', { tool, evidence: { ...evidenceBase, excerpt: `${step.path} accepted` }, detail: { path: step.path } }));
  } else if (step.id === 'long-string' && accepted) {
    out.push(finding('accepts-unbounded-input', { tool, evidence: { ...evidenceBase, excerpt: `${step.length} characters accepted in ${step.path}` }, detail: { path: step.path, length: step.length } }));
  }
  return out;
}
