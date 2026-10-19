// Fast unit tests for the shared core (no Office, no ffmpeg): node --test test/unit.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversionGraph } from '../src/shared/graph.js';
import { formatOf, targetAllowed, splitName, sortTargets } from '../src/shared/formats.js';
import { toolsFor, suffixed } from '../src/shared/tools.js';
import { encodeBmp, decodeBmp, encodeIco, decodeIco, imageInfo } from '../src/shared/core/bitmap.js';
import { mdToHtml, htmlToMd, htmlToText, txtToHtml, htmlToDocx } from '../src/shared/core/markup.js';
import { readWorkbook, writeWorkbook, htmlToWorkbook } from '../src/shared/core/sheets.js';
import { imagesToPdf, mergePdfs, splitPdf, pdfPageCount } from '../src/shared/core/imagedocs.js';

const enc = new TextEncoder();

test('formatOf normalises names, aliases and MIME types', () => {
  assert.equal(formatOf('Photo.JPEG'), 'jpg');
  assert.equal(formatOf('report.final.DOCX'), 'docx');
  assert.equal(formatOf('image/heif'), 'heic');
  assert.equal(formatOf('application/pdf'), 'pdf');
  assert.equal(formatOf('archive.zip'), null);
  assert.deepEqual(splitName('C:\\a\\Report.v2.pdf'), { base: 'Report.v2', ext: 'pdf' });
});

test('targetAllowed blocks nonsense routes', () => {
  assert.ok(targetAllowed('docx', 'pdf'));
  assert.ok(targetAllowed('xlsx', 'docx'));
  assert.ok(targetAllowed('mp4', 'gif'));
  assert.ok(!targetAllowed('mp3', 'pdf'));
  assert.ok(!targetAllowed('png', 'md'));
  assert.ok(!targetAllowed('pdf', 'heic')); // input-only format
});

test('planner finds the cheapest multi-hop route and honours exclusions', () => {
  const g = new ConversionGraph();
  const run = () => {};
  g.add({ id: 'a', from: ['xlsx'], to: ['html'], cost: 1, run });
  g.add({ id: 'b', from: ['html'], to: ['docx', 'pdf'], cost: 1, run });
  g.add({ id: 'slow', from: ['xlsx'], to: ['docx'], cost: 5, run });
  const r = g.plan('xlsx', 'docx');
  assert.deepEqual(r.steps.map((s) => s.edge.id), ['a', 'b']);
  assert.deepEqual(g.plan('xlsx', 'docx', { exclude: new Set(['a']) }).steps.map((s) => s.edge.id), ['slow']);
  assert.equal(g.plan('docx', 'xlsx'), null);
});

test('terminal edges are never chained', () => {
  const g = new ConversionGraph();
  g.add({ id: 'pages', from: ['pdf'], to: ['png'], terminal: true, run() {} });
  g.add({ id: 'png2jpg', from: ['png'], to: ['jpg'], run() {} });
  assert.ok(g.plan('pdf', 'png'));
  assert.equal(g.plan('pdf', 'jpg'), null);
});

test('favourites order the wheel', () => {
  assert.deepEqual(sortTargets('pdf', ['png', 'txt', 'docx', 'jpg']), ['docx', 'jpg', 'png', 'txt']);
});

test('tools depend on the selection', () => {
  assert.ok(toolsFor(['jpg']).includes('crop'));
  assert.ok(!toolsFor(['jpg', 'png']).includes('crop'));
  assert.ok(toolsFor(['jpg', 'pdf'], { canPdf: () => true }).includes('merge'));
  assert.ok(toolsFor(['mp4']).includes('mute'));
  assert.ok(!toolsFor(['mp4'], { platform: 'extension' }).includes('mute'));
  assert.equal(suffixed('Page 001', 'Cropped'), 'Page 001 Cropped');
});

test('BMP and ICO round-trip', () => {
  const data = new Uint8Array(3 * 2 * 4).map((_, i) => (i * 37) % 256);
  const bmp = encodeBmp({ width: 3, height: 2, data });
  assert.deepEqual(imageInfo(bmp), { type: 'bmp', width: 3, height: 2 });
  assert.deepEqual(decodeBmp(bmp).data, data);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const ico = encodeIco([{ size: 16, png }, { size: 32, png }]);
  assert.deepEqual(decodeIco(ico).png, png);
});

test('markup conversions', () => {
  const html = mdToHtml('# Title\n\n**bold** and a [link](https://x.y)\n\n| a | b |\n|---|---|\n| 1 | 2 |', 'T');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(htmlToMd(html), /\| a \| b \|/);
  assert.match(htmlToText(html), /Title\n/);
  assert.match(txtToHtml('a & b\n\nc'), /<p>a &amp; b<\/p>/);
});

test('HTML becomes a valid DOCX', async () => {
  const docx = await htmlToDocx('<h1>Hi</h1><p>Text</p><table><tr><td>1</td></tr></table>');
  assert.equal(String.fromCharCode(docx[0], docx[1]), 'PK');
});

test('spreadsheets: CSV with semicolons, JSON, HTML tables', () => {
  const wb = readWorkbook(enc.encode('name;age\nAnna;31\n'), 'csv');
  assert.match(writeWorkbook(wb, 'json'), /"age": 31/);
  const fromJson = readWorkbook(enc.encode(JSON.stringify([{ a: { b: 1 } }])), 'json');
  assert.match(writeWorkbook(fromJson, 'csv'), /a\.b/);
  const fromHtml = htmlToWorkbook('<h2>Sales</h2><table><tr><th>Q1</th></tr><tr><td>5</td></tr></table>');
  assert.deepEqual(fromHtml.SheetNames, ['Sales']);
});

test('PDF assembly: images, merge, split', async () => {
  // 1×1 PNG
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const one = await imagesToPdf([{ bytes: png, type: 'png', width: 1, height: 1 }]);
  const two = await mergePdfs([one, one]);
  assert.equal(await pdfPageCount(two), 2);
  assert.equal((await splitPdf(two)).length, 2);
});
