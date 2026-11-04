// Turning a configured base URL plus a dialect path into the URL to call. Pure.
//
// It looks trivial and is not. A base URL is allowed to carry a query string — Azure OpenAI
// requires ?api-version=, and gateways use one for routing — so appending the path to the
// base *string* buries /chat/completions inside the query and the endpoint answers 404.
// Found by the agent E2E scenario, which drives the mock endpoint through ?mode= flags.

// The only hosts allowed to be reached over plain http. A key and every prompt travel in the
// request; over http to anywhere else they travel in clear (D-051).
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackHost(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  return LOOPBACK.has(host) || host.endsWith('.localhost');
}

// Why an endpoint cannot be used at all, as a stable code, or null when it can.
export function endpointBlocker(base) {
  let url;
  try {
    url = new URL(String(base ?? ''));
  } catch {
    return 'invalid-endpoint';
  }
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:') return isLoopbackHost(url.hostname) ? null : 'insecure-remote-endpoint';
  return 'unsupported-scheme';
}

export function joinEndpoint(base, path) {
  const blocker = endpointBlocker(base);
  if (blocker === 'invalid-endpoint') {
    return { ok: false, error: `The endpoint address is not a valid URL: ${base}` };
  }
  if (blocker === 'unsupported-scheme') {
    return { ok: false, error: `The endpoint must be http or https: ${base}` };
  }
  // Refused here, at the one place every request URL is built, so no code path can send a
  // key over plain http to a remote host by accident. Local Ollama and LM Studio are loopback
  // and unaffected.
  if (blocker === 'insecure-remote-endpoint') {
    return {
      ok: false,
      error: 'This endpoint is plain http and not on your machine. The key and every prompt '
        + 'would travel unencrypted, so Explorer will not send them. Use https.',
    };
  }
  const url = new URL(String(base));
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`;
  return { ok: true, url: url.toString() };
}
