// Copy-only templates. Page strings are JSON string literals or escaped HTML values, never
// identifiers or comments. Defining the generated functions has no side effects; unimplemented
// execution fails closed. proposedContract() is the object a template registers; fix-diff.js shows
// it next to the observed contract (engine v3). Templates for 001–007 are unchanged.
import { walkSchema, isStringSchema, hasStringConstraint } from './schema-walk.js';
import { jsonLiteral as literal } from './snippet-encode.js';
import { declarativeMarkup } from './starter-contract.js';
import { credentialControls } from './declarative-integrity.js';
import { BUDGET, FAR_OVER_FACTOR } from './description-injection.js';

const HINTS = ['readOnlyHint', 'consequentialHint', 'untrustedContentHint', 'debugging'];
const BRIEF = 'TODO: describe only this action, inputs and result concisely.';

const SECRET_TEXT = '# Revoke and rotate this key with its provider now: anyone who loaded the page has it.\n'
  + '# Then move the call to your server and keep the key in a secrets store or environment variable.\n'
  + '# Only publishable keys (for example Stripe pk_) belong in client code.\n'
  + '# Explorer never shows or stores the key value; search your bundle for the reported key type.\n';
const FRAME_TEXT = '<!-- REVIEW REQUIRED: each allow="tools" delegates the WebMCP tools feature to the framed origin. -->\n'
  + '<!-- Keep it only for frames you trust to register tools on this page; remove it elsewhere. -->\n'
  + '<!-- The parent still has to opt in with getTools({ fromOrigins }) before it sees those tools. -->\n'
  + '<iframe src="https://trusted.example/widget" allow="tools"></iframe>\n';

// The contract a reviewed registration would use: { kind: 'imperative', descriptor },
// { kind: 'declarative', declarative }, { failure: code } when no safe template exists, or null.
export function proposedContract(f, tool) {
  const id = f?.ruleId ?? f?.id;
  if (!tool || ['WMCP-SEC-004', 'WMCP-SEC-006', 'WMCP-SEC-013'].includes(id)) return null;
  if (id === 'WMCP-SEC-008') return { kind: 'declarative', declarative: declarativeProposal(tool) };
  let schema;
  try { schema = JSON.parse(JSON.stringify(tool.inputSchema ?? { type: 'object', properties: {} })); }
  catch { return { failure: '// Schema cannot be serialized. Inspect the contract manually before registering it.\n' }; }
  const walked = walkSchema(schema);
  if (walked.limitations.length || JSON.stringify(schema).length > 24000) return { failure:
    '// Schema is incomplete, unresolved or too large for a safe template.\n// Resolve the reported schema coverage limits before generating a registration.\n' };
  if (id === 'WMCP-SEC-001') for (const { node } of walked.nodes) {
    if (Object.hasOwn(node, 'description')) node.description = 'TODO: describe this parameter without agent instructions.';
    if (Object.hasOwn(node, 'title')) delete node.title;
  }
  if (id === 'WMCP-SEC-003') for (const { node } of walked.nodes) {
    if (isStringSchema(node) && !hasStringConstraint(node) && !node.$ref && !node.allOf && !node.anyOf && !node.oneOf) node.maxLength = 256;
    if ((node.type === 'object' || node.properties) && !node.$ref && !node.allOf && !node.anyOf && !node.oneOf) node.additionalProperties = false;
  }
  if (id === 'WMCP-SEC-012') for (const { node, isProperty } of walked.nodes) {
    if (isProperty && typeof node.description === 'string' && node.description.length > BUDGET.parameterDescription * FAR_OVER_FACTOR) {
      node.description = 'TODO: describe this parameter in at most 150 characters.';
    }
  }
  const annotations = {};
  for (const key of HINTS) {
    if (typeof tool.annotations?.[key] === 'boolean') annotations[key] = tool.annotations[key];
  }
  if (id === 'WMCP-SEC-002') Object.assign(annotations, { readOnlyHint: false, consequentialHint: true });
  if (id === 'WMCP-SEC-009') Object.assign(annotations, { readOnlyHint: false, ...(f.severity === 'high' ? { consequentialHint: true } : {}) });
  if (id === 'WMCP-SEC-010') annotations.untrustedContentHint = true;
  const descriptor = { name: id === 'WMCP-SEC-001' ? 'reviewed_tool_name' : String(tool.name),
    description: ['WMCP-SEC-001', 'WMCP-SEC-007', 'WMCP-SEC-012'].includes(id) ? BRIEF : String(tool.description ?? ''),
    inputSchema: schema, annotations };
  return { kind: 'imperative', descriptor };
}

