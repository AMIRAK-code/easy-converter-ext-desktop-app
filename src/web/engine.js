// Browser conversion engine for the Chrome extension: the same planner and
// shared core as the desktop app, with browser codecs (canvas, pdf.js, SheetJS…).
// Files are { blob, name }. Heavy libraries load on first use.

import { ConversionGraph, describeRoute } from '../shared/graph.js';
import { formatOf, familyOf, labelOf, mimeOf, splitName } from '../shared/formats.js';
import { toolsFor } from '../shared/tools.js';
import { decodeBmp, decodeIco, encodeBmp, encodeIco, ICO_SIZES } from '../shared/core/bitmap.js';

const lazy = (load) => { let p; return () => (p ??= load()); };
const markup = lazy(() => import('../shared/core/markup.js'));
const sheets = lazy(() => import('../shared/core/sheets.js'));
const pdfdoc = lazy(() => import('../shared/core/pdfdoc.js'));
const imagedocs = lazy(() => import('../shared/core/imagedocs.js'));
const htmlpdf = lazy(() => import('./htmlpdf.js'));
const mammothLib = lazy(() => import('mammoth/mammoth.browser.min.js').then((m) => m.default ?? m));

const asset = (p) => (globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL(p) : new URL(p, location.href).href);
const pdfjs = lazy(async () => {
  const lib = await import('pdfjs-dist/build/pdf.mjs');
  lib.GlobalWorkerOptions.workerSrc = asset('pdf.worker.min.mjs');
  return lib;
});

async function openPdf(blob) {
  const lib = await pdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    standardFontDataUrl: asset('pdfjs/standard_fonts/'),
    cMapUrl: asset('pdfjs/cmaps/'),
    cMapPacked: true,
    wasmUrl: asset('pdfjs/wasm/'),
    isEvalSupported: false,
  });
  const pdf = await task.promise;
  tasks.set(pdf, task);
  return pdf;
}
const tasks = new WeakMap();

const closePdf = (pdf) => (typeof pdf.destroy === 'function' ? pdf.destroy() : tasks.get(pdf)?.destroy());
const blobOf = (data, fmt) => new Blob([data], { type: mimeOf(fmt) });
const text = (blob) => blob.text().then((t) => t.replace(/^﻿/, ''));
const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());

// ---------- images ----------

const RASTER_IN = ['png', 'jpg', 'webp', 'gif', 'bmp', 'ico', 'avif', 'svg'];
let avifEncode;
function canEncodeAvif() {
  if (avifEncode == null) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    avifEncode = c.toDataURL('image/avif').startsWith('data:image/avif');
  }
  return avifEncode;
}

/** Any supported image blob -> canvas. */
export async function decodeImage(blob, fmt) {
  let source;
  if (fmt === 'svg') {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
      const k = Math.max(1, 1600 / Math.max(w, h));
      return drawTo(img, w * k, h * k);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  try {
    source = await createImageBitmap(blob);
  } catch (e) {
    if (fmt !== 'bmp' && fmt !== 'ico') throw new Error(`This browser can't read ${labelOf(fmt)} images`);
    const raw = fmt === 'bmp' ? decodeBmp(await bytes(blob)) : decodeIco(await bytes(blob));
    if (raw.png) return decodeImage(new Blob([raw.png], { type: 'image/png' }), 'png');
    const c = document.createElement('canvas');
    c.width = raw.width; c.height = raw.height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(raw.data.buffer), raw.width, raw.height), 0, 0);
    return c;
  }
  const c = drawTo(source, source.width, source.height);
  source.close?.();
  return c;
}

function drawTo(src, w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function flatten(canvas) {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0);
  return c;
}

const toBlob = (canvas, type, quality) => new Promise((resolve, reject) =>
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`Couldn't encode ${type}`))), type, quality));

export async function encodeImage(canvas, to, { quality } = {}) {
  switch (to) {
    case 'png': return toBlob(canvas, 'image/png');
    case 'jpg': return toBlob(flatten(canvas), 'image/jpeg', quality ?? 0.9);
    case 'webp': return toBlob(canvas, 'image/webp', quality ?? 0.88);
    case 'avif': return toBlob(canvas, 'image/avif', quality ?? 0.6);
    case 'bmp': {
      const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      return blobOf(encodeBmp({ width: d.width, height: d.height, data: d.data }), 'bmp');
    }
    case 'ico': {
      const max = Math.max(canvas.width, canvas.height);
      const entries = [];
      for (const size of ICO_SIZES.filter((s) => s <= Math.max(16, max))) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const k = Math.min(size / canvas.width, size / canvas.height);
        const w = canvas.width * k, h = canvas.height * k;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, (size - w) / 2, (size - h) / 2, w, h);
        entries.push({ size, png: await bytes(await toBlob(c, 'image/png')) });
      }
      return blobOf(encodeIco(entries), 'ico');
    }
    default: throw new Error(`Can't write ${labelOf(to)} images in the browser`);
  }
}

