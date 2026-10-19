// Desktop implementations of the non-editor tools (see shared/tools.js).

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import JSZip from 'jszip';
import exifReader from 'exif-reader';
import { PDFDocument } from 'pdf-lib';
import { familyOf, formatOf } from '../../shared/formats.js';
import { mergePdfs, splitPdf, rotatePdf, stripPdfMetadata, compressPdf as compressPdfBytes } from '../../shared/core/imagedocs.js';
import { openImage, writeImage } from './images.js';
import { ffmpeg, probeDuration } from './media.js';
import { baseName, readBytes, uniquePath } from './util.js';

const out = (input, suffix, ext, outDir) =>
  uniquePath(outDir ?? path.dirname(input), `${baseName(input)} ${suffix}`, ext ?? formatExt(input));
const formatExt = (f) => path.extname(f).slice(1).toLowerCase();

// ---------- Compress ----------

async function compressImage(input, fmt, outDir) {
  // Formats without good lossy modes become JPEG (or PNG when transparent).
  const img = await openImage(input, fmt);
  const { hasAlpha } = await img.metadata();
  const target = ['jpg', 'png', 'webp', 'avif', 'gif'].includes(fmt) ? fmt : hasAlpha ? 'png' : 'jpg';
  const output = out(input, 'Compressed', target, outDir);
  const capped = img.resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true });
  if (target === 'png') await capped.png({ palette: true, quality: 80, effort: 8, compressionLevel: 9 }).toFile(output);
  else if (target === 'gif') await capped.gif({ colours: 128, effort: 8 }).toFile(output);
  else await writeImage(capped, target, output, { quality: { jpg: 72, webp: 70, avif: 45 }[target] });
  return keepSmaller(input, output);
}

/** If "compressing" made the file bigger, keep a copy of the original instead. */
async function keepSmaller(input, output) {
  const [a, b] = await Promise.all([fs.stat(input), fs.stat(output)]);
  if (b.size >= a.size && path.extname(input).toLowerCase() === path.extname(output).toLowerCase()) {
    await fs.copyFile(input, output);
  }
  return output;
}

/** Re-encode the JPEG images inside a PDF (downsampled to 2000px) and pack objects. */
async function compressPdf(input, outDir, ctx) {
  const recompress = async (jpeg) => {
    const { data, info } = await sharp(jpeg)
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 65, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  };
  const bytes = await compressPdfBytes(await readBytes(input), recompress, (f) => ctx?.progress(f, 'Compressing images'));
  const output = out(input, 'Compressed', 'pdf', outDir);
  await fs.writeFile(output, bytes);
  return keepSmaller(input, output);
}

/** DOCX/XLSX/PPTX are zips: recompress their pictures, keep everything else. */
async function compressOfficeZip(input, outDir) {
  const zip = await JSZip.loadAsync(await fs.readFile(input));
  const media = Object.values(zip.files).filter((f) => /^(word|xl|ppt)\/media\/.+\.(jpe?g|png)$/i.test(f.name));
  for (const f of media) {
    const src = await f.async('nodebuffer');
    if (src.length < 80_000) continue;
    try {
      let img = sharp(src).resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true });
      img = /\.png$/i.test(f.name) ? img.png({ palette: true, quality: 85, compressionLevel: 9 }) : img.jpeg({ quality: 72, mozjpeg: true });
      const data = await img.toBuffer();
      if (data.length < src.length) zip.file(f.name, data);
    } catch { /* skip unreadable pictures */ }
  }
  const output = out(input, 'Compressed', undefined, outDir);
  await fs.writeFile(output, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
  return keepSmaller(input, output);
}

