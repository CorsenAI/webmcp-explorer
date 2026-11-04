// A reproduction of one tool call, outside Explorer: something a colleague can run in their
// DevTools console or in a Playwright script and get the same call — or an honest account of
// why they will not. Pure JavaScript: no chrome.*, no DOM, no clock of its own.
//
// What it must get right, because a reproduction that runs the wrong tool is worse than none:
//  - the FRAME: getTools() aggregates same-origin frames (WMP-0002), so the snippet runs in the
//    frame that registered the tool and keeps only what that frame owns (`tool.window ===
//    window`); the Playwright script picks the frame by URL;
//  - HOMONYMS: two owned tools of one name in one frame, or several candidates on a runtime
//    that does not say who owns what, stop the script rather than let it pick one at random;
//  - REGISTRATION: a page registers on its own schedule; the call waits for the name, for a
//    bounded time, and says what it saw when it gives up;
//  - the ARGUMENT FORM: chosen from the shape the runtime hands the schema back in, the way
//    Explorer does (page/execute.js, D-075);
//  - MOCKED or OVERRIDDEN calls: a result served by a local override never reached the page;
//    the reproduction calls the real tool and says so up front, with the override attached.

import { ISO, slug, stamp, fence } from './text.js';
import { jsData, mdCode, mdText } from './safe.js';
import { playwrightSpec, specFilename } from './playwright.js';
export { playwrightSpec, specFilename } from './playwright.js';

export const REGISTRATION_WAIT_MS = 5000;

// The generated scripts print their outcome for the person who pastes them; the name is
// assembled here so that this file — which ships — carries no logging call of its own.
const LOG = ['console', 'log'].join('.');
const ERR = ['console', 'error'].join('.');

function frameOf({ tool, frame }) {
  const top = Number.isInteger(tool.frameId) ? tool.frameId === 0 : (frame?.isTopLevel ?? true);
  const indexPath = Array.isArray(frame?.indexPath) ? frame.indexPath
    : Array.isArray(tool.frameIndexPath) ? tool.frameIndexPath : null;
  return {
    top,
    frameId: Number.isInteger(tool.frameId) ? tool.frameId : null,
    origin: frame?.origin ?? tool.origin ?? null,
    url: frame?.url ?? tool.frameUrl ?? null,
    // The index of each ancestor among its parent's frames, top first: what tells two iframes
    // of one URL apart. null when Explorer could not read it.
    indexPath: top ? [] : indexPath,
  };
}

function pathText(indexPath) {
  return indexPath && indexPath.length ? ` — index path [${indexPath.join(', ')}] among the page's frames, top first` : '';
}

