// Images -> PDF / DOCX / PPTX, and PDF page tools (pdf-lib). Node + browser.
// Every image passed in must already be PNG or JPEG: { bytes, type: 'png'|'jpg', width, height }.

import { PDFDocument, PDFName, PDFNumber, PDFRawStream, degrees } from 'pdf-lib';
import { Document, Packer, Paragraph, ImageRun, PageOrientation, AlignmentType, PageBreak } from 'docx';
import PptxGenJS from 'pptxgenjs';

const toBase64 = (bytes) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** One page per image, sized to the image at 96 dpi (like printing it 1:1). */
export async function imagesToPdf(images, { title } = {}) {
  const pdf = await PDFDocument.create();
  for (const img of images) {
    const embedded = img.type === 'png' ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes);
    const w = (img.width || embedded.width) * 0.75, h = (img.height || embedded.height) * 0.75;
    const page = pdf.addPage([w, h]);
    page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
  }
  pdf.setProducer('Easy Convert');
  pdf.setCreator('Easy Convert');
  if (title) pdf.setTitle(title);
  return pdf.save();
}

/** Each image on its own page, scaled to fit the margins; landscape pages for wide images. */
export async function imagesToDocx(images, { title } = {}) {
  const children = [];
  images.forEach((img, i) => {
    const landscape = img.width > img.height * 1.15;
    const maxW = landscape ? 900 : 620, maxH = landscape ? 560 : 860;
    const k = Math.min(1, maxW / img.width, maxH / img.height);
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({ type: img.type, data: img.bytes, transformation: { width: Math.round(img.width * k), height: Math.round(img.height * k) } }),
        ...(i < images.length - 1 ? [new PageBreak()] : []),
      ],
    }));
  });
  const landscape = images.length === 1 && images[0].width > images[0].height * 1.15;
  const doc = new Document({
    title, creator: 'Easy Convert',
    sections: [{ properties: landscape ? { page: { size: { orientation: PageOrientation.LANDSCAPE } } } : {}, children }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}

/** One 16:9 slide per image, letterboxed on a black background. */
export async function imagesToPptx(images, { title } = {}) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
  if (title) pptx.title = title;
  const W = 13.333, H = 7.5;
  for (const img of images) {
    const slide = pptx.addSlide();
    slide.background = { color: '000000' };
    const k = Math.min(W / img.width, H / img.height);
    const w = img.width * k, h = img.height * k;
    slide.addImage({
      data: `data:image/${img.type === 'jpg' ? 'jpeg' : 'png'};base64,${toBase64(img.bytes)}`,
      x: (W - w) / 2, y: (H - h) / 2, w, h,
    });
  }
  const out = await pptx.write({ outputType: 'uint8array' });
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

// ---------- PDF tools ----------

export async function mergePdfs(list) {
  const out = await PDFDocument.create();
  for (const bytes of list) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  out.setProducer('Easy Convert');
  return out.save();
}

export async function splitPdf(bytes) {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const parts = [];
  for (const i of src.getPageIndices()) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    parts.push(await doc.save());
  }
  return parts;
}

export async function rotatePdf(bytes, by = 90) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  for (const p of doc.getPages()) p.setRotation(degrees((p.getRotation().angle + by) % 360));
  return doc.save();
}

export async function stripPdfMetadata(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]);
  doc.setCreator(''); doc.setProducer('');
  const info = doc.context.trailerInfo.Info;
  if (info) doc.context.delete(info);
  doc.context.trailerInfo.Info = undefined;
  doc.catalog.delete(PDFName.of('Metadata')); // XMP packet
  return doc.save({ useObjectStreams: true });
}

export async function pdfPageCount(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

/**
 * Shrink a PDF by re-encoding its JPEG images (RGB/gray only) and packing objects.
 * `recompress(jpegBytes)` returns `{ data, width, height }` or null to keep the original.
 */
export async function compressPdf(bytes, recompress, onProgress) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const objects = doc.context.enumerateIndirectObjects();
  let done = 0;
  for (const [ref, obj] of objects) {
    done++;
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    if (dict.get(PDFName.of('Filter')) !== PDFName.of('DCTDecode')) continue;
    const cs = dict.get(PDFName.of('ColorSpace'));
    if (cs !== PDFName.of('DeviceRGB') && cs !== PDFName.of('DeviceGray')) continue;
    try {
      const src = obj.getContents();
      const r = await recompress(src);
      if (r && r.data.length < src.length * 0.9) {
        dict.set(PDFName.of('Width'), PDFNumber.of(r.width));
        dict.set(PDFName.of('Height'), PDFNumber.of(r.height));
        dict.set(PDFName.of('Length'), PDFNumber.of(r.data.length));
        dict.delete(PDFName.of('DecodeParms'));
        doc.context.assign(ref, PDFRawStream.of(dict, new Uint8Array(r.data)));
      }
    } catch { /* leave images we can't decode */ }
    if (done % 25 === 0) onProgress?.(done / objects.length);
  }
  return doc.save({ useObjectStreams: true });
}
