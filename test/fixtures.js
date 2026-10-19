// Generates sample files of every family into .test-out/fixtures.

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import * as XLSX from 'xlsx';
import PptxGenJS from 'pptxgenjs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { htmlToDocx } from '../src/shared/core/markup.js';
import { run } from '../src/desktop/convert/util.js';
import { FFMPEG } from '../src/desktop/convert/media.js';

export const ROOT = path.resolve('.test-out');
export const FIX = path.join(ROOT, 'fixtures');

const HTML = `<h1>Quarterly Report</h1>
<p>This is a <b>sample</b> document with <i>formatting</i>, a list and a table.</p>
<ul><li>Revenue grew 12%</li><li>Costs fell 3%</li></ul>
<table><tr><th>Region</th><th>Q1</th><th>Q2</th></tr><tr><td>North</td><td>120</td><td>140</td></tr><tr><td>South</td><td>90</td><td>110</td></tr></table>
<h2>Next steps</h2><p>Ship the new product line in Q3.</p>`;

export async function makeFixtures() {
  await fs.mkdir(FIX, { recursive: true });
  const f = (n) => path.join(FIX, n);

  await fs.writeFile(f('report.html'), `<!doctype html><html><head><title>Report</title></head><body>${HTML}</body></html>`);
  await fs.writeFile(f('report.docx'), await htmlToDocx(HTML, { title: 'Quarterly Report' }));
  await fs.writeFile(f('notes.md'), '# Notes\n\nSome **bold** text.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
  await fs.writeFile(f('plain.txt'), 'Hello from a text file.\n\nSecond paragraph, with unicode: café, naïve, €100.\n');

  const rows = [['Region', 'Q1', 'Q2', 'Q3'], ['North', 120, 140, 160], ['South', 90, 110, 95], ['East', 75, 80, 99]];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sales');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Item', 'Cost'], ['Rent', 1000], ['Power', 120]]), 'Costs');
  await fs.writeFile(f('sales.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  await fs.writeFile(f('people.csv'), 'name;age;city\nAnna;31;Milano\nLuca;28;Roma\n');
  await fs.writeFile(f('items.json'), JSON.stringify([{ id: 1, name: 'Pen', price: { eur: 1.5 } }, { id: 2, name: 'Book', price: { eur: 12 } }]));

  const pptx = new PptxGenJS();
  pptx.addSlide().addText('Hello slides', { x: 1, y: 1, w: 8, h: 1.5, fontSize: 40, color: '0071E3' });
  pptx.addSlide().addText('Second slide', { x: 1, y: 1, w: 8, h: 1.5, fontSize: 32 });
  await fs.writeFile(f('deck.pptx'), await pptx.write({ outputType: 'nodebuffer' }));

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let p = 1; p <= 2; p++) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`Chapter ${p}`, { x: 50, y: 770, size: 26, font: bold });
    let y = 730;
    for (const line of ['This PDF was generated for testing. It has a heading,', 'a paragraph spanning a couple of lines, and a table below.']) {
      page.drawText(line, { x: 50, y, size: 11, font }); y -= 15;
    }
    y -= 20;
    for (const r of rows) {
      r.forEach((c, i) => page.drawText(String(c), { x: 50 + i * 110, y, size: 11, font }));
      y -= 18;
    }
    page.drawRectangle({ x: 50, y: 300, width: 200, height: 120, color: rgb(0.2, 0.5, 0.9) });
  }
  await fs.writeFile(f('chapter.pdf'), await pdf.save());

  const gradient = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><defs><linearGradient id="g"><stop offset="0" stop-color="#ff5f6d"/><stop offset="1" stop-color="#ffc371"/></linearGradient></defs><rect width="640" height="420" fill="url(#g)"/><circle cx="320" cy="210" r="120" fill="#fff" fill-opacity=".6"/></svg>`;
  await fs.writeFile(f('logo.svg'), gradient);
  await sharp(Buffer.from(gradient)).jpeg().toFile(f('photo.jpg'));
  await sharp(Buffer.from(gradient)).png().toFile(f('graphic.png'));

  await run(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f('clip.mp4')]);
  await run(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', f('tone.wav')]);
  return FIX;
}