function frameText(f) {
  if (f.top) return 'the top-level document';
  const where = f.url ?? f.origin ?? '?';
  return `the iframe at ${where}${f.frameId !== null ? ` (frame #${f.frameId})` : ''}${pathText(f.indexPath)}`;
}

// The override in force when the call was recorded, if any: what it changed, and whether the
// recorded result came from it rather than from the page.
function overrideFacts(override, outcome) {
  if (!override) {
    return outcome?.mocked === true
      ? { mocked: true, mockMode: outcome.mockMode ?? null, disabled: false, descriptionRewritten: false, schemaRewritten: false, latencyMs: 0, override: null }
      : null;
  }
  const mock = override.mock ?? {};
  const mocked = outcome?.mocked === true || (mock.mode && mock.mode !== 'off');
  return {
    mocked: Boolean(mocked),
    mockMode: mocked ? (outcome?.mockMode ?? mock.mode ?? null) : null,
    disabled: Boolean(override.disabled),
    descriptionRewritten: typeof override.description === 'string',
    schemaRewritten: override.inputSchema !== null && override.inputSchema !== undefined,
    latencyMs: Number.isFinite(mock.latencyMs) ? mock.latencyMs : 0,
    override: JSON.parse(JSON.stringify(override)),
  };
}

// The body shared by the console snippet and the Playwright script: resolve the tool in this
// frame, wait for it, refuse a homonym, call it in the form the runtime takes.
function callBody({ indent = '  ' } = {}) {
  const lines = [
    'const mc = document.modelContext || navigator.modelContext;',
    'if (!mc || typeof mc.getTools !== "function") throw new Error("WebMCP is not available in this frame (is the WebMCP flag on, and is this the right frame?)");',
    `const deadline = Date.now() + ${REGISTRATION_WAIT_MS};`,
    'let owned = [];',
    'for (;;) {',
    '  const tools = Array.from(await mc.getTools());',
    '  const same = tools.filter((t) => t.name === name);',
    '  // Only a tool this frame registered; a runtime that does not say (no window) is trusted with a single candidate only.',
    '  owned = same.filter((t) => (t.window === undefined ? same.length === 1 : t.window === window));',
    '  if (owned.length) break;',
    '  if (Date.now() > deadline) throw new Error(`no tool named "${name}" registered by this frame after ' + `${REGISTRATION_WAIT_MS / 1000}` + ' s (seen: ${tools.map((t) => t.name).join(", ") || "none"})`);',
    '  await new Promise((r) => setTimeout(r, 100));',
    '}',
    'if (owned.length > 1) throw new Error(`${owned.length} tools named "${name}" in this frame: this reproduction will not pick one at random`);',
    'const tool = owned[0];',
    '// Chrome 152 and 153 hand the schema back as a string and take the arguments as a JSON string; a runtime that follows the specification returns an object and takes an object.',
    'const input = typeof tool.inputSchema === "string" ? JSON.stringify(args) : args;',
    'const startedAt = performance.now();',
    'try {',
    '  const result = await mc.executeTool(tool, input);',
    '  return { ok: true, durationMs: Math.round(performance.now() - startedAt), result: result === null || result === undefined ? null : String(result) };',
    '} catch (error) {',
    '  return { ok: false, durationMs: Math.round(performance.now() - startedAt), error: String(error && error.message ? error.message : error) };',
    '}',
  ];
  return lines.map((l) => indent + l).join('\n');
}

export function consoleSnippet({ tool, args, frame, page }) {
  const f = frameOf({ tool, frame });
  return [
    '// WebMCP Explorer — one explicit invocation; no error-driven retry.',
    '// Open the recorded HTTP(S) page and select the recorded frame in DevTools.',
    '// The data below describes that frame; no page-authored text is executable source.',
    '(async () => {',
    `  const recordedFrame = ${jsData(f)};`,
    `  const name = ${jsData(tool.name)};`,
    `  const args = ${jsData(args ?? {})};`,
    callBody(),
    `})().then((outcome) => { ${LOG}(outcome); return outcome; });`,
    '',
  ].join('\n');
}

// Everything a reader needs before the snippet: the report. `outcome` is the recorded call
// (a run result or a history entry), `tool` the live or recorded tool, `override` the override
// in force when it ran, `page` { url, topOrigin }, `frame` { origin, url, isTopLevel } when
// known, `browser` { userAgent, product }, `extensionVersion`.
export function reproReport({ tool, args, outcome, override = null, page = null, frame = null, browser = null, extensionVersion = null, at = Date.now() }) {
  const f = frameOf({ tool, frame });
  const facts = overrideFacts(override, outcome);
  const mocked = Boolean(facts?.mocked);
  const snippet = consoleSnippet({ tool, args, frame, page });
  const spec = playwrightSpec({ tool, args, outcome, override: facts ? override ?? { mocked: true } : null, frame, page, browser });

  const preconditions = [
    browser?.userAgent
      ? `A browser with WebMCP: recorded on ${browser.product ?? browser.userAgent}; Chrome for Testing 155, or Chrome with chrome://flags/#enable-webmcp-testing.`
      : 'A browser with WebMCP: Chrome for Testing 155, or Chrome with chrome://flags/#enable-webmcp-testing.',
    `The page ${page?.url ?? tool.origin} open, with the tool registered by ${frameText(f)}. getTools() aggregates same-origin frames: the call must run in that frame.`,
    `The tool registered before the call: the scripts wait up to ${REGISTRATION_WAIT_MS / 1000} s for the name. A tool the page registers on a user action needs that action first.`,
    'The page in the state the recorded call found it (carts, counters, sessions): a tool that reads or changes state answers differently from another state.',
    'No extension is needed: the scripts talk to the page\'s own modelContext. Explorer needed a site grant to record this; the reproduction does not.',
  ];
  if (mocked) {
    preconditions.unshift(`The recorded result came from a local override in Explorer (mock: ${facts.mockMode}), not from the page: the page's tool did not run. The console snippet calls the real tool; the Playwright test refuses simulated evidence. The override is attached to the JSON.`);
  } else if (facts && (facts.descriptionRewritten || facts.schemaRewritten || facts.disabled)) {
    preconditions.unshift('An override was in force in Explorer when this ran (description or schema rewritten, or the tool disabled). It changed what Explorer showed, not what the page did; the scripts use the page\'s own contract.');
  }
  if (tool.notInjected) {
    preconditions.unshift('Explorer could not enter the frame that owns this tool (a cross-origin frame without access): the recorded call never ran. The scripts must run in that frame.');
  }

  const json = {
    kind: 'webmcp-explorer/reproduction',
    version: 2,
    observedAt: ISO(at),
    recordedAt: outcome?.startedAt ? ISO(outcome.startedAt) : (outcome?.at ? ISO(outcome.at) : null),
    page: { url: page?.url ?? null, topOrigin: page?.topOrigin ?? null },
    frame: f,
    tool: {
      name: tool.name,
      origin: tool.origin ?? null,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema ?? null,
      contractFingerprint: tool.contractFp ?? null,
      logicalId: tool.logicalId ?? null,
    },
    args: args ?? {},
    outcome: outcome ? {
      ok: outcome.ok === true,
      result: outcome.ok === true ? (outcome.result ?? null) : null,
      error: outcome.ok === true ? null : (outcome.error ?? null),
      code: outcome.code ?? null,
      cancelled: outcome.cancelled === true,
      navigated: outcome.navigated === true,
      durationMs: Number.isFinite(outcome.durationMs) ? outcome.durationMs : null,
      roundTripMs: Number.isFinite(outcome.roundTripMs) ? outcome.roundTripMs : null,
      argsEncoding: outcome.argsEncoding ?? null,
      engine: outcome.engine ?? null, dispatchState: outcome.dispatchState ?? null,
      effectState: outcome.effectState ?? null, attempts: outcome.attempts ?? null,
      mocked,
    } : null,
    override: facts,
    browser: browser ? { userAgent: browser.userAgent ?? null, product: browser.product ?? null } : null,
    extensionVersion,
    preconditions,
    console: snippet,
    playwright: spec,
  };

  const lines = [
    `# Reproduce ${mdCode(tool.name)} on ${mdCode(page?.url ?? tool.origin)}`,
    '',
    `Recorded ${json.recordedAt ?? json.observedAt}${extensionVersion ? ` with WebMCP Explorer ${mdCode(extensionVersion)}` : ''}${browser?.product ? ` on ${mdCode(browser.product)}` : ''}.`,
    '',
    '## Before you run it',
    '',
    ...preconditions.map((p) => `- ${mdText(p)}`),
    '',
    '## The call',
    '',
    `Tool ${mdCode(tool.name)} in ${mdCode(frameText(f))}${tool.contractFp ? ` — contract fingerprint ${mdCode(tool.contractFp)}` : ''}.`,
    '',
    'Arguments:',
    '',
    fence(JSON.stringify(args ?? {}, null, 2), 'json'),
    '',
  ];
  if (outcome) {
    const o = json.outcome;
    if (o.cancelled) lines.push('What happened: the call was cancelled from Explorer before it settled; there is no result to compare with.');
    else if (o.ok) lines.push(`What happened: succeeded in ${o.durationMs ?? '?'} ms in the page${o.roundTripMs !== null ? ` (${o.roundTripMs} ms round trip through Explorer)` : ''}${o.argsEncoding ? `, arguments sent as ${o.argsEncoding === 'object' ? 'an object' : 'a JSON string'}` : ''}${mocked ? ' — served by the override, not by the page' : ''}.`);
    else lines.push(`What happened: failed${o.durationMs !== null ? ` after ${o.durationMs} ms` : ''} — ${mdCode(o.error ?? o.code ?? 'unknown error')}${o.code ? ` (code ${o.code})` : ''}${mocked ? ' — served by the override, not by the page' : ''}.`);
    if (o.effectState === 'unknown') lines.push('The action may have happened. Explorer did not retry it. Review the page before a new request.');
    lines.push('');
    if (o.ok && !o.navigated) lines.push('Result:', '', fence(o.result ?? '', ''), '');
    if (o.navigated) lines.push('The tool returned no value; navigation or another unknown effect may have occurred.', '');
  }
  if (tool.inputSchema) lines.push('Input schema:', '', fence(JSON.stringify(tool.inputSchema, null, 2), 'json'), '');
  lines.push('## In the DevTools console', '', `Pick ${mdCode(f.top ? 'top' : f.url ?? f.origin)} in the console's context selector, then paste:`, '', fence(snippet.trimEnd(), 'js'), '');
  lines.push('## As a Playwright script', '', `Save the following as \`${specFilename(tool)}\`, install \`@playwright/test\`, choose an explicit \`WEBMCP_REPRO_RUN_ID\`, and run it with \`CHROME\` pointing at a Chrome for Testing binary:`, '', fence(spec.trimEnd(), 'ts'), '');

  return {
    filename: `webmcp-reproduce_${slug(tool.name, 'tool')}_${stamp(at)}`,
    json,
    markdown: `${lines.join('\n').trimEnd()}\n`,
    console: snippet,
    playwright: spec,
  };
}

export function scriptToolConfig(tool) {
  const config = {
    name: tool?.name ?? '',
    description: tool?.description ?? '',
    inputSchema: tool?.inputSchema && typeof tool.inputSchema === 'object'
      ? tool.inputSchema
      : { type: 'object', properties: {} },
  };
  const ann = tool?.annotations && typeof tool.annotations === 'object' ? tool.annotations : {};
  if (Object.keys(ann).length > 0) config.annotations = ann;
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function registerToolSnippet(tool) {
  return [
    '// Review this authoring template before registering it on your own page.',
    `const descriptor = ${jsData(JSON.parse(scriptToolConfig(tool)))};`,
    'const mc = document.modelContext ?? navigator.modelContext;',
    'mc.registerTool({ ...descriptor,',
    '  async execute(input) {',
    '    // Replace this example with the reviewed application implementation.',
    '    return { ok: true, input };',
    '  },',
    '});', '',
  ].join('\n');
}
