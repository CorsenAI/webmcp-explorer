// Compare JSON data without collapsing distinct numbers through JavaScript Number.
// Normalize decimal spellings (1, 1.0, 10e-1) without expanding large exponents.
class ExactNumber {
  constructor(source) {
    const [, sign, integer, fraction = '', exponent = '0'] =
      /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
    const digits = (integer + fraction).replace(/^0+/, '');
    const significant = digits.replace(/0+$/, '');
    this.sign = significant ? (sign ? -1 : 1) : 0;
    this.digits = significant;
    this.exponent = significant
      ? BigInt(exponent) - BigInt(fraction.length) + BigInt(digits.length - significant.length) : 0n;
    this.text = significant
      ? `${sign}${significant}e${BigInt(exponent) - BigInt(fraction.length) + BigInt(digits.length - significant.length)}`
      : '0';
  }
}

// Compare decimal values by magnitude and padded significant digits. Never expand an
// exponent or convert through Number, including overflow, underflow and adjacent large IDs.
export function compareJsonNumbers(left, right) {
  const syntax = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
  if (typeof left !== 'string' || typeof right !== 'string' || !syntax.test(left) || !syntax.test(right)) {
    throw new Error('Expected a JSON number written in decimal notation.');
  }
  const a = new ExactNumber(left), b = new ExactNumber(right);
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
  if (!a.sign) return 0;
  const am = BigInt(a.digits.length) + a.exponent;
  const bm = BigInt(b.digits.length) + b.exponent;
  if (am !== bm) return (am < bm ? -1 : 1) * a.sign;
  const size = Math.max(a.digits.length, b.digits.length);
  const ad = a.digits.padEnd(size, '0'), bd = b.digits.padEnd(size, '0');
  return ad === bd ? 0 : (ad < bd ? -1 : 1) * a.sign;
}

export function canonicalJson(text) {
  if (typeof text !== 'string' || !/^\s*[\[{]/.test(text)) return null;
  try {
    const value = JSON.parse(text, (_key, item, context) => {
      if (typeof item !== 'number') return item;
      if (!context?.source) throw new Error('Exact number unavailable');
      return new ExactNumber(context.source);
    });
    return canonical(value);
  } catch { return null; }
}

function canonical(value) {
  if (value instanceof ExactNumber) return value.text;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
