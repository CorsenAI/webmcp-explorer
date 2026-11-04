// Explicit per-site opt-in, MAIN world, document_start. Observation never changes the
// original return value or catches a rejected promise: unhandledrejection remains observable.
(() => {
  'use strict';
  if (window.__webmcpExplorerInstrumented) return;
  let contexts;
  try {
    const doc = document.modelContext, nav = navigator.modelContext;
    contexts = [['document', doc], ['navigator', nav]].filter(([, mc], i) => mc && (i === 0 || mc !== doc));
  } catch { return; }
  const sources = new Map(), captured = new Map(), pending = new WeakMap();
  const snapshots = (runtimeId) => [...captured.values()].filter(x => x.runtimeId === runtimeId
    && x.entry.outcome === 'returned' && x.entry.promise === 'none' && !x.entry.unregisteredAt);
  const metadata = x => ({ ...structuredClone(x.metadata), origin: location.origin, window,
    registrationSource: x.source, registrationStack: { stack: x.entry.stack, at: x.entry.at } });
  let patched = 0;
  const errorText = error => { try { return String(error?.message ?? error); } catch { return 'Unobservable error detail'; } };
  const note = (entry, values) => { try { Object.assign(entry, values); } catch { /* observation only */ } };
  const retire = entry => {
    note(entry,{unregisteredAt:Date.now()});
    const current=captured.get(entry.captureKey);
    if(current?.entry===entry){current.callback=null;current.descriptor=null;current.metadata=null;}
  };
  for (const [runtimeId, mc] of contexts) {
    for (const method of ['registerTool', 'unregisterTool', 'provideContext', 'clearContext']) {
      if (typeof mc[method] !== 'function') continue;
      const original = mc[method];
      function wrapped(...args) {
        let descriptors = [];
        try { descriptors = method === 'registerTool' ? [args[0]]
          : method === 'provideContext' ? (Array.isArray(args[0]?.tools) ? args[0].tools : []) : []; } catch { /* observation only */ }
        const entries = [], captures = [];
        try {
          for (const descriptor of descriptors) {
            if (!descriptor || typeof descriptor.name !== 'string') continue;
            const key = `${runtimeId}:${descriptor.name}`, old = captured.get(key)?.entry;
            const stack = new Error().stack ?? null;
            const entry = { stack: old?.stack ?? stack, lastStack: stack, at: old?.at ?? Date.now(),
              registrations: (old?.registrations ?? 0) + 1, emptyDescription: !descriptor.description?.trim?.(),
              outcome: null, error: null, promise: 'none', rejection: null, unregisteredAt: null, runtimeId, captureKey:key };
            const source = method === 'provideContext' ? 'provideContext-legacy'
              : runtimeId === 'document' ? 'imperative-document' : 'imperative-navigator-legacy';
            const metadata = structuredClone({name:descriptor.name,description:descriptor.description ?? '',
              title:descriptor.title ?? '',inputSchema:descriptor.inputSchema ?? {type:'object'},annotations:descriptor.annotations ?? {}});
            captures.push({key,value:{runtimeId,descriptor,metadata,callback:descriptor.execute,entry,source}});
            // Compatibility snapshot for the existing Source / registration diagnosis views.
            sources.set(runtimeId === 'document' || !sources.has(descriptor.name) ? descriptor.name : key, entry);
            entries.push(entry);
          }
        } catch { /* a hostile descriptor cannot break the original registration */ }
        let result;
        try { result = Reflect.apply(original, this, args); }
        catch (error) {
          entries.forEach(e => note(e, { outcome: 'threw', error: errorText(error) }));
          throw error;
        }
        for (const {key,value} of captures) captured.set(key,value);
        for (const entry of entries) {
          note(entry, { outcome: 'returned' });
          try {
            if (result && typeof result.then === 'function') {
              note(entry, { promise: 'pending' }); pending.set(result, entries);
            }
          } catch { note(entry, { promise: 'unobservable' }); }
          try {
            const signal = args[1]?.signal;
            if (signal?.aborted) retire(entry);
            else signal?.addEventListener?.('abort', () => retire(entry), { once: true });
          } catch { /* observer failures must not change the original return */ }
        }
        try {
        if (method === 'unregisterTool') {
          const entry = captured.get(`${runtimeId}:${args[0]}`)?.entry;
          if (entry) retire(entry);
        }
        if (method === 'clearContext' || method === 'provideContext') {
          for (const x of captured.values()) {
            if (x.runtimeId === runtimeId && !entries.includes(x.entry)) retire(x.entry);
          }
        }
        } catch { /* removal observation cannot change the original return */ }
        return result;
      }
      try {
        Object.defineProperty(wrapped, 'name', { value: method });
        Object.defineProperty(wrapped, 'length', { value: original.length });
        wrapped.toString = () => Function.prototype.toString.call(original);
        Object.defineProperty(mc, method, { value: wrapped, configurable: true, writable: true,
          enumerable: Object.prototype.propertyIsEnumerable.call(mc, method) });
        patched++;
      } catch { /* leave non-writable methods alone */ }
    }
  }
  if (!patched) return;
  window.addEventListener('unhandledrejection', event => {
    for (const entry of pending.get(event.promise) ?? []) {
      note(entry, { promise: 'rejected', rejection: errorText(event.reason) });
    }
  });
  // MAIN-world state is not a security boundary. Only metadata leaves this closure; page
  // scripts already control their own callbacks. No path here can invoke extension APIs.
  const hook = Object.freeze({
    getTools: runtimeId => snapshots(runtimeId).map(metadata),
    source: (runtimeId, name) => {
      const x = captured.get(`${runtimeId}:${name}`);
      return x ? { ...x.entry, registrationSource: x.source, annotationsObserved: !!x.metadata,
        ...(x.metadata?.annotations?.destructiveHint === true ? { destructiveHint: true } : {}) } : null;
    },
    execute(runtimeId, name, args, options) {
      const x = snapshots(runtimeId).find(x => x.metadata.name === name);
      if (!x || typeof x.callback !== 'function') throw Error('The captured registration is not confirmed or is no longer available.');
      const mc = contexts.find(([id]) => id === runtimeId)?.[1];
      if (typeof mc?.executeTool === 'function') throw Error('Direct execution cannot bypass a native executor.');
      if (options?.signal?.aborted) throw options.signal.reason;
      return Reflect.apply(x.callback, x.descriptor, [args, { signal: options?.signal }]);
    },
  });
  for (const [name, value] of [['__webmcpExplorerSources', sources], ['__webmcpExplorerHook', hook], ['__webmcpExplorerInstrumented', true]]) {
    Object.defineProperty(window, name, { value, enumerable: false, configurable: true });
  }
})();
