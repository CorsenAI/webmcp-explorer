// Optional imperative emulation only. Never replaces native WebMCP, never submits a form,
// never creates a native-looking agentInvoked/respondWith event or grants browser policy.
(() => {
  if (!window.isSecureContext) return;
  try {
    if (document.modelContext || navigator.modelContext) return;
    if (window !== window.top && window.parent.location.origin !== location.origin) return;
    const policy = document.permissionsPolicy ?? document.featurePolicy;
    if (policy?.features?.().includes('tools') && !policy.allowsFeature('tools')) return;
  } catch { return; }
  class ExplorerModelContext extends EventTarget {
    #tools = new Map();
    constructor() { super(); Object.defineProperty(this, '__explorerPolyfill', { value: true }); }
    registerTool(descriptor, options = {}) {
      if (!descriptor || typeof descriptor.name !== 'string' || !descriptor.name || typeof descriptor.execute !== 'function') {
        throw new TypeError('A tool needs a name and an execute callback.');
      }
      if (this.#tools.has(descriptor.name)) throw new DOMException('Tool name already registered.', 'InvalidStateError');
      if (options.signal?.aborted) return Promise.reject(options.signal.reason);
      if (options.exposedTo?.length) throw new DOMException('Cross-origin exposure is not emulated.', 'NotSupportedError');
      const metadata = structuredClone({ name: descriptor.name, description: descriptor.description ?? '',
        title: descriptor.title ?? '', inputSchema: descriptor.inputSchema ?? { type: 'object' },
        annotations: descriptor.annotations ?? {} });
      const entry = { metadata, callback: descriptor.execute };
      this.#tools.set(metadata.name, entry);
      options.signal?.addEventListener('abort', () => {
        if (this.#tools.get(metadata.name) !== entry) return;
        this.#tools.delete(metadata.name); this.dispatchEvent(new Event('toolchange'));
      }, { once: true });
      this.dispatchEvent(new Event('toolchange'));
      return Promise.resolve();
    }
    getTools(options = {}) {
      if (options.fromOrigins?.some(origin => origin !== location.origin)) {
        return Promise.reject(new DOMException('Cross-origin discovery is not emulated.', 'NotSupportedError'));
      }
      return Promise.resolve([...this.#tools.values()].map(({ metadata }) => ({ ...structuredClone(metadata), origin: location.origin, window })));
    }
    executeTool(tool, input = {}, options = {}) {
      const entry = this.#tools.get(tool?.name);
      if (!entry || tool.window !== window || tool.origin !== location.origin) return Promise.reject(new TypeError('A tool from this document is required.'));
      if (!input || typeof input !== 'object') return Promise.reject(new TypeError('Object arguments required.'));
      const signal = options.signal;
      if (signal?.aborted) return Promise.reject(signal.reason);
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
        signal?.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(() => {
          if (signal?.aborted) throw signal.reason;
          return entry.callback(structuredClone(input), { signal });
        }).then(result => typeof result === 'string' ? result : JSON.stringify(result) ?? 'undefined')
          .then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
      });
    }
  }
  Object.defineProperty(document, 'modelContext', { value: new ExplorerModelContext(), configurable: true });
})();
