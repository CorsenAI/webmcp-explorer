export function registerDemoTool(name, description, inputSchema, result, annotations) {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || typeof mc.registerTool !== 'function') return false;
  mc.registerTool({
    name,
    description,
    inputSchema,
    annotations: annotations ?? { readOnlyHint: true },
    execute: async () => JSON.stringify(result),
  });
  return true;
}

export function report(text) {
  const el = document.getElementById('state');
  if (el) el.textContent = text;
}
