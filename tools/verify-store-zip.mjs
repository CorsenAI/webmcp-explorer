// Reads a Store zip back, independently of the code that wrote it, and compares every entry with
// src/. tools/pack-store.mjs writes the archive and tools/check-store-build.mjs examines the
// sources; until this script, nothing had ever opened the zip that is actually uploaded.
//
//   node tools/verify-store-zip.mjs [dist/webmcp-explorer-<version>.zip]
//
// It walks the central directory, inflates each entry with zlib, hashes it, and reports files
// that are missing from the zip, present in the zip but absent from src/, or different. The
// manifest inside the zip must carry the version the file name says. Exit 0 only when the zip
// is exactly src/.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const SRC = 'src';
const manifestVersion = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8')).version;
const zipPath = process.argv[2] ?? join('dist', `webmcp-explorer-${manifestVersion}.zip`);
if (!existsSync(zipPath)) {
  console.error(`no such zip: ${zipPath}`);
  process.exit(2);
}
const zip = readFileSync(zipPath);
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

// End of central directory: the last 22 bytes when there is no comment; searched backwards.
let eocd = -1;
for (let i = zip.length - 22; i >= 0; i -= 1) {
  if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) {
  console.error('not a zip: no end-of-central-directory record');
  process.exit(2);
}
const entryCount = zip.readUInt16LE(eocd + 10);
const centralSize = zip.readUInt32LE(eocd + 12);
const centralOffset = zip.readUInt32LE(eocd + 16);

const entries = new Map();
let cursor = centralOffset;
for (let n = 0; n < entryCount; n += 1) {
  if (zip.readUInt32LE(cursor) !== 0x02014b50) {
    console.error(`central directory entry ${n} is corrupt`);
    process.exit(2);
  }
  const method = zip.readUInt16LE(cursor + 10);
  const crc = zip.readUInt32LE(cursor + 16);
  const compressedSize = zip.readUInt32LE(cursor + 20);
  const size = zip.readUInt32LE(cursor + 24);
  const nameLength = zip.readUInt16LE(cursor + 28);
  const extraLength = zip.readUInt16LE(cursor + 30);
  const commentLength = zip.readUInt16LE(cursor + 32);
  const localOffset = zip.readUInt32LE(cursor + 42);
  const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
  cursor += 46 + nameLength + extraLength + commentLength;

  // Local header: its own name and extra lengths decide where the data starts.
  if (zip.readUInt32LE(localOffset) !== 0x04034b50) {
    console.error(`local header of ${name} is corrupt`);
    process.exit(2);
  }
  const localNameLength = zip.readUInt16LE(localOffset + 26);
  const localExtraLength = zip.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const raw = zip.subarray(dataStart, dataStart + compressedSize);
  let data;
  if (method === 0) data = raw;
  else if (method === 8) data = inflateRawSync(raw);
  else {
    console.error(`${name}: unsupported compression method ${method}`);
    process.exit(2);
  }
  if (data.length !== size) {
    console.error(`${name}: inflated to ${data.length} bytes, header says ${size}`);
    process.exit(2);
  }
  entries.set(name, { data, crc, method });
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const sources = new Map(walk(SRC).map((file) => [relative(SRC, file).split(sep).join('/'), readFileSync(file)]));
const problems = [];
for (const [name, buffer] of sources) {
  const entry = entries.get(name);
  if (!entry) { problems.push(`missing from the zip: ${name}`); continue; }
  if (sha256(entry.data) !== sha256(buffer)) problems.push(`differs from src/: ${name}`);
}
for (const name of entries.keys()) {
  if (!sources.has(name)) problems.push(`in the zip but not in src/: ${name}`);
}

const zippedManifest = entries.get('manifest.json');
const zippedVersion = zippedManifest ? JSON.parse(zippedManifest.data.toString('utf8')).version : null;
if (zippedVersion !== manifestVersion) problems.push(`manifest version in the zip is ${zippedVersion}, src/ says ${manifestVersion}`);
if (!basename(zipPath).includes(zippedVersion ?? '')) problems.push(`the file name ${basename(zipPath)} does not carry the zipped version ${zippedVersion}`);
if (entryCount !== entries.size || centralSize <= 0) problems.push('central directory count does not match the entries read');

console.log(`${zipPath}: ${entries.size} entries read back, ${sources.size} files in src/, manifest ${zippedVersion}, sha256 ${sha256(zip)}`);
if (problems.length) {
  for (const problem of problems) console.log(`  x ${problem}`);
  console.log(`${problems.length} problem${problems.length === 1 ? '' : 's'} — the zip is not src/.`);
  process.exit(1);
}
console.log('every entry matches src/ byte for byte; nothing extra, nothing missing.');
