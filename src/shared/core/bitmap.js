// BMP and ICO codecs (neither sharp nor <canvas> can write them), plus
// header sniffing for image dimensions. Pure JS, works in Node and the browser.

/** RGBA pixels -> 32-bit BMP (BITMAPV4HEADER, keeps alpha). */
export function encodeBmp({ width, height, data }) {
  const headerSize = 14 + 108;
  const rowBytes = width * 4;
  const size = headerSize + rowBytes * height;
  const buf = new Uint8Array(size);
  const v = new DataView(buf.buffer);
  buf[0] = 0x42; buf[1] = 0x4d; // "BM"
  v.setUint32(2, size, true);
  v.setUint32(10, headerSize, true);
  v.setUint32(14, 108, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true); // bottom-up
  v.setUint16(26, 1, true);
  v.setUint16(28, 32, true);
  v.setUint32(30, 3, true); // BI_BITFIELDS
  v.setUint32(34, rowBytes * height, true);
  v.setInt32(38, 2835, true); v.setInt32(42, 2835, true); // 72 dpi
  v.setUint32(54, 0x00ff0000, true); // R mask
  v.setUint32(58, 0x0000ff00, true); // G
  v.setUint32(62, 0x000000ff, true); // B
  v.setUint32(66, 0xff000000, true); // A
  v.setUint32(70, 0x57696e20, true); // "Win " colour space
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    let dst = headerSize + y * rowBytes;
    for (let x = 0; x < width; x++, dst += 4) {
      const s = src + x * 4;
      buf[dst] = data[s + 2]; buf[dst + 1] = data[s + 1]; buf[dst + 2] = data[s]; buf[dst + 3] = data[s + 3];
    }
  }
  return buf;
}

/**
 * BMP (or an ICO's headerless DIB when `dib` is true) -> { width, height, data: RGBA }.
 * Supports 1/4/8-bit palettes and 16/24/32-bit uncompressed or bitfield images.
 */
export function decodeBmp(bytes, { dib = false } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const base = dib ? 0 : 14;
  if (!dib && (b[0] !== 0x42 || b[1] !== 0x4d)) throw new Error('Not a BMP file');
  const hsize = v.getUint32(base, true);
  let width, height, bpp, compression = 0, colors = 0;
  if (hsize === 12) {
    width = v.getUint16(base + 4, true); height = v.getInt16(base + 6, true); bpp = v.getUint16(base + 10, true);
  } else {
    width = v.getInt32(base + 4, true); height = v.getInt32(base + 8, true);
    bpp = v.getUint16(base + 14, true); compression = v.getUint32(base + 16, true);
    colors = v.getUint32(base + 32, true);
  }
  if (dib) height = height / 2; // ICO DIBs include the AND mask in the height
  const topDown = height < 0;
  height = Math.abs(height);
  if (compression !== 0 && compression !== 3 && compression !== 6) throw new Error('Compressed (RLE) BMPs are not supported');

  let masks = null;
  if (compression === 3 || compression === 6) {
    const m = hsize >= 52 ? base + 40 : base + hsize; // masks follow a 40-byte header
    masks = [v.getUint32(m, true), v.getUint32(m + 4, true), v.getUint32(m + 8, true),
      compression === 6 || hsize >= 56 ? v.getUint32(m + 12, true) : 0];
  } else if (bpp === 16) {
    masks = [0x7c00, 0x03e0, 0x001f, 0];
  }

  const palEntry = hsize === 12 ? 3 : 4;
  const palOffset = base + hsize + (compression === 3 && hsize === 40 ? 12 : compression === 6 && hsize === 40 ? 16 : 0);
  const palette = [];
  if (bpp <= 8) {
    const n = colors || 1 << bpp;
    for (let i = 0; i < n; i++) {
      const o = palOffset + i * palEntry;
      palette.push([b[o + 2], b[o + 1], b[o]]);
    }
  }
  const dataOffset = dib ? palOffset + palette.length * palEntry : v.getUint32(10, true);
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const out = new Uint8Array(width * height * 4);
  const maskBits = (m) => {
    if (!m) return null;
    let shift = 0; while (!((m >>> shift) & 1)) shift++;
    let len = 0; while ((m >>> (shift + len)) & 1) len++;
    return { m, shift, max: (1 << len) - 1 };
  };
  const mk = masks?.map(maskBits);
  const chan = (px, k) => (mk[k] ? Math.round((((px & mk[k].m) >>> mk[k].shift) / mk[k].max) * 255) : 255);
  let anyAlpha = false;

  for (let y = 0; y < height; y++) {
    const row = dataOffset + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r, g, bl, a = 255;
      if (bpp <= 8) {
        const bit = x * bpp;
        const byte = b[row + (bit >> 3)];
        const idx = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        [r, g, bl] = palette[idx] || [0, 0, 0];
      } else if (bpp === 16) {
        const px = v.getUint16(row + x * 2, true);
        r = chan(px, 0); g = chan(px, 1); bl = chan(px, 2); a = mk[3] ? chan(px, 3) : 255;
      } else if (bpp === 24) {
        const p = row + x * 3; bl = b[p]; g = b[p + 1]; r = b[p + 2];
      } else if (bpp === 32) {
        if (mk) {
          const px = v.getUint32(row + x * 4, true);
          r = chan(px, 0); g = chan(px, 1); bl = chan(px, 2); a = mk[3] ? chan(px, 3) : 255;
        } else {
          const p = row + x * 4; bl = b[p]; g = b[p + 1]; r = b[p + 2]; a = b[p + 3];
        }
      } else {
        throw new Error(`Unsupported BMP bit depth ${bpp}`);
      }
      if (a) anyAlpha = true;
      out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = a;
    }
  }
  // 32-bit BI_RGB files usually leave alpha at 0 — treat as opaque.
  if (bpp === 32 && !anyAlpha) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  // ICO DIBs below 32-bit carry transparency in a trailing 1-bit AND mask.
  if (dib && bpp < 32) {
    const maskStride = Math.ceil(width / 32) * 4;
    const maskOffset = dataOffset + stride * height;
    for (let y = 0; y < height; y++) {
      const row = maskOffset + (height - 1 - y) * maskStride;
      for (let x = 0; x < width; x++) {
        if (row + (x >> 3) < b.length && (b[row + (x >> 3)] >> (7 - (x & 7))) & 1) out[(y * width + x) * 4 + 3] = 0;
      }
    }
  }
  return { width, height, data: out };
}

