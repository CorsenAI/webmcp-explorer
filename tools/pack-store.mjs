// Packages src/ — and only src/ — into the zip the Chrome Web Store takes. Zero dependencies:
// the zip container is a hundred lines of format, and zlib's deflate does the compression.
//
// Reproducible on purpose: entries are sorted, timestamps are fixed to the commit's own date
// when available, and nothing outside src/ can end up in the archive — not the tests, not the
// fixtures, not the reference repos. What is uploaded is exactly what was checked.
//
// Usage: node tools/pack-store.mjs            → dist/webmcp-explorer-<version>.zip

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const SRC = 'src';
const OUT_DIR = 'dist';

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

// The source commit date: documentation and evidence commits must not change the package.
// UTC below makes the same source reproducible regardless of the packer's timezone.
function stamp() {
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', SRC], { encoding: 'utf8' }).trim();
    if (iso) return new Date(iso);
  } catch {
    // Not a git checkout, or git is absent; the date is only for reproducibility.
  }
  return new Date();
}

// MS-DOS date and time, which is what the zip format stores.
function dosDateTime(date) {
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const day = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, day };
}

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
const when = stamp();
const { time, day } = dosDateTime(when);

const locals = [];
const centrals = [];
let offset = 0;

for (const file of walk(SRC)) {
  // Forward slashes and paths relative to the package root, as the Store expects.
  const name = relative(SRC, file).split(sep).join('/');
  const data = readFileSync(file);
  const compressed = deflateRawSync(data, { level: 9 });
  // Deflate only when it actually helps; a PNG grows under it.
  const useDeflate = compressed.length < data.length;
  const body = useDeflate ? compressed : data;
  const method = useDeflate ? 8 : 0;
  const crc = crc32(data) >>> 0;
  const nameBytes = Buffer.from(name, 'utf8');

  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0x0800), u16(method), u16(time), u16(day),
    u32(crc), u32(body.length), u32(data.length), u16(nameBytes.length), u16(0),
    nameBytes, body,
  ]);
  const central = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(method), u16(time), u16(day),
    u32(crc), u32(body.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0),
    u16(0), u16(0), u32(0), u32(offset), nameBytes,
  ]);

  locals.push(local);
  centrals.push(central);
  offset += local.length;
}

const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.concat([
  u32(0x06054b50), u16(0), u16(0), u16(centrals.length), u16(centrals.length),
  u32(centralSize), u32(offset), u16(0),
]);

const zip = Buffer.concat([...locals, ...centrals, end]);
mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, `webmcp-explorer-${manifest.version}.zip`);
writeFileSync(out, zip);
console.log(`${out}  ${locals.length} files  ${zip.length} bytes  (${when.toISOString()})`);
