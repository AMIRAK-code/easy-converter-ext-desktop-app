// PDF edges that don't need Office: render pages, rebuild text structure.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { extractStructure, structureToHtml, structureToMarkdown, structureToText, structureToSheets } from '../../shared/core/pdfdoc.js';
import { htmlToDocx } from '../../shared/core/markup.js';
import { rowsToWorkbook, writeWorkbook } from '../../shared/core/sheets.js';
import { imagesToPptx } from '../../shared/core/imagedocs.js';
import { writeImage } from './images.js';
import { baseName } from './util.js';

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json')).replace('app.asar', 'app.asar.unpacked');

let pdfjsLib;
async function pdfjs() {
  pdfjsLib ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsLib;
}

export async function openPdf(file) {
  const lib = await pdfjs();
  const data = new Uint8Array(await fs.readFile(file));
  // pdf.js wants forward slashes and a trailing slash, even on Windows.
  const dir = (name) => `${pdfjsRoot.replace(/\\/g, '/')}/${name}/`;
  const task = lib.getDocument({
    data,
    standardFontDataUrl: dir('standard_fonts'),
    cMapUrl: dir('cmaps'),
    cMapPacked: true,
    wasmUrl: dir('wasm'),
    iccUrl: dir('iccs'),
    verbosity: 0,
    isEvalSupported: false,
  });
  const pdf = await task.promise;
  // v6 moved destroy() from the document to its loading task.
  pdf.close = () => (typeof pdf.destroy === 'function' ? pdf.destroy() : task.destroy());
  return pdf;
}

/** Render every page to PNG buffers at `dpi`. */
export async function renderPages(file, { dpi = 150, onPage } = {}) {
  const pdf = await openPdf(file);
  const pages = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const { canvas, context } = pdf.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      pages.push(await canvas.encode('png'));
      pdf.canvasFactory.destroy({ canvas, context });
      page.cleanup();
      onPage?.(n, pdf.numPages);
    }
  } finally {
    await pdf.close();
  }
  return pages;
}

async function structure(file) {
  const pdf = await openPdf(file);
  try { return await extractStructure(pdf); } finally { await pdf.close(); }
}

export function pdfEdges() {
  return [
    {
      id: 'pdf-render',
      from: ['pdf'],
      to: ['png', 'jpg', 'webp', 'tiff'],
      cost: 1,
      terminal: true,
      async run({ input, to, output, ctx }) {
        const pngs = await renderPages(input, { onPage: (n, total) => ctx.progress(n / total, `Page ${n} of ${total}`) });
        const files = [];
        for (let i = 0; i < pngs.length; i++) {
          const f = path.join(ctx.tmpDir, `page-${String(i + 1).padStart(3, '0')}.${to}`);
          await writeImage(sharp(pngs[i]), to, f);
          files.push(f);
        }
        return ctx.placePages(files, output);
      },
    },
    {
      id: 'pdf-text',
      from: ['pdf'],
      to: ['txt', 'html', 'md', 'docx', 'xlsx', 'csv'],
      // Layout reconstruction is approximate; Word's PDF reflow wins for DOCX when available.
      cost: (from, to) => ({ txt: 1, md: 1.5, html: 2, docx: 2.5, xlsx: 2, csv: 2 })[to],
      async run({ input, to, output }) {
        const doc = await structure(input);
        const title = doc.title || baseName(input);
        let out;
        if (to === 'txt') out = structureToText(doc);
        else if (to === 'md') out = structureToMarkdown(doc);
        else if (to === 'html') out = structureToHtml(doc, title);
        else if (to === 'docx') out = await htmlToDocx(structureToHtml(doc, title), { title });
        else out = writeWorkbook(rowsToWorkbook(structureToSheets(doc)), to, title);
        await fs.writeFile(output, out);
        return output;
      },
    },
    {
      id: 'pdf-slides',
      from: ['pdf'],
      to: ['pptx'],
      cost: 1.5,
      async run({ input, output, ctx }) {
        const pngs = await renderPages(input, { dpi: 144, onPage: (n, t) => ctx.progress(n / t, `Page ${n} of ${t}`) });
        const images = await Promise.all(pngs.map(async (png) => {
          const { data, info } = await sharp(png).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
          return { bytes: new Uint8Array(data), type: 'jpg', width: info.width, height: info.height };
        }));
        await fs.writeFile(output, await imagesToPptx(images, { title: baseName(input) }));
        return output;
      },
    },
  ];
}
