// The gate the exact Store build has to pass before it is packaged.
//
// The E2E suite runs against a test build with pre-granted origins, because chrome.permissions
// bubbles cannot be accepted by a script. This checks the thing that actually ships — src/ as
// it is — for the mistakes a reviewer would find and the tests cannot: a manifest that names a
// missing file, a permission that crept in, a locale placeholder with no message behind it, a
// remote script, a string executed as code. Every finding is a line; a clean build prints
// nothing but the summary and exits 0.
//
// Usage: node tools/check-store-build.mjs

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = 'src';
const findings = [];
const note = (file, text) => findings.push(`${file}: ${text}`);

// The patterns for "runs a string as code" are assembled rather than written out, so that this
// file — which looks for them — is not itself flagged by tooling that looks for the same words.
const FORBIDDEN = [
  [new RegExp(`\\b${'ev' + 'al'}\\s*\\(`), 'evaluates a string as code'],
  [new RegExp(`new\\s+${'Func' + 'tion'}\\s*\\(`), 'builds a function from a string'],
  [/\.(inner|outer)HTML\s*=/, 'assigns innerHTML/outerHTML (D-019 forbids it)'],
  [/insertAdjacentHTML\(/, 'uses insertAdjacentHTML (D-019 forbids it)'],
  [/<script[^>]+src=["']https?:/, 'loads a remote script'],
  [/\bdebugger\b/, 'contains a debugger statement'],
  [/sk-[A-Za-z0-9]{20,}/, 'contains what looks like an API key'],
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

// --- manifest -------------------------------------------------------------------------------

const manifestPath = join(SRC, 'manifest.json');
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  note(manifestPath, `does not parse: ${error.message}`);
}

let messages = {};
const localePath = join(SRC, '_locales', 'en', 'messages.json');
try {
  messages = JSON.parse(readFileSync(localePath, 'utf8'));
} catch (error) {
  note(localePath, `does not parse: ${error.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) note(manifestPath, 'manifest_version must be 3');
  if (!/^\d+(\.\d+){1,3}$/.test(manifest.version ?? '')) {
    note(manifestPath, `version "${manifest.version}" is not a Store version`);
  }
  if (!manifest.default_locale) note(manifestPath, 'default_locale is required when names use __MSG_');

  // The permission set is part of the product's promise. Anything else is a regression.
  // alarms: the optional, off-by-default re-check of open tabs (S3, D-127); no install warning.
  const ALLOWED = new Set(['sidePanel', 'storage', 'scripting', 'activeTab', 'alarms']);
  for (const p of manifest.permissions ?? []) {
    if (!ALLOWED.has(p)) note(manifestPath, `unexpected permission "${p}"`);
  }
  if (manifest.host_permissions?.length) {
    note(manifestPath, 'host_permissions must stay empty: access is optional and per origin');
  }
  const optional = manifest.optional_host_permissions ?? [];
  if (!optional.includes('https://*/*') || !optional.includes('http://*/*')) {
    note(manifestPath, 'optional_host_permissions must offer https://*/* and http://*/*');
  }

  const csp = manifest.content_security_policy?.extension_pages ?? '';
  if (!/script-src 'self'/.test(csp) || /unsafe|http/.test(csp)) {
    note(manifestPath, `extension_pages CSP is not strict: "${csp}"`);
  }

  // Every file the manifest points at must exist in the package.
  const refs = [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ].filter(Boolean);
  for (const ref of refs) {
    if (!existsSync(join(SRC, ref))) note(manifestPath, `references missing file ${ref}`);
  }

  // __MSG_ placeholders resolve.
  for (const value of [manifest.name, manifest.description, manifest.action?.default_title]) {
    const m = String(value ?? '').match(/^__MSG_(\w+)__$/);
    if (m && !messages[m[1]]) note(manifestPath, `__MSG_${m[1]}__ has no message`);
  }
}

// --- locale ----------------------------------------------------------------------------------

const localesDir = join(SRC, '_locales');
const localeDirs = existsSync(localesDir)
  ? readdirSync(localesDir).filter((d) => statSync(join(localesDir, d)).isDirectory()).sort()
  : [];

const placeholdersOf = (str) => (String(str ?? '').match(/\$[1-9]/g) ?? []).sort().join(',');

for (const lang of localeDirs) {
  const path = join(localesDir, lang, 'messages.json');
  let dict = {};
  try {
    dict = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    note(path, `does not parse: ${error.message}`);
    continue;
  }
  for (const [key, value] of Object.entries(dict)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) note(path, `key "${key}" is not a valid message name`);
    if (typeof value?.message !== 'string' || !value.message.trim()) {
      note(path, `key "${key}" has no message`);
    }
    // A stray $ — anything but $$ or $1…$9 — can fail the locale, and with it the extension.
    if (/(?<!\$)\$(?!\$|\d)/.test(value?.message ?? '')) note(path, `key "${key}" has an unescaped $`);
    if (lang !== 'en' && messages[key]) {
      const expectedPh = placeholdersOf(messages[key].message);
      const actualPh = placeholdersOf(value?.message);
      if (expectedPh !== actualPh) {
        note(path, `key "${key}" placeholders (${actualPh || 'none'}) do not match en (${expectedPh || 'none'})`);
      }
    }
  }
  if (lang !== 'en') {
    for (const key of Object.keys(messages)) {
      if (!dict[key]) note(path, `missing key "${key}" present in en`);
    }
  }
}

// --- sources -------------------------------------------------------------------------------

const files = walk(SRC);
const usedKeys = new Set();
for (const file of files) {
  const rel = relative('.', file);
  const ext = file.split('.').pop();
  if (!['js', 'html', 'css', 'json', 'png'].includes(ext)) {
    note(rel, `unexpected file type .${ext} in the package`);
  }
  if (ext !== 'js' && ext !== 'html') continue;

  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) usedKeys.add(m[1]);

  for (const [pattern, why] of FORBIDDEN) {
    if (pattern.test(text)) note(rel, why);
  }
  if (/console\.(log|debug)\(/.test(text) && !file.includes('demo')) {
    note(rel, 'leaves console.log/debug in shipped code');
  }
  if (text.includes(String.fromCharCode(0))) note(rel, 'contains a NUL byte');
}

for (const key of usedKeys) {
  if (!messages[key]) note(localePath, `t('${key}') is used but not defined`);
}

// --- verdict ---------------------------------------------------------------------------------

console.log(`store build: ${files.length} files, ${Object.keys(messages).length} messages, `
  + `${usedKeys.size} keys referenced, manifest v${manifest?.version ?? '?'}`);
if (findings.length) {
  console.log('');
  for (const f of findings) console.log(`  x ${f}`);
  console.log(`\n${findings.length} finding${findings.length === 1 ? '' : 's'} — not ready to package.`);
  process.exit(1);
}
console.log('no findings — ready to package.');
