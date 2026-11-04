// Display JSON numbers using their original spelling, including integers and decimals
// that JavaScript Number cannot represent exactly. This representation never leaves the UI.
export class DisplayNumber {
  constructor(text) { this.text = text; }
}

export function parseDisplayJson(text) {
  if (typeof text !== 'string' || !/^[\s]*[\[{]/.test(text)) return null;
  try {
    return JSON.parse(text, (_key, value, context) => {
      if (typeof value !== 'number') return value;
      // An older engine must fall back to the original text instead of rounding data.
      if (!context?.source) throw new Error('Original numeric spelling unavailable');
      return new DisplayNumber(context.source);
    });
  } catch { return null; }
}
