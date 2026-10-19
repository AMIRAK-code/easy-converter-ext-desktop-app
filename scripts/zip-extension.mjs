// Packs dist/extension into dist/easy-convert-extension.zip (Chrome Web Store upload).
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const dir = path.resolve('dist/extension');
const zip = new JSZip();
async function add(rel) {
  for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const p = path.join(rel, e.name);
    if (e.isDirectory()) await add(p);
    else if (!p.endsWith('.map')) zip.file(p.replace(/\/g, '/'), await fs.readFile(path.join(dir, p)));
  }
}
await add('');
const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
const out = path.resolve(`dist/easy-convert-extension-${manifest.version}.zip`);
await fs.writeFile(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
console.log(out);