/** [{ size, png }] -> .ico bytes (PNG-compressed entries, Vista+). */
export function encodeIco(entries) {
  const count = entries.length;
  const total = 6 + 16 * count + entries.reduce((n, e) => n + e.png.length, 0);
  const buf = new Uint8Array(total);
  const v = new DataView(buf.buffer);
  v.setUint16(2, 1, true);
  v.setUint16(4, count, true);
  let offset = 6 + 16 * count;
  entries.forEach((e, i) => {
    const d = 6 + i * 16;
    buf[d] = e.size >= 256 ? 0 : e.size;
    buf[d + 1] = e.size >= 256 ? 0 : e.size;
    v.setUint16(d + 4, 1, true);
    v.setUint16(d + 6, 32, true);
    v.setUint32(d + 8, e.png.length, true);
    v.setUint32(d + 12, offset, true);
    buf.set(e.png, offset);
    offset += e.png.length;
  });
  return buf;
}

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Largest image in an .ico: { png: Uint8Array } or { width, height, data } */
export function decodeIco(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = v.getUint16(4, true);
  let best = null;
  for (let i = 0; i < count; i++) {
    const d = 6 + i * 16;
    const w = b[d] || 256, bpp = v.getUint16(d + 6, true);
    const size = v.getUint32(d + 8, true), offset = v.getUint32(d + 12, true);
    if (!best || w > best.w || (w === best.w && bpp > best.bpp)) best = { w, bpp, size, offset };
  }
  if (!best) throw new Error('Empty ICO file');
  const slice = b.subarray(best.offset, best.offset + best.size);
  if (slice[0] === 0x89 && slice[1] === 0x50) return { png: slice };
  return decodeBmp(slice, { dib: true });
}

/** Sniff type and pixel size from the first bytes of a PNG/JPEG/GIF/BMP/WebP. */
export function imageInfo(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] === 0x89 && b[1] === 0x50) return { type: 'png', width: v.getUint32(16), height: v.getUint32(20) };
  if (b[0] === 0x47 && b[1] === 0x49) return { type: 'gif', width: v.getUint16(6, true), height: v.getUint16(8, true) };
  if (b[0] === 0x42 && b[1] === 0x4d) return { type: 'bmp', width: v.getInt32(18, true), height: Math.abs(v.getInt32(22, true)) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const marker = b[o + 1];
      const len = v.getUint16(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpg', height: v.getUint16(o + 5), width: v.getUint16(o + 7) };
      }
      o += 2 + len;
    }
    return { type: 'jpg', width: 0, height: 0 };
  }
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { type: 'webp', width: 0, height: 0 };
  return { type: 'unknown', width: 0, height: 0 };
}
