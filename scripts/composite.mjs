// Dev helper: put a transparent window capture on a background so it's viewable.
//   node scripts/composite.mjs <in.png> <out.png> [width]
import sharp from 'sharp';

const [input, output, width] = process.argv.slice(2);
const m = await sharp(input).metadata();
const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7b733"/><stop offset=".5" stop-color="#fc4a1a"/><stop offset="1" stop-color="#8e9eec"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
const flat = await sharp(bg).composite([{ input }]).png().toBuffer();
await sharp(flat).resize(width ? +width : null).toFile(output);
