// Runs in the MAIN world of an inspected document. Two constraints shape this file:
//
//  1. `probeMainWorld` is serialised and injected by chrome.scripting.executeScript, so it
//     must be self-contained — it cannot close over anything in this module.
//  2. Everything it returns crosses a structured-clone boundary. The native tool object
//     carries a `window` reference and is NOT cloneable, so tools are mapped explicitly.
//     Returning them as-is fails silently.
//
// It observes. It never registers, patches or wraps anything: native WebMCP is the source
// of truth (D-004 rule 2).

export function probeMainWorld(fromOrigins, callbackPatterns = null) {
  // One shape for a browser error, serialisable across executeScript.
  const describeError = (error) => ({
    name: error && error.name ? String(error.name) : 'Error',
    message: String(error && error.message ? error.message : error),
  });

  // Reading the accessor has never been observed to throw (Chrome 153 to 157 keep it readable
  // even where every call is refused, WMP-0051); the guard exists so that a build that did
  // throw would be diagnosed rather than fail the whole frame.
  let host = null;
  let mc = null;
  let accessError = null;
  try {
    if (document.modelContext) {
      host = 'document';
      mc = document.modelContext;
    } else if (navigator.modelContext) {
      host = 'navigator';
      mc = navigator.modelContext;
    }
  } catch (error) {
    accessError = describeError(error);
  }

  const methods = mc
    ? ['registerTool', 'getTools', 'executeTool', 'addEventListener']
      .filter((m) => typeof mc[m] === 'function')
    : [];

  // The `tools` policy only means something if Chrome knows the feature at all.
  let knownPolicyFeatures = [];
  let toolsPolicyAllowed = false;
  try {
    const policy = document.featurePolicy ?? document.permissionsPolicy;
    if (policy && typeof policy.features === 'function') {
      knownPolicyFeatures = Array.from(policy.features());
      if (knownPolicyFeatures.includes('tools') && typeof policy.allowsFeature === 'function') {
        toolsPolicyAllowed = policy.allowsFeature('tools');
      }
    }
  } catch {
    knownPolicyFeatures = [];
  }

  // Reading the parent's origin throws across origins; that throw IS the signal.
  let parentOriginAccessible = true;
  if (window !== window.top) {
    try {
      parentOriginAccessible = window.parent.location.origin === location.origin;
    } catch {
      parentOriginAccessible = false;
    }
  }

  // Declarative tools are <form toolname="..."> in the light DOM or an open shadow root.
  // Closed shadow roots cannot be reached from page script (L-18).
  const declarativeElements = [];
  const collectDeclarative = (root, depth) => {
    if (!root || depth > 6) return;
    try {
      for (const el of root.querySelectorAll('form[toolname]')) declarativeElements.push(el);
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) collectDeclarative(el.shadowRoot, depth + 1);
      }
    } catch { /* detached or inaccessible shadow tree */ }
  };
  collectDeclarative(document, 0);
  const declarativeToolNames = declarativeElements
    .map((el) => el.getAttribute('toolname'))
    .filter(Boolean);
  const declarativeAutoSubmitNames = declarativeElements
    .filter((el) => el.hasAttribute('toolautosubmit'))
    .map((el) => el.getAttribute('toolname'))
    .filter(Boolean);

  const declarativeForms = declarativeElements.slice(0, 500).map((form, index) => ({
    name: form.getAttribute('toolname') ?? '', description: form.getAttribute('tooldescription') ?? '',
    autoSubmit: form.hasAttribute('toolautosubmit'), index, submitHandler: 'unobservable',
    method: (form.getAttribute('method') ?? 'get').toLowerCase(),
    fields: Array.from(form.elements ?? []).slice(0, 1000).map(field => ({
      tag: field.tagName?.toLowerCase(), type: field.getAttribute('type') ?? 'text',
      name: field.getAttribute('name') ?? '', disabled: field.matches(':disabled'),
      required: field.hasAttribute('required'), multiple: field.hasAttribute('multiple'),
      title: field.getAttribute('toolparamtitle') ?? '', description: field.getAttribute('toolparamdescription') ?? '',
      hasParamDescription: field.hasAttribute('toolparamdescription'), autocomplete: field.getAttribute('autocomplete'),
      pattern: field.getAttribute('pattern'), min: field.getAttribute('min'), max: field.getAttribute('max'),
      minlength: field.getAttribute('minlength'), maxlength: field.getAttribute('maxlength'),
      choice: ['radio','checkbox'].includes(field.getAttribute('type')) ? field.getAttribute('value') ?? 'on' : undefined,
      options: field.tagName === 'SELECT' ? Array.from(field.options).slice(0, 500).map(option => ({
        value: option.getAttribute('value') ?? option.textContent, disabled: option.disabled,
      })) : undefined,
    })),
  }));

  const childFrames = Array.from(document.querySelectorAll('iframe')).map((el, index) => ({
    index,
    src: el.getAttribute('src'),
    allow: el.getAttribute('allow'),
    allowsTools: (el.getAttribute('allow') || '').split(';').some((t) => t.trim() === 'tools'),
  }));

  // Chrome removed modelContextTesting in 152: an object of that name now comes from page code.
  let testingApiPresent = false;
  try { testingApiPresent = typeof document.modelContextTesting !== 'undefined' || typeof navigator.modelContextTesting !== 'undefined'; } catch { /* unobservable */ }
  // Ordinary forms of the top document, for starter contracts when no tool is exposed (engine v3).
  // Attributes only, never a value.
  const plainForms = window !== window.top ? [] : Array.from(document.forms).filter((form) => !form.hasAttribute('toolname')).slice(0, 20).map((form) => ({
    id: form.getAttribute('id'), name: form.getAttribute('name'), method: (form.getAttribute('method') ?? 'get').toLowerCase(),
    action: form.getAttribute('action'), toolname: null,
    fields: Array.from(form.elements ?? []).filter((x) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(x.tagName)).slice(0, 100).map((x) => ({
      tag: x.tagName.toLowerCase(), type: x.tagName === 'INPUT' ? (x.getAttribute('type') ?? 'text').toLowerCase() : x.tagName === 'SELECT' && x.multiple ? 'select-multiple' : x.tagName.toLowerCase(),
      name: x.getAttribute('name'), required: x.hasAttribute('required'), disabled: x.matches(':disabled'),
      maxlength: x.getAttribute('maxlength'), minlength: x.getAttribute('minlength'), min: x.getAttribute('min'), max: x.getAttribute('max'),
      autocomplete: x.getAttribute('autocomplete'), toolparamdescription: x.getAttribute('toolparamdescription'),
      label: Array.from(x.labels ?? []).map((l) => l.textContent).join(' ').trim().slice(0, 150) || x.getAttribute('aria-label'),
      options: x.tagName === 'SELECT' ? Array.from(x.options).filter((o) => o.hasAttribute('value')).slice(0, 50).map((o) => o.getAttribute('value')) : undefined,
    })),
  }));

  const base = {
    apiHost: host,
    testingApiPresent,
    plainForms,
    methods,
    polyfillActive: Boolean(mc && mc.__explorerPolyfill),
    originTrialToken: Boolean(document.querySelector('meta[http-equiv="origin-trial" i]')),
    // The tokens themselves (public by nature: every visitor receives them), bounded, so the
    // extension can say which trial each one is for and whether Chrome still honours it. The
    // attribute is kept exactly as written and each element says whether it sits inside <head>:
    // Chrome reads origin-trial meta elements only there, and decodes the text without trimming.
    originTrialTokens: Array.from(document.querySelectorAll('meta[http-equiv="origin-trial" i]')).slice(0, 20)
      .map((m) => ({ token: String(m.getAttribute('content') ?? '').slice(0, 6144), inHead: m.closest('head') !== null }))
      .filter((entry) => entry.token),
    devFlag: false,
    secureContext: window.isSecureContext === true,
    crossOriginIsolated: window.crossOriginIsolated === true,
    // `originAgentCluster` lives on Window, not Document (HTML spec, MDN). On a secure origin it
    // is true unless the server sent `Origin-Agent-Cluster: ?0`; on an insecure one, false.
    originAgentCluster: typeof window.originAgentCluster === 'boolean'
      ? window.originAgentCluster
      : null,
    accessError,
    knownPolicyFeatures,
    toolsPolicyAllowed,
    isTopLevel: window === window.top,
    parentOriginAccessible,
    origin: location.origin,
    href: location.href,
    // Where this frame sits in the tree: the index of each ancestor among its parent's child
    // browsing contexts, top first. `parent.frames` and its indexed members are readable across
    // origins (they are on the Window cross-origin allowlist), so the path is known for every
    // frame, and it is what tells two iframes of one URL apart.
    frameIndexPath: frameIndexPath(),
    declarativeToolNames,
    declarativeForms,
    declarativeAutoSubmitNames,
    childFrames,
    // Instrumentation Mode leaves a map of registration stacks in this frame when it is on.
    // Absent means it was off, which is a different statement from "unknown source" and the
    // interface has to be able to tell them apart.
    instrumented: Boolean(window.__webmcpExplorerInstrumented),
    // Every registerTool() call Instrumentation Mode saw in this frame, with what became of it
    // (core/registrations.js matches them against the tools below).
    registrations: registrationsSeen(),
    tools: [],
    error: null,
  };

  function frameIndexPath() {
    const path = [];
    try {
      let w = window;
      while (w !== w.top) {
        const index = Array.prototype.indexOf.call(w.parent.frames, w);
        if (index < 0) return null;
        path.unshift(index);
        w = w.parent;
      }
    } catch {
      return null;
    }
    return path;
  }

  function registrationsSeen() {
    const store = window.__webmcpExplorerSources;
    if (!store || typeof store.entries !== 'function') return null;
    const out = [];
    for (const [name, entry] of store.entries()) {
      out.push({
        name,
        at: entry.at ?? null,
        registrations: entry.registrations ?? 1,
        stack: entry.stack ?? null,
        emptyDescription: entry.emptyDescription === true,
        outcome: entry.outcome ?? null,
        error: entry.error ?? null,
        promise: entry.promise ?? 'none',
        rejection: entry.rejection ?? null,
        unregisteredAt: entry.unregisteredAt ?? null,
      });
    }
    return out;
  }

  function sourceOf(name) {
    const store = window.__webmcpExplorerSources;
    if (!store || typeof store.get !== 'function') return null;
    const entry = store.get(name);
    if (!entry) return null;
    return { stack: entry.stack ?? null, at: entry.at ?? null,
      registrations: entry.registrations ?? 1 };
  }

  const contexts = [];
  try {
    if (document.modelContext) contexts.push(['document', document.modelContext]);
    if (navigator.modelContext && navigator.modelContext !== document.modelContext) contexts.push(['navigator', navigator.modelContext]);
  } catch { return Promise.resolve(base); }
  return Promise.all(contexts.map(async ([runtimeId, context]) => {
    const nativeExecute = typeof context.executeTool === 'function';
    const tools = typeof context.getTools === 'function'
      ? await context.getTools(fromOrigins ? { fromOrigins } : undefined)
      : !nativeExecute ? window.__webmcpExplorerHook?.getTools(runtimeId) ?? [] : [];
    return Array.from(tools ?? []).map(t => {
      const captured = window.__webmcpExplorerHook?.source(runtimeId, t.name);
      const labels = captured && Array.isArray(callbackPatterns) ? window.__webmcpExplorerHook?.callbackLabels?.(runtimeId, t.name, callbackPatterns, 16384) ?? null : null;
      return {
        name: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? null,
        annotations: { ...(t.annotations ?? {}), ...(captured?.destructiveHint === true ? { destructiveHint: true } : {}) },
        annotationsObserved: captured?.annotationsObserved === true, origin: t.origin ?? location.origin,
        title: t.title ?? '', ownFrame: t.window === undefined ? true : t.window === window,
        runtimeId, schemaEncoding: t.inputSchema == null ? 'missing' : typeof t.inputSchema, executeArity: context.executeTool?.length ?? null,
        hasExecute: nativeExecute, captured: Boolean(captured), emulated: Boolean(context.__explorerPolyfill),
        registrationSource: captured?.registrationSource ?? null,
        exposedTo: captured?.exposedTo ?? null, callbackObservation: labels,
        registrationStack: captured ? { stack: captured.stack, at: captured.at, registrations: captured.registrations } : sourceOf(t.name),
      };
    });
  })).then(lists => ({ ...base, tools: lists.flat() })).catch(error => ({
    ...base, error: String(error?.message ?? error), callError: describeError(error),
  }));
}
