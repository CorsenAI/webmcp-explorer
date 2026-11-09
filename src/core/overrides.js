// Local tool overrides and mocked responses — the flagship capability (D-004 rule 6).
// Pure JavaScript: no chrome.* API.
//
// The point is to change what a tool looks like and what it returns WITHOUT touching the
// site: rewrite a description to see whether a model then picks the tool, tighten a schema,
// or make a call fail on demand. Nothing here modifies the page — an override is applied on
// Explorer's side of the boundary, and the original is always kept alongside so the user can
// see what they changed.
//
// An override is never silent: every applied tool carries `overridden: true`, and the UI is
// required to show it (rule 6, and the honesty rule that runs through this whole product).

export const MOCK_MODES = ['off', 'success', 'empty', 'error', 'timeout', 'malformed'];

const MALFORMED_PAYLOAD = '{"products": [ {"id": "p1", ]';

export function createOverride(logicalId) {
  return {
    logicalId,
    enabled: true,
    disabled: false,
    description: null,
    inputSchema: null,
    // Engine v3: the WebMCP hints of a proposed fix, tried locally ("Test this fix").
    annotations: null,
    mock: { mode: 'off', result: '', error: '', latencyMs: 0, once: false },
  };
}

function isActive(override) {
  return Boolean(override) && override.enabled !== false;
}

export function applyOverrides(tools, overrides = []) {
  const byId = new Map();
  for (const override of overrides) {
    if (isActive(override)) byId.set(override.logicalId, override);
  }

  return tools.map((tool) => {
    const override = byId.get(tool.logicalId);
    if (!override) return { ...tool, overridden: false };

    const changedDescription = typeof override.description === 'string';
    const changedSchema = override.inputSchema !== null && override.inputSchema !== undefined;
    const changedAnnotations = Boolean(override.annotations) && typeof override.annotations === 'object' && !Array.isArray(override.annotations);
    const mocked = override.mock?.mode && override.mock.mode !== 'off' && !override.mock.spent;
    const overridden = changedDescription || changedSchema || changedAnnotations || override.disabled || mocked;

    return {
      ...tool,
      description: changedDescription ? override.description : tool.description,
      inputSchema: changedSchema ? override.inputSchema : tool.inputSchema,
      annotations: changedAnnotations ? override.annotations : tool.annotations,
      // The originals travel with the tool so the UI can show a before/after rather than
      // asking the user to remember what the site actually declared.
      originalDescription: tool.description,
      originalInputSchema: tool.inputSchema,
      originalAnnotations: tool.annotations,
      disabled: Boolean(override.disabled),
      mockMode: mocked ? override.mock.mode : 'off',
      overridden: Boolean(overridden),
    };
  });
}

// Decides what a call should do: run for real, be blocked, or return a mocked outcome.
export function resolveCall(override) {
  if (!isActive(override)) return { kind: 'passthrough', latencyMs: 0 };

  if (override.disabled) {
    return {
      kind: 'blocked',
      latencyMs: 0,
      outcome: {
        ok: false,
        code: 'tool-disabled',
        error: 'This tool is disabled by a local override in Explorer.',
        mocked: true,
      },
    };
  }

  const mock = override.mock ?? { mode: 'off' };
  if (!MOCK_MODES.includes(mock.mode)) {
    throw new Error(`unknown mock mode: ${mock.mode}`);
  }
  if (mock.mode === 'off' || mock.spent) return { kind: 'passthrough', latencyMs: 0 };

  const latencyMs = Number.isFinite(mock.latencyMs) ? mock.latencyMs : 0;
  const base = { mocked: true, mockMode: mock.mode };

  if (mock.mode === 'success') {
    return { kind: 'mock', latencyMs, outcome: { ...base, ok: true, result: mock.result ?? '' } };
  }
  if (mock.mode === 'empty') {
    return { kind: 'mock', latencyMs, outcome: { ...base, ok: true, result: '' } };
  }
  if (mock.mode === 'malformed') {
    return { kind: 'mock', latencyMs, outcome: { ...base, ok: true, result: MALFORMED_PAYLOAD } };
  }
  if (mock.mode === 'timeout') {
    return {
      kind: 'mock',
      latencyMs,
      outcome: {
        ...base,
        ok: false,
        code: 'mocked-timeout',
        error: `The tool did not answer within ${latencyMs} ms (simulated).`,
      },
    };
  }

  return {
    kind: 'mock',
    latencyMs,
    outcome: {
      ...base,
      ok: false,
      code: 'mocked-error',
      error: mock.error || 'Simulated failure',
    },
  };
}

// A "once" mock is spent after it fires, so the next call sees the real tool again. This is
// what makes it possible to reproduce a single transient failure.
export function consumeOnce(override) {
  if (!isActive(override)) return override;
  const mock = override.mock;
  if (!mock || mock.mode === 'off' || !mock.once || mock.spent) return override;
  return { ...override, mock: { ...mock, spent: true } };
}
