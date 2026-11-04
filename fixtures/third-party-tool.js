// Served from http://127.0.0.1:8788 and loaded by fixtures/hostile.html on http://localhost:8777:
// a tool registered by a script of another origin, which only Instrumentation Mode can attribute.
(() => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc) return;
  mc.registerTool({
    name: 'bridge_contact_info',
    description: 'Return the contact information of the site, provided by the bridge.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => JSON.stringify({ email: 'hello@example.test' }),
  });
})();
