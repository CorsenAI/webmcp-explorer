// A fake OpenAI-compatible endpoint, so the whole agent loop can be tested end to end with
// no API key, no network and no cost.
//
// It is scripted, not clever: on the first turn it calls the first tool it was offered, and
// once it has seen a tool result it answers with that result quoted back. That is enough to
// prove the part that matters — declarations reach the model, a tool call reaches the page,
// the page's answer reaches the model, and the answer reaches the panel.
//
// Query parameters force the failure paths a real provider produces only by accident:
//
//   ?mode=error      → 401 with a provider-shaped error body
//   ?mode=badargs    → a tool call whose arguments are not valid JSON
//   ?mode=unknown    → a tool call naming a tool the page does not have
//   ?mode=loop       → calls a tool on every turn, forever, to exercise the step budget
//   ?mode=notools    → answers immediately without calling anything
//   ?mode=slow&ms=N  → waits N ms before answering, to outlive the service worker

const MODEL = 'mock-1';

export function isMockPath(path) {
  return path === '/mock/v1/chat/completions' || path === '/mock/v1/models';
}

export async function handleMock(req, res, url) {
  if (url.pathname === '/mock/v1/models') {
    return json(res, 200, { data: [{ id: MODEL }, { id: 'mock-2' }] });
  }

  const mode = url.searchParams.get('mode') ?? 'default';
  if (mode === 'error') {
    return json(res, 401, { error: { message: 'Invalid API key (mock)' } });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (cause) {
    return json(res, 400, { error: { message: `bad request: ${cause.message}` } });
  }

  const messages = body.messages ?? [];
  const tools = body.tools ?? [];
  // Deterministic, and description-sensitive on purpose. A tool whose description contains
  // PREFERRED wins: that is what lets an eval scenario prove the actual value proposition —
  // rewrite a description with an override, and the model's choice changes.
  // Otherwise a search-shaped tool wins, so the default path exercises argument passing
  // against a schema with a required field.
  const offered = tools
    .map((t) => ({ name: t.function?.name, description: t.function?.description ?? '' }))
    .filter((t) => t.name);
  const firstTool = (offered.find((t) => t.description.includes('PREFERRED'))
    ?? offered.find((t) => t.name.includes('search'))
    ?? offered[0])?.name ?? null;
  const results = messages.filter((m) => m.role === 'tool');

  // ?mode=echo answers with the system prompt it received, so a scenario can prove that a
  // prompt profile selected in the panel actually reaches the model — the answer text is the
  // system prompt, not a guess about it.
  if (mode === 'echo') {
    const system = messages.find((m) => m.role === 'system')?.content ?? '(no system prompt)';
    return json(res, 200, completion({ content: `SYSTEM: ${system}` }));
  }

  // ?mode=slow&ms=40000 — a provider that takes longer than Chrome's 30 s idle timeout, which
  // is what turns the MV3 worker lifetime into a product problem. Only the FIRST call is slow:
  // a run that is slow at every step takes minutes and would say nothing extra.
  if (mode === 'slow' && results.length === 0) {
    const ms = Math.min(120000, Number(url.searchParams.get('ms') ?? 40000));
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  if (mode === 'notools' || !firstTool) {
    return json(res, 200, completion({ content: 'No tool was needed.' }));
  }

  if (mode === 'unknown' && results.length === 0) {
    return json(res, 200, completion({
      toolCall: { name: 'tool_that_does_not_exist', args: '{}' },
    }));
  }

  if (mode === 'badargs' && results.length === 0) {
    return json(res, 200, completion({ toolCall: { name: firstTool, args: '{"q":' } }));
  }

  if (mode === 'loop' || results.length === 0) {
    // The argument is scripted too. A phrase the goal puts in double quotes is used as the
    // query, so a demonstration can search for what it says; otherwise the historical "mac".
    const goal = String(messages.find((m) => m.role === 'user')?.content ?? '');
    const quoted = goal.match(/"([^"]{1,40})"/);
    const query = quoted ? quoted[1] : 'mac';
    return json(res, 200, completion({
      content: results.length === 0 ? 'Calling the first tool.' : '',
      toolCall: { name: firstTool, args: JSON.stringify({ query, q: query }) },
    }));
  }

  const last = results[results.length - 1];
  return json(res, 200, completion({
    content: `The tool answered: ${String(last.content ?? '').slice(0, 400)}`,
  }));
}

let nextId = 1;

function completion({ content = null, toolCall = null }) {
  const message = { role: 'assistant', content };
  if (toolCall) {
    message.tool_calls = [{
      id: `mockcall_${nextId++}`,
      type: 'function',
      function: { name: toolCall.name, arguments: toolCall.args },
    }];
  }
  return {
    id: `mockcmpl_${nextId}`,
    object: 'chat.completion',
    model: MODEL,
    choices: [{ index: 0, message, finish_reason: toolCall ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 42, completion_tokens: 7 },
  };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  }).end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
