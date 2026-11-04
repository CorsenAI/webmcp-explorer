// Self-contained: Chrome serialises this function into the page's MAIN world. The contract
// is selected BEFORE dispatch, from the qualified string/object surface (CfT 153/155/157).
// An error, even one spelling a Blink binding error, can follow a completed business action.
// There is exactly one dispatch site. No error path calls a tool or changes engines.
export const CALLS_REGISTRY = '__webmcpExplorerCalls';

export function executeToolInPage(toolName, toolOrigin, argsJson, callId, expected = null) {
  const refusal = (code, error) => ({ ok: false, code, error, attempts: 0,
    dispatchState: 'not-dispatched', effectState: 'none' });
  let contexts;
  try {
    const doc = document.modelContext;
    const nav = navigator.modelContext;
    contexts = [['document', doc], ['navigator', nav]].filter(([, mc], i) => mc && (i === 0 || mc !== doc));
  } catch (error) {
    return Promise.resolve(refusal('api-access-denied', String(error?.message ?? error)));
  }
  if (expected?.inventoryOnly) return Promise.resolve(refusal('inventory-only', 'This form is inventory only; native execution is unavailable.'));
  let parsed;
  try { parsed = JSON.parse(argsJson); } catch {
    return Promise.resolve(refusal('invalid-arguments', 'Arguments must be valid JSON. Nothing was invoked.'));
  }
  if (!parsed || typeof parsed !== 'object') return Promise.resolve(refusal('invalid-arguments', 'Arguments must be a JSON object.'));

  const receiptsName = '__webmcpExplorerReceipts';
  const callsName = '__webmcpExplorerCalls';
  for (const name of [receiptsName, callsName]) {
    if (!window[name]) {
      try { Object.defineProperty(window, name, { value: new Map(), enumerable: false, configurable: true }); }
      catch { return Promise.resolve(refusal('invocation-guard-unavailable', 'The page invocation guard could not be installed.')); }
    }
  }
  const receipts = window[receiptsName], calls = window[callsName];
  if (!(receipts instanceof Map) || !(calls instanceof Map)) return Promise.resolve(refusal('invocation-guard-unavailable', 'The page invocation guard is invalid.'));
  const identity = JSON.stringify([toolName, toolOrigin, argsJson, expected]);
  const previous = callId && receipts.get(callId);
  if (previous) return previous.identity === null || previous.identity === identity ? previous.promise
    : Promise.resolve(refusal('request-conflict', 'This request id already belongs to another call.'));
  if (receipts.size >= 10000) return Promise.resolve(refusal('invocation-guard-full', 'Reload and review the page before starting new requests.'));
  const controller = new AbortController();
  if (callId) calls.set(callId, controller);
  let dispatched = false, engine = null, argsEncoding = null;
  const run = async () => {
    const candidates = [], available = [];
    const hook = window.__webmcpExplorerHook;
    for (const [runtimeId, mc] of contexts) {
      if (expected?.runtimeId && expected.runtimeId !== runtimeId) continue;
      const nativeExecute = typeof mc.executeTool === 'function';
      // A rejected native discovery is a refusal, never a reason to invoke a captured callback.
      const tools = typeof mc.getTools === 'function' ? await mc.getTools()
        : (!nativeExecute && hook?.getTools ? hook.getTools(runtimeId) : []);
      for (const tool of Array.from(tools ?? [])) {
        available.push(tool.name);
        if (tool.name === toolName && (!toolOrigin || (tool.origin ?? location.origin) === toolOrigin)) {
          candidates.push({ runtimeId, mc, tool, nativeExecute });
        }
      }
    }
    const owned = candidates.filter(({ tool }) => tool.window === window);
    const ownershipKnown = candidates.some(({ tool }) => tool.window !== undefined);
    const choices = owned.length ? owned : (ownershipKnown ? [] : candidates);
    if (!choices.length) return { ...refusal(candidates.length ? 'tool-not-in-frame' : 'tool-not-found',
      candidates.length ? 'The tool belongs to another frame.' : `Tool "${toolName}" is no longer registered on this page`), available };
    if (choices.length !== 1) return refusal('ambiguous-tool', `${choices.length} tools named "${toolName}" are visible; select an unambiguous runtime and frame.`);
    const { runtimeId, mc, tool, nativeExecute } = choices[0];
    engine = nativeExecute ? (mc.__explorerPolyfill ? 'emulated' : 'native') : 'direct';
    // The worker supplies the pure selector's result when discovery observed a contract.
    // Standalone/demo entrypoints use the same qualified wire shapes, before invoking anything.
    argsEncoding = nativeExecute ? (typeof tool.inputSchema === 'string' ? 'string'
      : tool.inputSchema && typeof tool.inputSchema === 'object' ? 'object'
        : tool.inputSchema == null ? (expected?.argsEncoding ?? (mc.executeTool.length === 1 ? 'object' : mc.executeTool.length === 2 ? 'string' : null)) : null) : 'object';
    if (!['object', 'string'].includes(argsEncoding) || (engine === 'direct' && !hook?.execute)) {
      return refusal('unknown-runtime-contract', 'The execution contract is unknown. Nothing was invoked.');
    }
    if (engine === 'direct') {
      const testing = [document.modelContextTesting, navigator.modelContextTesting];
      if (testing.some(api => typeof api?.executeTool === 'function')) return refusal('unknown-runtime-contract', 'The legacy testing executor is not qualified. Direct execution cannot bypass it.');
      const policy = document.permissionsPolicy ?? document.featurePolicy;
      if (window.isSecureContext === false || (policy?.features?.().includes('tools') && !policy.allowsFeature('tools')))
        return refusal('tools-policy-blocked', 'Direct execution cannot bypass browser policy.');
    }
    if (expected && (expected.engine !== engine || expected.argsEncoding !== argsEncoding)) {
      return refusal('runtime-changed', 'The runtime changed after discovery. Discover and review the tool again.');
    }
    // Bridge approval is bound to the metadata of this exact RegisteredTool, not a name
    // resolved earlier in the worker. No await between this check and native dispatch.
    if (expected?.reviewedMetadata) {
      const canonical = value => {
        if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
        if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
        return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
      };
      let schema = tool.inputSchema ?? null;
      if (typeof schema === 'string') { try { schema = JSON.parse(schema); } catch { return refusal('reviewed-contract-changed', 'The reviewed schema is no longer available.'); } }
      const metadata = canonical([tool.name,tool.origin ?? location.origin,tool.title ?? '',tool.description ?? '',schema,
        ['readOnlyHint','consequentialHint','untrustedContentHint','debugging'].map(k => tool.annotations?.[k] === true)]);
      const captured = hook?.source?.(runtimeId,tool.name);
      if (metadata !== expected.reviewedMetadata || (expected.requireCapturedAnnotations && !captured?.annotationsObserved)
        || (expected.reviewedDestructive !== undefined && expected.reviewedDestructive !== (captured?.destructiveHint === true || tool.annotations?.destructiveHint === true))) {
        return refusal('reviewed-contract-changed', 'The approved tool contract changed. Nothing was invoked.');
      }
    }
    if (controller.signal.aborted) return { ...refusal('cancelled', 'Cancelled before dispatch.'), cancelled: true, durationMs: 0 };
    const startedAt = performance.now();
    const trace = () => ({ engine, runtimeId, argsEncoding, attempts: 1, dispatchState: 'dispatched',
      durationMs: Math.round(performance.now() - startedAt) });
    try {
      dispatched = true;
      const result = nativeExecute
        ? await mc.executeTool(tool, argsEncoding === 'string' ? argsJson : parsed, { signal: controller.signal })
        : await new Promise((resolve,reject) => {
          const signal=controller.signal;
          const abort=()=>reject(signal.reason ?? new DOMException('Cancelled','AbortError'));
          signal.addEventListener('abort',abort,{once:true});
          Promise.resolve().then(()=>hook.execute(runtimeId,tool.name,parsed,{signal}))
            .then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
        });
      const navigated = engine !== 'direct' && (result === null || result === undefined);
      return { ok: true, result: navigated ? null : typeof result === 'object' ? JSON.stringify(result) : String(result),
        navigated, ...trace(), effectState: navigated ? 'unknown' : 'reported' };
    } catch (error) {
      const cancelled = controller.signal.aborted || error?.name === 'AbortError';
      return { ok: false, code: cancelled ? 'cancelled' : 'tool-threw', ...(cancelled ? { cancelled: true } : {}),
        error: String(error?.message ?? error), ...trace(), effectState: 'unknown' };
    }
  };
  const promise = Promise.resolve().then(run).catch(error => ({
    ...refusal('discovery-failed', String(error?.message ?? error)),
    ...(dispatched ? { dispatchState: 'dispatched', effectState: 'unknown', attempts: 1, engine, argsEncoding } : {}),
  })).then(outcome => {
    // Keep a small tombstone, not a resolved promise retaining potentially huge page results
    // and private arguments for the lifetime of the document. In-flight duplicates still share.
    if (callId) receipts.set(callId,{identity:null,promise:Promise.resolve({
      ...refusal('already-invoked','This request already settled and will not be replayed.'),
      effectState:outcome.effectState === 'none' ? 'none' : 'unknown',replayBlocked:true,
    })});
    return outcome;
  }).finally(() => { if (callId) calls.delete(callId); });
  if (callId) receipts.set(callId, { identity, promise });
  return promise;
}

export function cancelToolInPage(callId) {
  const controller = window.__webmcpExplorerCalls?.get?.(callId);
  if (!controller) return { found: false };
  controller.abort();
  return { found: true };
}
