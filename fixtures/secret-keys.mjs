// Synthetic provider keys for the WMCP-SEC-013 fixture, assembled at run time so that no file in this
// repository contains a key format that secret scanners would flag. None of them is real.
export const FIXTURE_KEYS = Object.freeze({
  stripeLive: ['sk', 'live', 'F'.repeat(24)].join('_'),
  stripePublishable: ['pk', 'live', 'F'.repeat(24)].join('_'),
  github: ['gh', 'p_'].join('') + 'F'.repeat(36),
});

export function secretsPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Provider keys fixture</title></head><body>
<h1>Provider keys fixture</h1><p>Synthetic keys assembled by the fixture server. None is real.</p>
<script>window.fixtureCheckout = { secret: "${FIXTURE_KEYS.stripeLive}", publishable: "${FIXTURE_KEYS.stripePublishable}" };</script>
<script src="/secrets.js"></script>
<script src="http://127.0.0.1:8788/secrets.js"></script>
</body></html>`;
}

export const secretsScript = () => `window.fixtureRepo = "${FIXTURE_KEYS.github}";\n`;
