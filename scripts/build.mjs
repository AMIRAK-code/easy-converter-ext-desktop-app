// Builds the desktop renderer bundles and the Chrome extension.
//   node scripts/build.mjs [desktop|extension|demo] [--watch] [--minify]

import { build, context } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { encodeIco } from '../src/shared/core/bitmap.js';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const watch = args.includes('--watch');
const minify = args.includes('--minify');
const only = args.find((a) => !a.startsWith('--'));

const common = {
  bundle: true,
  platform: 'browser',
  target: ['chrome120'],
  sourcemap: minify ? false : 'linked',
  minify,
  legalComments: 'none',
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
};

// ---------- icon ----------

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb03a"/><stop offset=".55" stop-color="#ff6a3d"/><stop offset="1" stop-color="#ef2d5e"/></linearGradient>
    <linearGradient id="hot" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#ffb03a"/></linearGradient>
  </defs>
  <rect width="512" height="512" rx="116" fill="url(#bg)"/>
  ${Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI) / 3, seg = Math.PI / 3, R = 196, r = 92, c = 16, gap = 16;
    const pt = (rad, t) => `${(256 + rad * Math.sin(t)).toFixed(1)} ${(256 - rad * Math.cos(t)).toFixed(1)}`;
    const ho = seg / 2 - (gap / 2 + c) / (R - c), hi = seg / 2 - (gap / 2 + c) / (r + c);
    const d = `M${pt(R - c, a - ho)}A${R - c} ${R - c} 0 0 1 ${pt(R - c, a + ho)}L${pt(r + c, a + hi)}A${r + c} ${r + c} 0 0 0 ${pt(r + c, a - hi)}Z`;
    const fill = i === 1 ? 'url(#hot)' : '#fff6f0';
    return `<path d="${d}" fill="${fill}" stroke="${fill}" stroke-width="${c * 2}" stroke-linejoin="round"/>`;
  }).join('')}
  <circle cx="256" cy="256" r="62" fill="#fff"/>
  <path d="M232 238h48l-14-14M280 274h-48l14 14" fill="none" stroke="#ff4d2e" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

async function writeIcons(dir, sizes, { ico = false } = {}) {
  await fs.mkdir(dir, { recursive: true });
  const svg = Buffer.from(ICON_SVG);
  const out = {};
  for (const s of sizes) {
    const png = await sharp(svg, { density: 300 }).resize(s, s).png().toBuffer();
    await fs.writeFile(path.join(dir, `icon-${s}.png`), png);
    out[s] = png;
  }
  if (ico) {
    const entries = [];
    for (const s of [16, 24, 32, 48, 64, 128, 256]) {
      entries.push({ size: s, png: new Uint8Array(out[s] ?? await sharp(svg, { density: 300 }).resize(s, s).png().toBuffer()) });
    }
    await fs.writeFile(path.join(dir, 'icon.ico'), encodeIco(entries));
  }
}

async function copy(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(from, to, { recursive: true });
}

// ---------- targets ----------

async function desktop() {
  const out = path.join(root, 'build', 'desktop');
  await fs.mkdir(out, { recursive: true });
  const opts = {
    ...common,
    entryPoints: {
      wheel: 'src/desktop/ui/wheel-ui.js',
      editor: 'src/desktop/ui/editor-ui.js',
      home: 'src/desktop/ui/home-ui.js',
    },
    outdir: out,
    format: 'esm',
  };
  await run(opts);
  for (const f of await fs.readdir('src/desktop/ui')) {
    if (/\.(html|css)$/.test(f)) await copy(path.join('src/desktop/ui', f), path.join(out, f));
  }
  await writeIcons(path.join(out, 'icons'), [16, 32, 48, 64, 128, 256, 512], { ico: true });
}

async function extension() {
  const out = path.join(root, 'dist', 'extension');
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  await run({
    ...common,
    entryPoints: {
      background: 'src/extension/background.js',
      overlay: 'src/extension/overlay.js',
      app: 'src/extension/app.js',
      editor: 'src/extension/editor-page.js',
    },
    outdir: out,
    format: 'esm',
    // Shared chunks + lazy-loaded libraries keep each page small and the wheel instant.
    splitting: true,
    chunkNames: 'chunk-[hash]',
    minify: true,
    sourcemap: false,
  });
  await run({ ...common, entryPoints: { content: 'src/extension/content.js' }, outdir: out, format: 'iife', minify: true, sourcemap: false });
  for (const f of await fs.readdir('src/extension')) {
    if (/\.(html|css|json)$/.test(f)) await copy(path.join('src/extension', f), path.join(out, f));
  }
  await copy('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', path.join(out, 'pdf.worker.min.mjs'));
  await copy('node_modules/pdfjs-dist/standard_fonts', path.join(out, 'pdfjs', 'standard_fonts'));
  await copy('node_modules/pdfjs-dist/cmaps', path.join(out, 'pdfjs', 'cmaps'));
  await copy('node_modules/pdfjs-dist/wasm', path.join(out, 'pdfjs', 'wasm'));
  await writeIcons(path.join(out, 'icons'), [16, 32, 48, 128]);
}

async function demo() {
  const out = path.join(root, 'build', 'demo');
  await fs.mkdir(out, { recursive: true });
  await run({ ...common, entryPoints: { demo: 'src/dev/demo.js', 'editor-demo': 'src/dev/editor-demo.js' }, outdir: out, format: 'esm' });
  await copy('src/dev/demo.html', path.join(out, 'index.html'));
  await copy('src/dev/editor.html', path.join(out, 'editor.html'));
}

async function webtest() {
  const out = path.join(root, 'build', 'webtest');
  await fs.mkdir(out, { recursive: true });
  await run({ ...common, entryPoints: { harness: 'src/dev/web-test.js' }, outdir: out, format: 'esm', splitting: true, chunkNames: 'chunk-[hash]' });
  await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><title>web test</title><script type="module" src="harness.js"></script>');
  await copy('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', path.join(out, 'pdf.worker.min.mjs'));
  for (const d of ['standard_fonts', 'cmaps', 'wasm']) await copy(`node_modules/pdfjs-dist/${d}`, path.join(out, 'pdfjs', d));
  await copy('.test-out/fixtures', path.join(out, 'fixtures'));
}

async function run(opts) {
  if (watch) {
    const ctx = await context(opts);
    await ctx.watch();
  } else {
    await build(opts);
  }
}

const targets = { desktop, extension, demo, webtest };
const list = only ? [only] : ['desktop', 'extension'];
for (const t of list) {
  const t0 = Date.now();
  await targets[t]();
  console.log(`built ${t} in ${Date.now() - t0}ms`);
}
