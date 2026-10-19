// Converts every fixture to every target the wheel would offer and checks each
// output's signature. Usage: node test/matrix.js [--no-office] [filter]

import fs from 'node:fs/promises';
import path from 'node:path';
import { createEngine } from '../src/desktop/convert/index.js';
import { formatOf } from '../src/shared/formats.js';
import { makeFixtures, ROOT } from './fixtures.js';

const args = process.argv.slice(2);
const noOffice = args.includes('--no-office');
const filter = args.find((a) => !a.startsWith('--'));

const ascii = (b, from, to) => Buffer.from(b.subarray(from, to)).toString('latin1');
const SIGNATURES = {
  pdf: (b) => ascii(b, 0, 4) === '%PDF',
  zip: (b) => ascii(b, 0, 2) === 'PK',
  ole: (b) => b[0] === 0xd0 && b[1] === 0xcf,
  rtf: (b) => ascii(b, 0, 5) === '{\\rtf',
  png: (b) => b[0] === 0x89 && ascii(b, 1, 4) === 'PNG',
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8,
  webp: (b) => ascii(b, 8, 12) === 'WEBP',
  gif: (b) => ascii(b, 0, 3) === 'GIF',
  bmp: (b) => ascii(b, 0, 2) === 'BM',
  ico: (b) => b[0] === 0 && b[2] === 1,
  tiff: (b) => ['II*', 'MM\0'].includes(ascii(b, 0, 3)),
  avif: (b) => ascii(b, 4, 12) === 'ftypavif',
  isobmff: (b) => ascii(b, 4, 8) === 'ftyp',
  ebml: (b) => b[0] === 0x1a && b[1] === 0x45,
  avi: (b) => ascii(b, 8, 11) === 'AVI',
  asf: (b) => b[0] === 0x30 && b[1] === 0x26,
  mp3: (b) => ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  wav: (b) => ascii(b, 8, 12) === 'WAVE',
  ogg: (b) => ascii(b, 0, 4) === 'OggS',
  flac: (b) => ascii(b, 0, 4) === 'fLaC',
  aac: (b) => b[0] === 0xff && (b[1] & 0xf0) === 0xf0,
  text: (b) => b.length > 0 && !b.subarray(0, 512).includes(0),
  json: (b) => { JSON.parse(Buffer.from(b).toString('utf8')); return true; },
};
const KIND = {
  pdf: 'pdf', docx: 'zip', xlsx: 'zip', pptx: 'zip', odt: 'zip', ods: 'zip', odp: 'zip', xps: 'zip',
  doc: 'ole', xls: 'ole', ppt: 'ole', rtf: 'rtf', png: 'png', jpg: 'jpg', webp: 'webp', gif: 'gif', bmp: 'bmp',
  ico: 'ico', tiff: 'tiff', avif: 'avif', mp4: 'isobmff', mov: 'isobmff', m4a: 'isobmff', webm: 'ebml', mkv: 'ebml',
  avi: 'avi', wmv: 'asf', wma: 'asf', mp3: 'mp3', wav: 'wav', ogg: 'ogg', opus: 'ogg', flac: 'flac', aac: 'aac',
  html: 'text', md: 'text', txt: 'text', csv: 'text', tsv: 'text', json: 'json',
};

async function check(file, fmt) {
  const stat = await fs.stat(file);
  const target = stat.isDirectory() ? path.join(file, (await fs.readdir(file))[0]) : file;
  const bytes = new Uint8Array(await fs.readFile(target));
  if (!bytes.length) throw new Error('empty output');
  if (!SIGNATURES[KIND[fmt]](bytes)) throw new Error(`bad ${fmt} signature: ${ascii(bytes, 0, 12)}`);
  return stat.isDirectory() ? `${(await fs.readdir(file)).length} files` : `${bytes.length} B`;
}

const fixtures = await makeFixtures();
const engine = await createEngine({ useOffice: !noOffice });
const outRoot = path.join(ROOT, noOffice ? 'out-no-office' : 'out');
await fs.rm(outRoot, { recursive: true, force: true });

let pass = 0;
const failures = [];
for (const name of await fs.readdir(fixtures)) {
  if (filter && !name.includes(filter)) continue;
  const input = path.join(fixtures, name);
  const { targets } = engine.optionsFor([input]);
  const outDir = path.join(outRoot, name.replace('.', '_'));
  await fs.mkdir(outDir, { recursive: true });
  for (const to of targets) {
    const t0 = Date.now();
    try {
      const [out] = await engine.convert(input, to, { outDir });
      const info = await check(out, to);
      pass++;
      console.log(`  ok   ${name} -> ${to.padEnd(5)} ${String(Date.now() - t0).padStart(6)}ms  ${info}  [${engine.explain(formatOf(name), to)}]`);
    } catch (e) {
      failures.push(`${name} -> ${to}: ${e.message}`);
      console.log(`  FAIL ${name} -> ${to.padEnd(5)} ${e.message}  [${engine.explain(formatOf(name), to)}]`);
    }
  }
}
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.join('\n')); process.exitCode = 1; }