// A declarative tool as reviewed: no toolautosubmit, no credential or card parameter, no hidden
// business value. Parameters keep their observed schema otherwise.
function declarativeProposal(tool) {
  let schema;
  try { schema = JSON.parse(JSON.stringify(tool.inputSchema ?? { type: 'object', properties: {} })); } catch { schema = { type: 'object', properties: {} }; }
  const credentials = new Set(credentialControls(tool).map((c) => c.name));
  const properties = {};
  for (const key of Object.keys(schema.properties ?? {})) {
    if (credentials.has(key)) continue;
    const p = schema.properties[key] && typeof schema.properties[key] === 'object' ? schema.properties[key] : { type: 'string' };
    if (isStringSchema(p) && !hasStringConstraint(p)) p.maxLength = 256;
    Object.defineProperty(properties, key, { value: p, enumerable: true, writable: true, configurable: true });
  }
  const required = (Array.isArray(schema.required) ? schema.required : []).filter((k) => Object.hasOwn(properties, k));
  return { name: String(tool.name ?? ''), description: String(tool.description ?? ''), toolautosubmit: false,
    method: tool.form?.method ?? null, hiddenBusinessFields: [], credentialFields: [],
    inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) } };
}

export function quickFix(f, tool = null) {
  const base = { reviewRequired: true, appliesAutomatically: false, language: 'javascript' };
  const id = f?.ruleId ?? f?.id;
  if (id === 'WMCP-SEC-006') return { ...base, language: 'text', code:
    '# Review server configuration for this origin. Do not paste into JavaScript.\n'
    + '# If WebMCP is used only by this site, consider:\nPermissions-Policy: tools=(self)\n'
    + '# If the site uses no WebMCP tools, consider tools=() instead.\n'
    + '# Design CSP for your real scripts and connections; test in Report-Only first.\n'
    + '# Do not add Access-Control-Allow-Origin: * to an authenticated endpoint.\n'
    + '# The discovery files are optional conventions, not a WebMCP requirement.\n' };
  if (id === 'WMCP-SEC-013') return { ...base, language: 'text', code: SECRET_TEXT };
  if (id === 'WMCP-SEC-011' && !tool) return { ...base, language: 'html', code: FRAME_TEXT };
  if (!tool) return { ...base, code: '// Inspect the original registration and its current document.modelContext API.\n// No live tool contract is available for a tailored template.\n' };
  if (id === 'WMCP-SEC-004') return { ...base, code:
    `// Review the authorization boundary for ${literal(String(tool.name)).replace(/\n/g, '')}\n`
    + '// agentInvoked identifies an agent submission; it does NOT prove human consent.\n'
    + '// Bind approval to the exact operation, account and arguments on your server.\n'
    + '// Do not accept an "approved" argument supplied by the model.\n'
    + 'async function authorizeReviewedAction(request, trustedSession) {\n'
    + '  // Implement authentication, object authorization, CSRF protection and\n'
    + '  // explicit human approval (or an appropriate pre-authorized policy).\n'
    + '  throw new Error("Application authorization and confirmation must be implemented");\n}\n' };
  const proposal = proposedContract(f, tool);
  if (!proposal) return { ...base, code: '// Inspect the original registration and its current document.modelContext API.\n// No tailored template exists for this finding.\n' };
  if (proposal.failure) return { ...base, code: proposal.failure };
  if (proposal?.kind === 'declarative') return { ...base, language: 'html', code: declarativeMarkup(proposal.declarative) };
  const { descriptor } = proposal;
  return { ...base, code: '// REVIEW REQUIRED: adapt the name, descriptions and business constraints.\n'
    + (id === 'WMCP-SEC-003' ? '// maxLength 256 is a proposal, not a verified business limit.\n// Closing objects may reject existing callers; review composed schemas manually.\n' : '')
    + (id === 'WMCP-SEC-009' ? '// The callback source contains a request or submission that is not a safe read.\n// Declare the tool as state-changing, or move the write out of this tool.\n' : '')
    + (id === 'WMCP-SEC-011' ? '// exposedTo removed: add back only reviewed origins trusted to act for the user.\n' : '')
    + '// Annotations are advisory. Enforce validation and authorization in the implementation.\n'
    + '// Remove/replace the old registration first; do not register this alongside it.\n'
    + 'async function registerReviewedTool(signal) {\n'
    + `  const descriptor = JSON.parse(${literal(JSON.stringify(descriptor, null, 2))});\n`
    + '  return document.modelContext.registerTool({\n    ...descriptor,\n'
    + '    async execute(args) {\n      // Implement server validation, authorization and the reviewed action.\n'
    + '      throw new Error("Reviewed tool implementation required");\n    }\n  }, { signal });\n}\n'
    + '// Pass an AbortController signal; abort it to unregister. No function is called here.\n' };
}
