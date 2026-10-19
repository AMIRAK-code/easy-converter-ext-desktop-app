// Image edges: sharp for the heavy lifting, plus HEIC (libheif wasm), BMP and ICO codecs.

import fs from 'node:fs/promises';
import sharp from 'sharp';
import heicConvert from 'heic-convert';
import { decodeBmp, encodeBmp, decodeIco, encodeIco, ICO_SIZES } from '../../shared/core/bitmap.js';
import { imagesToPdf, imagesToDocx, imagesToPptx } from '../../shared/core/imagedocs.js';
import { baseName } from './util.js';

sharp.cache(false);

const RASTER_IN = ['png', 'jpg', 'webp', 'avif', 'heic', 'tiff', 'gif', 'bmp', 'ico', 'svg'];
const RASTER_OUT = ['png', 'jpg', 'webp', 'avif', 'tiff', 'gif', 'bmp', 'ico'];

/** Any supported image file -> sharp pipeline (EXIF orientation applied). */
export async function openImage(file, fmt, { animated = false } = {}) {
  if (fmt === 'heic') {
    const png = await heicConvert({ buffer: await fs.readFile(file), format: 'PNG' });
    return sharp(Buffer.from(png));
  }
  if (fmt === 'bmp' || fmt === 'ico') {
    const bytes = await fs.readFile(file);
    const img = fmt === 'bmp' ? decodeBmp(bytes) : decodeIco(bytes);
    if (img.png) return sharp(Buffer.from(img.png));
    return sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 4 } });
  }
  if (fmt === 'svg') {
    // Rasterise small SVGs at a higher density so they come out crisp.
    const meta = await sharp(file).metadata();
    const side = Math.max(meta.width || 512, meta.height || 512);
    const density = Math.min(1200, Math.max(72, Math.round((72 * 1600) / side)));
    return sharp(file, { density });
  }
  return sharp(file, { animated, limitInputPixels: 1e9 }).rotate();
}

/** Encode a sharp pipeline to `to` and write it. */
export async function writeImage(img, to, output, { quality } = {}) {
  switch (to) {
    case 'png': return img.png({ compressionLevel: 8, adaptiveFiltering: true }).toFile(output);
    case 'jpg': return img.flatten({ background: '#ffffff' }).jpeg({ quality: quality ?? 90, mozjpeg: true }).toFile(output);
    case 'webp': return img.webp({ quality: quality ?? 88, effort: 4 }).toFile(output);
    case 'avif': return img.avif({ quality: quality ?? 60, effort: 4 }).toFile(output);
    case 'tiff': return img.tiff({ compression: 'lzw' }).toFile(output);
    case 'gif': return img.gif({ effort: 7 }).toFile(output);
    case 'bmp': {
      const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return fs.writeFile(output, encodeBmp({ width: info.width, height: info.height, data }));
    }
    case 'ico': {
      const buf = await img.png().toBuffer();
      const meta = await sharp(buf).metadata();
      const max = Math.max(meta.width, meta.height);
      const sizes = ICO_SIZES.filter((s) => s <= Math.max(16, max));
      const entries = await Promise.all(sizes.map(async (size) => ({
        size,
        png: new Uint8Array(await sharp(buf).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()),
      })));
      return fs.writeFile(output, encodeIco(entries));
    }
    default: throw new Error(`Can't write images as ${to}`);
  }
}

/** Image file -> { bytes, type: 'png'|'jpg', width, height } for embedding in documents. */
export async function embeddable(file, fmt) {
  const img = await openImage(file, fmt);
  const { hasAlpha } = await img.metadata();
  const usePng = fmt === 'png' || (hasAlpha && fmt !== 'jpg');
  const { data, info } = usePng
    ? await img.png().toBuffer({ resolveWithObject: true })
    : await img.flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(data), type: usePng ? 'png' : 'jpg', width: info.width, height: info.height };
}

export function imageEdges() {
  return [
    {
      id: 'sharp',
      from: RASTER_IN,
      to: RASTER_OUT,
      cost: 1,
      async run({ input, from, to, output }) {
        const keepAnimation = from === 'gif' || from === 'webp';
        const img = await openImage(input, from, { animated: keepAnimation && (to === 'gif' || to === 'webp') });
        await writeImage(img, to, output);
        return output;
      },
    },
    {
      id: 'image-docs',
      from: RASTER_IN,
      to: ['pdf', 'docx', 'pptx'],
      cost: (from, to) => (to === 'pdf' ? 1 : 1.3),
      async run({ input, from, to, output }) {
        const images = [await embeddable(input, from)];
        const title = baseName(input);
        const bytes = to === 'pdf' ? await imagesToPdf(images, { title })
          : to === 'docx' ? await imagesToDocx(images, { title })
            : await imagesToPptx(images, { title });
        await fs.writeFile(output, bytes);
        return output;
      },
    },
  ];
}
