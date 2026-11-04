// Copy-only templates. Page strings are JSON string literals, never identifiers or comments.
// Defining the generated functions has no side effects; unimplemented execution fails closed.
import { walkSchema, isStringSchema, hasStringConstraint } from './schema-walk.js';

const literal = value => JSON.stringify(value, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  .replace(/[\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
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
  let schema;
  try { schema = JSON.parse(JSON.stringify(tool.inputSchema ?? { type: 'object', properties: {} })); }
  catch { return { ...base, code: '// Schema cannot be serialized. Inspect the contract manually before registering it.\n' }; }
  const walked = walkSchema(schema);
  if (walked.limitations.length || JSON.stringify(schema).length > 24000) return { ...base,
    code: '// Schema is incomplete, unresolved or too large for a safe template.\n// Resolve the reported schema coverage limits before generating a registration.\n' };
  if (id === 'WMCP-SEC-001') for (const { node } of walked.nodes) {
    if (Object.hasOwn(node, 'description')) node.description = 'TODO: describe this parameter without agent instructions.';
    if (Object.hasOwn(node, 'title')) delete node.title;
  }
  if (id === 'WMCP-SEC-003') for (const { node } of walked.nodes) {
    if (isStringSchema(node) && !hasStringConstraint(node) && !node.$ref && !node.allOf && !node.anyOf && !node.oneOf) node.maxLength = 256;
    if ((node.type === 'object' || node.properties) && !node.$ref && !node.allOf && !node.anyOf && !node.oneOf) node.additionalProperties = false;
  }
  const annotations = {};
  for (const key of ['readOnlyHint', 'consequentialHint', 'untrustedContentHint', 'debugging']) {
    if (typeof tool.annotations?.[key] === 'boolean') annotations[key] = tool.annotations[key];
  }
  if (id === 'WMCP-SEC-002') Object.assign(annotations, { readOnlyHint: false, consequentialHint: true });
  const descriptor = { name: id === 'WMCP-SEC-001' ? 'reviewed_tool_name' : String(tool.name),
    description: ['WMCP-SEC-001', 'WMCP-SEC-007'].includes(id) ? 'TODO: describe only this action, inputs and result concisely.' : String(tool.description ?? ''),
    inputSchema: schema, annotations };
  return { ...base, code: '// REVIEW REQUIRED: adapt the name, descriptions and business constraints.\n'
    + (id === 'WMCP-SEC-003' ? '// maxLength 256 is a proposal, not a verified business limit.\n// Closing objects may reject existing callers; review composed schemas manually.\n' : '')
    + '// Annotations are advisory. Enforce validation and authorization in the implementation.\n'
    + '// Remove/replace the old registration first; do not register this alongside it.\n'
    + 'async function registerReviewedTool(signal) {\n'
    + `  const descriptor = JSON.parse(${literal(JSON.stringify(descriptor, null, 2))});\n`
    + '  return document.modelContext.registerTool({\n    ...descriptor,\n'
    + '    async execute(args) {\n      // Implement server validation, authorization and the reviewed action.\n'
    + '      throw new Error("Reviewed tool implementation required");\n    }\n  }, { signal });\n}\n'
    + '// Pass an AbortController signal; abort it to unregister. No function is called here.\n' };
}