/** Canvas -> { bytes, type, width, height } for embedding in PDF/DOCX/PPTX. */
async function embeddable(canvas, preferJpeg) {
  const usePng = !preferJpeg;
  const blob = usePng ? await toBlob(canvas, 'image/png') : await toBlob(flatten(canvas), 'image/jpeg', 0.92);
  return { bytes: await bytes(blob), type: usePng ? 'png' : 'jpg', width: canvas.width, height: canvas.height };
}

async function renderPdfPages(blob, { dpi = 150, onPage } = {}) {
  const pdf = await openPdf(blob);
  const pages = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const c = document.createElement('canvas');
      c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, canvas: c, viewport }).promise;
      pages.push(c);
      page.cleanup();
      onPage?.(n, pdf.numPages);
    }
  } finally {
    await closePdf(pdf);
  }
  return pages;
}

async function pdfStructure(blob) {
  const pdf = await openPdf(blob);
  try { return await (await pdfdoc()).extractStructure(pdf); } finally { await closePdf(pdf); }
}

// ---------- graph ----------

function buildGraph() {
  const g = new ConversionGraph();
  const out = (data, to, base) => ({ blob: data instanceof Blob ? data : blobOf(data, to), name: `${base}.${to}` });
  const rasterOut = ['png', 'jpg', 'webp', 'bmp', 'ico', ...(canEncodeAvif() ? ['avif'] : [])];

  g.add({
    id: 'canvas', from: RASTER_IN, to: rasterOut, cost: 1,
    async run({ input, from, to, base }) {
      return out(await encodeImage(await decodeImage(input.blob, from), to), to, base);
    },
  });
  g.add({
    id: 'image-docs', from: RASTER_IN, to: ['pdf', 'docx', 'pptx'], cost: (f, t) => (t === 'pdf' ? 1 : 1.3),
    async run({ input, from, to, base }) {
      const img = await embeddable(await decodeImage(input.blob, from), from === 'jpg');
      const m = await imagedocs();
      const fn = { pdf: m.imagesToPdf, docx: m.imagesToDocx, pptx: m.imagesToPptx }[to];
      return out(await fn([img], { title: base }), to, base);
    },
  });
  g.add({
    id: 'pdf-render', from: ['pdf'], to: ['png', 'jpg', 'webp'], cost: 1, terminal: true,
    async run({ input, to, base, ctx }) {
      const pages = await renderPdfPages(input.blob, { onPage: (n, t) => ctx.progress(n / t, `Page ${n} of ${t}`) });
      const files = [];
      const pad = Math.max(2, String(pages.length).length);
      for (let i = 0; i < pages.length; i++) {
        const name = pages.length === 1 ? `${base}.${to}` : `${base} ${String(i + 1).padStart(pad, '0')}.${to}`;
        files.push({ blob: await encodeImage(pages[i], to), name, folder: pages.length > 1 ? `${base} (${labelOf(to)})` : undefined });
      }
      return files;
    },
  });
  g.add({
    id: 'pdf-text', from: ['pdf'], to: ['txt', 'md', 'html', 'docx', 'xlsx', 'csv'],
    cost: (f, t) => ({ txt: 1, md: 1.5, html: 2, docx: 2.5, xlsx: 2, csv: 2 })[t],
    async run({ input, to, base }) {
      const doc = await pdfStructure(input.blob);
      const p = await pdfdoc();
      const title = doc.title || base;
      if (to === 'txt') return out(p.structureToText(doc), to, base);
      if (to === 'md') return out(p.structureToMarkdown(doc), to, base);
      if (to === 'html') return out(p.structureToHtml(doc, title), to, base);
      if (to === 'docx') return out(await (await markup()).htmlToDocx(p.structureToHtml(doc, title), { title }), to, base);
      const s = await sheets();
      return out(s.writeWorkbook(s.rowsToWorkbook(p.structureToSheets(doc)), to, title), to, base);
    },
  });
  g.add({
    id: 'pdf-slides', from: ['pdf'], to: ['pptx'], cost: 1.5,
    async run({ input, base, ctx }) {
      const pages = await renderPdfPages(input.blob, { dpi: 144, onPage: (n, t) => ctx.progress(n / t, `Page ${n} of ${t}`) });
      const images = await Promise.all(pages.map((c) => embeddable(c, true)));
      return out(await (await imagedocs()).imagesToPptx(images, { title: base }), 'pptx', base);
    },
  });
  g.add({
    id: 'mammoth', from: ['docx'], to: ['html', 'txt'], cost: 2.5,
    async run({ input, to, base }) {
      const mammoth = await mammothLib();
      const arrayBuffer = await input.blob.arrayBuffer();
      if (to === 'txt') return out((await mammoth.extractRawText({ arrayBuffer })).value, to, base);
      const { value } = await mammoth.convertToHtml({ arrayBuffer });
      return out((await markup()).wrapHtml(value, base), to, base);
    },
  });
  g.add({
    id: 'markup', from: ['md', 'txt', 'html'], to: ['html', 'md', 'txt'],
    cost: (f, t) => (f === 'txt' && t === 'md' ? 1.3 : 1),
    async run({ input, from, to, base }) {
      const m = await markup();
      const t = await text(input.blob);
      let res;
      if (to === 'html') res = from === 'md' ? m.mdToHtml(t, base) : m.txtToHtml(t, base);
      else if (to === 'md') res = from === 'html' ? m.htmlToMd(t) : t;
      else res = from === 'html' ? m.htmlToText(t) : t;
      return out(res, to, base);
    },
  });
  g.add({
    id: 'html-docx', from: ['html'], to: ['docx'], cost: 2.5,
    async run({ input, base }) { return out(await (await markup()).htmlToDocx(await text(input.blob), { title: base }), 'docx', base); },
  });
  g.add({
    id: 'html-tables', from: ['html'], to: ['xlsx'], cost: 1.5,
    async run({ input, base }) {
      const s = await sheets();
      return out(s.writeWorkbook(s.htmlToWorkbook(await text(input.blob)), 'xlsx'), 'xlsx', base);
    },
  });
  g.add({
    id: 'html-pdf', from: ['html'], to: ['pdf'], cost: 2,
    async run({ input, base }) { return out(await (await htmlpdf()).htmlToPdf(await text(input.blob), { title: base }), 'pdf', base); },
  });
  g.add({
    id: 'sheetjs', from: ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'csv', 'tsv', 'json'],
    to: ['xlsx', 'xls', 'ods', 'csv', 'tsv', 'json', 'html', 'md', 'txt'],
    cost: (f, t) => (t === 'txt' ? 1.6 : 1),
    async run({ input, from, to, base }) {
      const s = await sheets();
      return out(s.writeWorkbook(s.readWorkbook(await bytes(input.blob), from), to, base), to, base);
    },
  });
  return g;
}

