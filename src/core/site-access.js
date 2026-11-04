// Reads Chrome's own list of granted origins into something a person can act on. Pure
// JavaScript: no chrome.* API.
//
// Chrome's grant is the only source of truth (D-014); this module only describes it. Three
// kinds of grant exist in Explorer's life: the broad ones the user opted into ("all websites"),
// the sites they enabled one by one, and the origins of the model endpoints they configured
// (D-036). They are told apart here so the screen can name each for what it is.

const ALL_HTTPS = 'https://*/*';
const ALL_HTTP = 'http://*/*';

function hostOf(pattern) {
  const m = String(pattern).match(/^(https?):\/\/([^/]+)\/\*$/);
  return m ? { scheme: m[1], host: m[2] } : null;
}

// Which provider, if any, lives at this host — by the base URLs of the catalogue, so a new
// provider is recognised without touching this file.
function providerAt(host, providers) {
  for (const provider of providers) {
    if (!provider.baseUrl) continue;
    try {
      if (new URL(provider.baseUrl).host === host) return provider;
    } catch {
      // A provider without a usable base URL is the user's own endpoint.
    }
  }
  return null;
}

export function describeGrants(origins = [], providers = []) {
  const patterns = [...new Set(origins)];
  const all = {
    https: patterns.includes(ALL_HTTPS),
    http: patterns.includes(ALL_HTTP),
  };
  const sites = [];
  const endpoints = [];
  const other = [];

  for (const pattern of patterns) {
    if (pattern === ALL_HTTPS || pattern === ALL_HTTP) continue;
    const parsed = hostOf(pattern);
    if (!parsed) {
      other.push({ pattern, label: pattern });
      continue;
    }
    const provider = providerAt(parsed.host, providers);
    if (provider) {
      endpoints.push({ pattern, host: parsed.host, scheme: parsed.scheme, provider: provider.label, label: `${parsed.host} — ${provider.label}` });
    } else {
      sites.push({ pattern, host: parsed.host, scheme: parsed.scheme,
        label: parsed.scheme === 'https' ? parsed.host : `${parsed.scheme}://${parsed.host}` });
    }
  }

  const byLabel = (a, b) => a.label.localeCompare(b.label);
  return {
    all,
    allSites: all.https && all.http,
    sites: sites.sort(byLabel),
    endpoints: endpoints.sort(byLabel),
    other: other.sort(byLabel),
    total: patterns.length,
  };
}

export const ALL_SITES_PATTERNS = [ALL_HTTPS, ALL_HTTP];
