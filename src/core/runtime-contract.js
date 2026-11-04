// The two wire contracts qualified by the inert platform probe. Never learn an encoding
// by retrying a business action. This is data consumed by the self-contained page executor.
export function selectRuntimeContract({ runtimeId = 'document', schemaEncoding, executeArity = null, hasExecute = true,
  captured = false, emulated = false, refused = false, inventoryOnly = false } = {}) {
  if (refused || inventoryOnly) return null;
  if (!['document', 'navigator'].includes(runtimeId)) return null;
  if (!hasExecute) return captured ? { runtimeId, engine: 'direct', argsEncoding: 'object' } : null;
  if (schemaEncoding === 'missing') schemaEncoding = executeArity === 1 ? 'object' : executeArity === 2 ? 'string' : null;
  if (!['object', 'string'].includes(schemaEncoding)) return null;
  return { runtimeId, engine: emulated ? 'emulated' : 'native', argsEncoding: schemaEncoding };
}