// ---------- engine ----------

export function createWebEngine() {
  const graph = buildGraph();
  const canPdf = (fmt) => fmt === 'pdf' || !!graph.plan(fmt, 'pdf');

  function optionsFor(files) {
    const formats = files.map((f) => formatOf(f.name) || formatOf(f.blob?.type));
    if (formats.some((f) => !f)) {
      return { formats, targets: [], tools: [], unsupported: files.filter((_, i) => !formats[i]).map((f) => f.name) };
    }
    const targets = graph.commonTargets(formats).map((t) => t.to);
    const tools = toolsFor(formats, { canPdf, platform: 'extension' })
      .filter((t) => t !== 'compress' || formats.every((f) => f === 'pdf' || RASTER_IN.includes(f)))
      .filter((t) => t !== 'rotate' || formats.every((f) => f === 'pdf'));
    const media = formats.some((f) => ['video', 'audio'].includes(familyOf(f)));
    return { formats, targets, tools, note: media && !targets.length ? 'Video & audio need the Windows app' : undefined };
  }

  /** Convert one file. Returns [{ blob, name, folder? }]. */
  async function convert(file, target, { progress = () => {} } = {}) {
    const src = formatOf(file.name) || formatOf(file.blob.type);
    if (src === target) return [];
    const route = graph.plan(src, target);
    if (!route) throw new Error(`Can't convert ${labelOf(src)} to ${labelOf(target)} in the browser`);
    const { base } = splitName(file.name);
    const ctx = { progress: (fraction, label) => progress({ fraction, label }) };
    let current = file;
    for (let i = 0; i < route.steps.length; i++) {
      const { edge, from, to } = route.steps[i];
      progress({ fraction: i / route.steps.length, label: `${labelOf(from)} → ${labelOf(to)}` });
      current = await edge.run({ input: current, from, to, base, ctx });
    }
    return Array.isArray(current) ? current : [current];
  }

  async function tool(toolId, files, { progress = () => {} } = {}) {
    const m = await imagedocs();
    const { base } = splitName(files[0].name);
    if (toolId === 'merge') {
      const pdfs = [];
      for (let i = 0; i < files.length; i++) {
        progress({ fraction: i / files.length, label: `Preparing ${files[i].name}` });
        const f = files[i];
        pdfs.push(formatOf(f.name) === 'pdf' ? f : (await convert(f, 'pdf'))[0]);
      }
      const merged = await m.mergePdfs(await Promise.all(pdfs.map((f) => bytes(f.blob))));
      return [{ blob: blobOf(merged, 'pdf'), name: `${base} Merged.pdf` }];
    }
    const results = [];
    for (const file of files) {
      const fmt = formatOf(file.name);
      const b = splitName(file.name).base;
      if (fmt === 'pdf') {
        const data = await bytes(file.blob);
        if (toolId === 'compress') {
          const recompress = async (jpeg) => {
            const c = await decodeImage(new Blob([jpeg], { type: 'image/jpeg' }), 'jpg');
            const k = Math.min(1, 2000 / Math.max(c.width, c.height));
            const small = k < 1 ? drawTo(c, c.width * k, c.height * k) : c;
            return { data: await bytes(await encodeImage(small, 'jpg', { quality: 0.65 })), width: small.width, height: small.height };
          };
          results.push(smaller(file, { blob: blobOf(await m.compressPdf(data, recompress, (f) => progress({ fraction: f, label: 'Compressing' })), 'pdf'), name: `${b} Compressed.pdf` }));
        } else if (toolId === 'metadata') results.push({ blob: blobOf(await m.stripPdfMetadata(data), 'pdf'), name: `${b} No Metadata.pdf` });
        else if (toolId === 'rotate') results.push({ blob: blobOf(await m.rotatePdf(data, 90), 'pdf'), name: `${b} Rotated.pdf` });
        else if (toolId === 'split') {
          const parts = await m.splitPdf(data);
          const pad = String(parts.length).length;
          parts.forEach((p, i) => results.push({ blob: blobOf(p, 'pdf'), name: `${b} p${String(i + 1).padStart(pad, '0')}.pdf`, folder: `${b} pages` }));
        } else throw new Error(`${toolId} isn't available for PDFs in the browser`);
      } else {
        const canvas = await decodeImage(file.blob, fmt);
        if (toolId === 'compress') {
          const hasAlpha = fmt !== 'jpg' && hasTransparency(canvas);
          const to = fmt === 'jpg' || (!hasAlpha && fmt !== 'webp') ? 'jpg' : 'webp';
          const k = Math.min(1, 3000 / Math.max(canvas.width, canvas.height));
          const c = k < 1 ? drawTo(canvas, canvas.width * k, canvas.height * k) : canvas;
          results.push(smaller(file, { blob: await encodeImage(c, to, { quality: 0.72 }), name: `${b} Compressed.${to}` }));
        } else if (toolId === 'metadata') {
          // Re-encoding through <canvas> drops EXIF, GPS and other metadata.
          const to = ['png', 'jpg', 'webp'].includes(fmt) ? fmt : 'png';
          results.push({ blob: await encodeImage(canvas, to, { quality: 0.95 }), name: `${b} No Metadata.${to}` });
        } else throw new Error(`${toolId} isn't available in the browser`);
      }
    }
    return results;
  }

  return { graph, optionsFor, convert, tool, explain: (s, d) => describeRoute(graph.plan(s, d)) };
}

/** If a "compressed" result isn't smaller and kept the format, return the original instead. */
function smaller(original, result) {
  const sameFormat = formatOf(original.name) === formatOf(result.name);
  return sameFormat && result.blob.size >= original.blob.size ? { ...result, blob: original.blob } : result;
}

function hasTransparency(canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) return true;
  return false;
}
