// A minimal WebMCP implementation, for the bundled demo page only.
//
// It exists so that someone who installs Explorer on a Chrome without the WebMCP flag can see
// what the product does instead of reading "unavailable" and uninstalling. It is never
// injected into a website — it ships inside this one extension page and nowhere else.
//
// It identifies itself. `__explorerPolyfill` is the flag Explorer's probe already looks for,
// so every screen reports "A polyfill is providing WebMCP" rather than "Native". A demo that
// passed itself off as the real implementation would break the rule the whole product rests
// on: native WebMCP is the source of truth, and Explorer must never hide the difference.

class DemoModelContext extends EventTarget {
  constructor() {
    super();
    this.__explorerPolyfill = true;
    this._tools = new Map();
  }

  registerTool(descriptor, options = {}) {
    if (!descriptor || typeof descriptor.name !== 'string' || !descriptor.name) {
      throw new TypeError('registerTool requires a descriptor with a name');
    }

    const tool = {
      name: descriptor.name,
      description: descriptor.description ?? '',
      // Chrome 152 hands the schema over as a JSON string (D-025). The demo reproduces that
      // faithfully, or it would exercise a code path the real browser never takes.
      inputSchema: descriptor.inputSchema === undefined || descriptor.inputSchema === null
        ? null
        : JSON.stringify(descriptor.inputSchema),
      annotations: descriptor.annotations ?? {},
      origin: location.origin,
      title: descriptor.title ?? '',
      window,
      _execute: descriptor.execute,
    };

    this._tools.set(tool.name, tool);
    this.dispatchEvent(new Event('toolchange'));

    const signal = options.signal;
    if (signal) {
      signal.addEventListener('abort', () => {
        this._tools.delete(tool.name);
        this.dispatchEvent(new Event('toolchange'));
      }, { once: true });
    }
    return undefined;
  }

  getTools() {
    return Promise.resolve([...this._tools.values()]);
  }

  // Mirrors what Chrome 152 and 153 were measured to do (tools/probe-platform.mjs): a JSON
  // string in, a string out — an object result is serialised as JSON, not stringified — and an
  // aborted signal settles the caller with an AbortError at once. Like Chrome 153, the signal is
  // handed to the tool's execute as well, so a demo tool can stop its own work.
  executeTool(tool, argsJson, options = {}) {
    const known = this._tools.get(tool?.name);
    if (!known) return Promise.reject(new Error(`Tool "${tool?.name}" is not registered`));

    let args = {};
    if (typeof argsJson === 'string' && argsJson.trim()) {
      try {
        args = JSON.parse(argsJson);
      } catch (cause) {
        return Promise.reject(new Error(`Arguments are not valid JSON: ${cause.message}`));
      }
    } else if (argsJson && typeof argsJson === 'object') {
      args = argsJson;
    }

    const signal = options?.signal ?? null;
    const abortError = () => signal?.reason
      ?? new DOMException('signal is aborted without reason', 'AbortError');
    if (signal?.aborted) return Promise.reject(abortError());

    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError());
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve()
        .then(() => known._execute(args, { signal }))
        .then((result) => {
          if (result === null || result === undefined) return null;
          return typeof result === 'object' ? JSON.stringify(result) : String(result);
        })
        .then(resolve, reject)
        .finally(() => { if (signal) signal.removeEventListener('abort', onAbort); });
    });
  }
}

// On a flag-enabled Chrome the native object is present on an extension page and unusable:
// getTools() REJECTS with "document.modelContext cannot be used when document.domain is
// enabled". It rejects rather than throwing synchronously, which is why the check has to be
// asynchronous — a try/catch around the bare call sees nothing and concludes it works.
async function nativeWorks() {
  const mc = document.modelContext;
  if (!mc || typeof mc.getTools !== 'function' || typeof mc.registerTool !== 'function') {
    return false;
  }
  try {
    await mc.getTools();
    return true;
  } catch {
    return false;
  }
}

// Awaited by the page before it registers anything, so nothing is ever registered against a
// context that cannot answer.
export async function ensureModelContext() {
  if (await nativeWorks()) return document.modelContext;
  try {
    Object.defineProperty(document, 'modelContext', {
      value: new DemoModelContext(),
      configurable: true,
      enumerable: false,
    });
  } catch {
    // Nothing else can be done here, and pretending otherwise would leave the page broken in
    // a way nobody could diagnose.
    throw new Error('WebMCP is unavailable and the demo implementation could not be installed.');
  }
  return document.modelContext;
}