async function compressMedia(input, fmt, outDir, ctx) {
  if (familyOf(fmt) === 'video') {
    const output = out(input, 'Compressed', 'mp4', outDir);
    await ffmpeg(['-i', input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
      '-vf', "scale='min(1920,iw)':-2", '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output], { ctx, label: 'Compressing' });
    return keepSmaller(input, output);
  }
  const lossy = { mp3: ['-c:a', 'libmp3lame', '-b:a', '96k'], m4a: ['-c:a', 'aac', '-b:a', '96k'], aac: ['-c:a', 'aac', '-b:a', '96k', '-f', 'adts'],
    ogg: ['-c:a', 'libvorbis', '-q:a', '2'], opus: ['-c:a', 'libopus', '-b:a', '64k'], wma: ['-c:a', 'wmav2', '-b:a', '96k'] };
  const target = lossy[fmt] ? fmt : 'mp3';
  const output = out(input, 'Compressed', target, outDir);
  await ffmpeg(['-i', input, '-vn', ...(lossy[target] ?? lossy.mp3), output], { ctx, label: 'Compressing' });
  return keepSmaller(input, output);
}

// ---------- Metadata ----------

/** Human-readable metadata for the info panel. */
export async function readMetadata(input) {
  const fmt = formatOf(input);
  const stat = await fs.stat(input);
  const info = { File: path.basename(input), Size: formatBytes(stat.size), Modified: stat.mtime.toLocaleString() };
  if (fmt === 'pdf') {
    const doc = await PDFDocument.load(await readBytes(input), { ignoreEncryption: true, updateMetadata: false });
    Object.assign(info, {
      Pages: doc.getPageCount(), Title: doc.getTitle(), Author: doc.getAuthor(), Subject: doc.getSubject(),
      Creator: doc.getCreator(), Producer: doc.getProducer(),
      Created: doc.getCreationDate()?.toLocaleString(), 'Last modified': doc.getModificationDate()?.toLocaleString(),
    });
  } else if (familyOf(fmt) === 'image') {
    const meta = await (await openImage(input, fmt)).metadata();
    Object.assign(info, { Dimensions: `${meta.width} × ${meta.height}`, Format: meta.format?.toUpperCase(), 'Colour space': meta.space, 'Has alpha': meta.hasAlpha ? 'Yes' : 'No' });
    if (meta.density) info.DPI = meta.density;
    if (meta.exif) {
      try {
        const e = exifReader(meta.exif);
        const img = e.Image ?? {}, photo = e.Photo ?? {}, gps = e.GPSInfo ?? {};
        Object.assign(info, {
          Camera: [img.Make, img.Model].filter(Boolean).join(' '),
          Lens: photo.LensModel, Taken: photo.DateTimeOriginal?.toLocaleString?.() ?? photo.DateTimeOriginal,
          Exposure: photo.ExposureTime ? `1/${Math.round(1 / photo.ExposureTime)} s` : undefined,
          Aperture: photo.FNumber ? `f/${photo.FNumber}` : undefined, ISO: photo.ISOSpeedRatings,
          Software: img.Software,
        });
        if (gps.GPSLatitude && gps.GPSLongitude) {
          const deg = ([d, m, s], ref) => ((d + m / 60 + s / 3600) * (ref === 'S' || ref === 'W' ? -1 : 1)).toFixed(5);
          info.Location = `${deg(gps.GPSLatitude, gps.GPSLatitudeRef)}, ${deg(gps.GPSLongitude, gps.GPSLongitudeRef)}`;
        }
      } catch { /* malformed EXIF */ }
    }
  }
  return Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

async function stripMetadata(input, fmt, outDir) {
  if (fmt === 'pdf') {
    const output = out(input, 'No Metadata', 'pdf', outDir);
    await fs.writeFile(output, await stripPdfMetadata(await readBytes(input)));
    return output;
  }
  // sharp drops EXIF/XMP/IPTC unless asked to keep them; orientation is baked in by openImage.
  const target = ['heic', 'svg'].includes(fmt) ? 'jpg' : fmt;
  const output = out(input, 'No Metadata', target, outDir);
  await writeImage(await openImage(input, fmt), target, output, { quality: 92 });
  return output;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

// ---------- Dispatcher ----------

/**
 * Run a tool on one or more files. Returns the created file paths.
 * `toPdf(file)` converts any file to a temporary PDF (for Merge).
 */
export async function runTool(toolId, files, { outDir, ctx, toPdf } = {}) {
  if (outDir) await fs.mkdir(outDir, { recursive: true });
  const results = [];
  if (toolId === 'merge') {
    const pdfs = [];
    for (let i = 0; i < files.length; i++) {
      ctx?.progress(i / files.length, `Preparing ${path.basename(files[i])}`);
      pdfs.push(formatOf(files[i]) === 'pdf' ? files[i] : await toPdf(files[i]));
    }
    const merged = await mergePdfs(await Promise.all(pdfs.map(readBytes)));
    const output = uniquePath(outDir ?? path.dirname(files[0]), `${baseName(files[0])} Merged`, 'pdf');
    await fs.writeFile(output, merged);
    return [output];
  }

  for (const input of files) {
    const fmt = formatOf(input);
    const fam = familyOf(fmt);
    switch (toolId) {
      case 'compress':
        if (fam === 'image') results.push(await compressImage(input, fmt, outDir));
        else if (fmt === 'pdf') results.push(await compressPdf(input, outDir, ctx));
        else if (['docx', 'xlsx', 'pptx'].includes(fmt)) results.push(await compressOfficeZip(input, outDir));
        else results.push(await compressMedia(input, fmt, outDir, ctx));
        break;
      case 'metadata':
        results.push(await stripMetadata(input, fmt, outDir));
        break;
      case 'rotate':
        if (fmt === 'pdf') {
          const output = out(input, 'Rotated', 'pdf', outDir);
          await fs.writeFile(output, await rotatePdf(await readBytes(input), 90));
          results.push(output);
        } else {
          const target = ['mp4', 'mov', 'mkv'].includes(fmt) ? fmt : 'mp4';
          const output = out(input, 'Rotated', target, outDir);
          await ffmpeg(['-i', input, '-vf', 'transpose=1', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy', output], { ctx, label: 'Rotating' });
          results.push(output);
        }
        break;
      case 'split': {
        const parts = await splitPdf(await readBytes(input));
        const dir = uniquePath(outDir ?? path.dirname(input), `${baseName(input)} pages`, '');
        await fs.mkdir(dir, { recursive: true });
        const pad = String(parts.length).length;
        for (let i = 0; i < parts.length; i++) {
          const f = path.join(dir, `${baseName(input)} p${String(i + 1).padStart(pad, '0')}.pdf`);
          await fs.writeFile(f, parts[i]);
        }
        results.push(dir);
        break;
      }
      case 'mute': {
        const output = out(input, 'Muted', undefined, outDir);
        await ffmpeg(['-i', input, '-c:v', 'copy', '-an', output], { ctx, label: 'Muting' });
        results.push(output);
        break;
      }
      case 'snapshot': {
        const duration = await probeDuration(input);
        const at = duration ? Math.min(duration * 0.1, 5).toFixed(2) : '0';
        const output = out(input, 'Snapshot', 'jpg', outDir);
        await ffmpeg(['-ss', at, '-i', input, '-frames:v', '1', '-q:v', '2', output], { ctx });
        results.push(output);
        break;
      }
      case 'normalize': {
        const output = out(input, 'Normalized', undefined, outDir);
        await ffmpeg(['-i', input, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', output], { ctx, label: 'Normalizing' });
        results.push(output);
        break;
      }
      default:
        throw new Error(`Unknown tool: ${toolId}`);
    }
  }
  return results;
}
