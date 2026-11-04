// Chrome 152 returns tool.inputSchema as a JSON **string**, not the object the
// documentation describes. Observed live, see DECISIONS D-025.
//
// Everything downstream wants an object, so parsing happens once, as close to the source as
// possible. A schema that cannot be parsed is reported as such — never swallowed, never
// replaced by an empty object that would make a tool look argument-free.

export function toSchemaObject(value) {
  if (value === null || value === undefined) return { schema: null, error: null };
  if (typeof value === 'object') return { schema: value, error: null };

  if (typeof value !== 'string') {
    return { schema: null, error: `inputSchema has unexpected type ${typeof value}` };
  }

  const trimmed = value.trim();
  if (trimmed === '') return { schema: null, error: null };

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== 'object') {
      return { schema: null, error: 'inputSchema did not parse to an object' };
    }
    return { schema: parsed, error: null };
  } catch (cause) {
    return { schema: null, error: `inputSchema is not valid JSON: ${cause.message}` };
  }
}
