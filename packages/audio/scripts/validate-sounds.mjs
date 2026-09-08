#!/usr/bin/env node
// Sanity-checks every generated WAV: valid RIFF/WAVE header and a
// non-silent peak amplitude. Run after generate-sounds.mjs. Exits 1 on
// any failure so it can gate CI later.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, '..', 'assets');

let failed = false;
for (const name of readdirSync(DIR).filter((f) => f.endsWith('.wav')).sort()) {
  const buf = readFileSync(join(DIR, name));
  const riff = buf.toString('ascii', 0, 4);
  const wave = buf.toString('ascii', 8, 12);
  const dataTag = buf.toString('ascii', 36, 40);
  if (riff !== 'RIFF' || wave !== 'WAVE' || dataTag !== 'data') {
    console.error(`${name}: INVALID HEADER (riff=${riff} wave=${wave} data=${dataTag})`);
    failed = true;
    continue;
  }
  const dataSize = buf.readUInt32LE(40);
  const numSamples = dataSize / 2;
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < numSamples; i++) {
    const s = buf.readInt16LE(44 + i * 2) / 32768;
    peak = Math.max(peak, Math.abs(s));
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / numSamples);
  const ok = peak > 0.02; // clearly non-silent
  console.log(`${name}: samples=${numSamples} peak=${peak.toFixed(3)} rms=${rms.toFixed(4)} ${ok ? 'OK' : 'SILENT!'}`);
  if (!ok) failed = true;
}
if (failed) {
  console.error('One or more sound assets failed validation.');
  process.exit(1);
}
console.log('All sound assets valid and non-silent.');
