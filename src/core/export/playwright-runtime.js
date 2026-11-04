// Trusted static TypeScript. All page-authored values live in the separate PLAN data literal.
export const PLAYWRIGHT_RUNTIME = String.raw`
test.describe.configure({ mode: 'serial', retries: 0 });

class Decimal {
  text: string; digits: string; exponent: bigint; sign: number;
  constructor(text: string) {
    this.text = text;
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
    if (!m || (m[4]?.length ?? 0) > 32) throw new Error('Unsupported exact JSON number');
    const digits = (m[2] + (m[3] ?? '')).replace(/^0+/, '');
    this.digits = digits.replace(/0+$/, ''); this.sign = this.digits ? (m[1] ? -1 : 1) : 0;
    this.exponent = this.digits ? BigInt(m[4] ?? 0) - BigInt((m[3] ?? '').length) + BigInt(digits.length - this.digits.length) : 0n;
  }
}
function exact(text: string): any {
  if (typeof text !== 'string' || text.length > 2000000) throw new Error('JSON result exceeds the supported bound');
  const value = (JSON.parse as any)(text, (_key: string, item: any, context?: { source: string }) => {
    if (typeof item !== 'number') return item;
    if (!context?.source) throw new Error('Node must support exact JSON reviver context');
    return new Decimal(context.source);
  });
  const stack: { keys: Set<string> | null; key?: boolean }[] = [];
  for (const [token] of text.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]|[^\s{}\[\],:]+/g)) {
    const top = stack.at(-1);
    if (token === '{') stack.push({ keys: new Set(), key: true });
    else if (token === '[') stack.push({ keys: null });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && top?.keys) top.key = true;
    else if (token === ':' && top?.keys) top.key = false;
    else if (top?.keys && top.key && token.startsWith('"')) {
      const key = JSON.parse(token); if (top.keys.has(key)) throw new Error('Ambiguous duplicate JSON member'); top.keys.add(key);
    }
  }
  return value;
}
function canonical(value: any): string {
  if (value instanceof Decimal) return value.sign ? (value.sign < 0 ? '-' : '') + value.digits + 'e' + value.exponent : '0';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
function compare(a: Decimal, b: Decimal): number {
  if (!(a instanceof Decimal) || !(b instanceof Decimal)) throw new Error('Expected JSON numbers');
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1; if (!a.sign) return 0;
  const am = BigInt(a.digits.length) + a.exponent, bm = BigInt(b.digits.length) + b.exponent;
  if (am !== bm) return (am < bm ? -1 : 1) * a.sign;
  const size = Math.max(a.digits.length, b.digits.length), ad = a.digits.padEnd(size, '0'), bd = b.digits.padEnd(size, '0');
  return ad === bd ? 0 : (ad < bd ? -1 : 1) * a.sign;
}
function concrete(value: any): any {
  if (value instanceof Decimal) {
    const n = Number(value.text);
    if (!Number.isFinite(n) || compare(value, new Decimal(JSON.stringify(n))) !== 0) throw new Error('A bound number cannot be transported exactly');
    return n;
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(concrete);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, concrete(v)]));
}
function parts(pointer: string): string[] {
  if (typeof pointer !== 'string' || pointer.length > 2048 || pointer !== '' && !pointer.startsWith('/') || /~(?![01])/.test(pointer)) throw new Error('Invalid JSON Pointer');
  const list = pointer === '' ? [] : pointer.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (list.length > 128) throw new Error('JSON Pointer too deep'); return list;
}
function pick(value: any, path: string[]) {
  for (const key of path) {
    if (!value || typeof value !== 'object' || value instanceof Decimal || Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key) || !Object.hasOwn(value, key)) return { found: false, value: undefined };
    value = value[key];
  }
  return { found: true, value };
}
function argumentsFor(step: any, outputs: Map<string, any>) {
  let args = structuredClone(step.args);
  for (const binding of step.bindings) {
    const selected = binding.source === 'input' ? pick(PLAN.inputs, [binding.input]) : pick(outputs.get(binding.stepId), parts(binding.pointer));
    if (!selected.found) throw new Error('A reviewed binding source is missing');
    const path = parts(binding.path), value = concrete(selected.value);
    if (!path.length) { args = value; continue; }
    if (!pick(args, path).found) throw new Error('A reviewed binding destination is missing');
    const parent = pick(args, path.slice(0, -1));
    Object.defineProperty(parent.value, path.at(-1)!, { value, enumerable: true, writable: true, configurable: true });
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must remain an object'); return args;
}
function resultValue(text: any): any {
  if (typeof text !== 'string') return text;
  try { JSON.parse(text); } catch { return text; }
  return canonical(exact(text));
}
function assertOutput(check: any, outcome: any) {
  if (check.kind === 'recorded') {
    expect(outcome.ok, 'Recorded success/failure').toBe(check.ok);
    if (check.ok) expect(resultValue(outcome.result), 'Recorded output').toBe(resultValue(check.result));
    else expect(outcome.error, 'Recorded error text').toBe(check.error);
    return;
  }
  if (check.kind === 'error') { expect(outcome.ok).toBe(false); return; }
  expect(outcome.ok, 'Tool failed; effect may be unknown. No retry.').toBe(true);
  if (check.kind === 'ok') return;
  if (check.kind === 'equals') { expect(outcome.result).toBe(check.value); return; }
  const data = exact(outcome.result);
  if (check.kind === 'json-equals') { expect(canonical(data)).toBe(canonical(exact(check.value))); return; }
  if (check.kind !== 'fields' || check.version !== 1) throw new Error('Unsupported output assertion');
  for (const rule of check.rules) {
    const got = pick(data, parts(rule.path)); let pass = false;
    if (rule.op === 'exists') pass = got.found;
    else if (rule.op === 'missing') pass = !got.found;
    else if (got.found) {
      if (rule.op === 'equals') pass = canonical(got.value) === canonical(exact(rule.value));
      else if (rule.op === 'text-contains') pass = typeof got.value === 'string' && got.value.includes(rule.value);
      else if (rule.op === 'number-min' || rule.op === 'number-max') { const c = compare(got.value, exact(rule.value)); pass = rule.op === 'number-min' ? c >= 0 : c <= 0; }
      else if (Array.isArray(got.value)) {
        const c = compare(new Decimal(String(got.value.length)), exact(rule.value));
        pass = rule.op === 'length-equals' ? c === 0 : rule.op === 'length-min' ? c >= 0 : rule.op === 'length-max' && c <= 0;
      }
    }
    expect(pass, 'Selected-field output assertion').toBe(true);
  }
}
async function pickFrame(page: Page, spec: any): Promise<Frame> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (spec.frame.top) return page.mainFrame();
    const candidates = page.frames().filter(f => f !== page.mainFrame() && (spec.frame.url ? f.url() === spec.frame.url : new URL(f.url()).origin === spec.origin));
    if (spec.frame.indexPath?.length) {
      let current: Frame | undefined = page.mainFrame();
      for (const index of spec.frame.indexPath ?? []) current = current?.childFrames()[index];
      if (current && candidates.includes(current)) return current;
      if (candidates.length) throw new Error('Recorded frame position changed');
    } else if (candidates.length === 1) return candidates[0];
    else if (candidates.length > 1) throw new Error('Cannot single out the recorded frame');
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Recorded frame unavailable');
}

async function checkedTool(page: Page, step: any) {
const frame = await pickFrame(page, step);
expect(new URL(frame.url()).origin, 'Recorded frame origin').toBe(step.origin);
const handle = await frame.evaluateHandle(async (data: any) => {
  const mc = data.runtimeId === 'navigator' ? (navigator as any).modelContext : (document as any).modelContext;
  if (!mc || typeof mc.getTools !== 'function' || typeof mc.executeTool !== 'function' || mc.__explorerPolyfill) throw new Error('Qualified native WebMCP is required');
  const until = Date.now() + 5000; let tool: any;
  while (Date.now() < until) {
    const same = Array.from(await mc.getTools()).filter((t: any) => t.name === data.name && (t.origin ?? location.origin) === data.origin) as any[];
    const own = same.filter(t => t.window === undefined ? same.length === 1 : t.window === window);
    if (own.length > 1) throw new Error('Ambiguous registered tool');
    if (own.length === 1) { tool = own[0]; break; }
    await new Promise(r => setTimeout(r, 100));
  }
  if (!tool) throw new Error('Recorded tool is not registered in this frame');
  const encoding = typeof tool.inputSchema === 'string' ? 'string' : tool.inputSchema && typeof tool.inputSchema === 'object' ? 'object' : null;
  if (!encoding) throw new Error('Unknown argument contract; no calibration on the tool');
  const schema = encoding === 'string' ? JSON.parse(tool.inputSchema) : tool.inputSchema;
  const snapshot = JSON.stringify([tool.name, tool.description, tool.title, tool.inputSchema, tool.annotations]);
  return { mc, tool, schema, encoding, snapshot };
}, { name: step.name, origin: step.origin, runtimeId: step.runtimeId });
// JSON transport preserves literal keys such as __proto__ across Playwright's serializer.
const declared = JSON.parse(await handle.evaluate(x => JSON.stringify({ name: x.tool.name, schema: x.schema })));
expect(declared, 'Recorded tool name and input schema').toEqual({ name: step.name, schema: step.schema });
return handle;
}

test('WebMCP reviewed reproduction', async ({}, testInfo) => {
  test.setTimeout(30000 + PLAN.steps.length * 15000);
  expect(PLAN.blocked, 'Review unavailable or simulated evidence first').toEqual([]);
  expect(testInfo.retry, 'Automatic retries are forbidden').toBe(0);
  expect(testInfo.repeatEachIndex, 'Automatic repeated actions are forbidden').toBe(0);
  const url = new URL(PLAN.url);
  expect(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'A credential-free HTTP(S) page is required').toBe(true);
  const runId = process.env.WEBMCP_REPRO_RUN_ID;
  expect(typeof runId === 'string' && runId.length > 0 && runId.length <= 200, 'Choose one explicit reviewed run ID').toBe(true);
  expect(process.env.CHROME, 'CHROME must name a qualified Chrome for Testing binary').toBeTruthy();
  const receipts = join(tmpdir(), 'webmcp-repro-receipts'); mkdirSync(receipts, { recursive: true, mode: 0o700 });
  const receipt = createHash('sha256').update(JSON.stringify([runId, PLAN])).digest('hex');
  // Exclusive reservation BEFORE navigation/dispatch. Never deleted automatically.
  closeSync(openSync(join(receipts, receipt), 'wx', 0o600));
  const profile = mkdtempSync(join(tmpdir(), 'webmcp-playwright-'));
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME, headless: process.env.WEBMCP_HEADLESS === '1',
      args: ['--enable-blink-features=WebMCP,DeclarativeWebMCP', ...(process.env.CHROME_EXTRA_FLAGS ?? '').split(/\s+/).filter(Boolean)] });
    const page = await context.newPage(); await page.goto(url.href, { waitUntil: 'load' });
    const documentHandle = await page.mainFrame().evaluateHandle(() => document);
    const outputs = new Map<string, any>();
    const handles: Awaited<ReturnType<typeof checkedTool>>[] = [];
    await test.step('Contract snapshot', async () => { for (const step of PLAN.steps) handles.push(await checkedTool(page, step)); });
    for (let i = 0; i < PLAN.steps.length; i++) {
      const step = PLAN.steps[i];
      const result = await test.step('Step ' + (i + 1), async () => {
        expect(await documentHandle.evaluate(d => d === document), 'The document changed; no continuation').toBe(true);
        const handle = handles[i];
        try {
          const args = argumentsFor(step, outputs);
          // The retained RegisteredTool is invoked once. A throw or lost context never retries.
          const outcome = await handle.evaluate(async (x: any, argsJson: string) => {
            const args = JSON.parse(argsJson);
            if (JSON.stringify([x.tool.name, x.tool.description, x.tool.title, x.tool.inputSchema, x.tool.annotations]) !== x.snapshot) throw new Error('RegisteredTool changed before dispatch');
            try {
              const value = await x.mc.executeTool(x.tool, x.encoding === 'string' ? JSON.stringify(args) : args);
              return { ok: value !== null && value !== undefined, result: value == null ? null : typeof value === 'object' ? JSON.stringify(value) : String(value),
                error: value == null ? 'Effect unknown: no result; not replayed' : null };
            } catch (error) { return { ok: false, result: null, error: String((error as any)?.message ?? error) }; }
          }, JSON.stringify(args));
          await testInfo.attach('step-' + (i + 1) + '-outcome', { body: Buffer.from(JSON.stringify(outcome)), contentType: 'application/json' });
          assertOutput(step.expect, outcome); return outcome;
        } finally { await handle.dispose(); }
      });
      if (!result.ok) { expect(i, 'Unknown effects stop every later step').toBe(PLAN.steps.length - 1); return; }
      if (PLAN.steps.slice(i + 1).some((s: any) => s.bindings.some((b: any) => b.source === 'step' && b.stepId === step.id))) outputs.set(step.id, exact(result.result!));
    }
  } finally { try { await context?.close(); } finally { rmSync(profile, { recursive: true, force: true }); } }
});
`;
