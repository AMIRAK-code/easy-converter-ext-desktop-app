// Office-free document and spreadsheet edges.

import fs from 'node:fs/promises';
import mammoth from 'mammoth';
import { mdToHtml, txtToHtml, htmlToMd, htmlToText, htmlToDocx, wrapHtml } from '../../shared/core/markup.js';
import { readWorkbook, writeWorkbook, htmlToWorkbook } from '../../shared/core/sheets.js';
import { baseName, readBytes } from './util.js';

const readText = async (f) => (await fs.readFile(f, 'utf8')).replace(/^﻿/, '');

export function docEdges({ host } = {}) {
  const edges = [
    {
      id: 'mammoth',
      from: ['docx'],
      to: ['html', 'txt'],
      cost: 2.5,
      async run({ input, to, output }) {
        const buffer = await fs.readFile(input);
        if (to === 'txt') {
          const { value } = await mammoth.extractRawText({ buffer });
          await fs.writeFile(output, value.replace(/\n{3,}/g, '\n\n'));
        } else {
          const { value } = await mammoth.convertToHtml({ buffer });
          await fs.writeFile(output, wrapHtml(value, baseName(input)));
        }
        return output;
      },
    },
    {
      id: 'markup',
      from: ['md', 'txt', 'html'],
      to: ['html', 'md', 'txt'],
      cost: (from, to) => (from === 'txt' && to === 'md' ? 1.3 : 1),
      async run({ input, from, to, output }) {
        const text = await readText(input);
        const title = baseName(input);
        let out;
        if (to === 'html') out = from === 'md' ? mdToHtml(text, title) : txtToHtml(text, title);
        else if (to === 'md') out = from === 'html' ? htmlToMd(text) : text;
        else out = from === 'html' ? htmlToText(text) : text; // md -> txt keeps the markdown source
        await fs.writeFile(output, out);
        return output;
      },
    },
    {
      id: 'html-docx',
      from: ['html'],
      to: ['docx'],
      cost: 2.5,
      async run({ input, output }) {
        await fs.writeFile(output, await htmlToDocx(await readText(input), { title: baseName(input) }));
        return output;
      },
    },
    {
      id: 'sheetjs',
      from: ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'csv', 'tsv', 'json'],
      to: ['xlsx', 'xls', 'ods', 'csv', 'tsv', 'json', 'html', 'md', 'txt'],
      // Cheap for data formats; Excel is preferred for workbook <-> workbook (keeps styles).
      cost: (from, to) => {
        const book = (f) => ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'].includes(f);
        if (book(from) && book(to)) return 2;
        if (book(from) && to === 'html') return 2;
        if (to === 'txt') return 1.6;
        return 1;
      },
      async run({ input, from, to, output }) {
        const wb = readWorkbook(await readBytes(input), from);
        await fs.writeFile(output, writeWorkbook(wb, to, baseName(input)));
        return output;
      },
    },
    {
      id: 'html-tables',
      from: ['html'],
      to: ['xlsx'],
      cost: 1.5,
      async run({ input, output }) {
        await fs.writeFile(output, writeWorkbook(htmlToWorkbook(await readText(input)), 'xlsx'));
        return output;
      },
    },
  ];

  if (host) {
    // Chromium's print engine renders HTML (and so Markdown, text, sheets) to PDF faithfully.
    edges.push({
      id: 'chromium-pdf',
      from: ['html'],
      to: ['pdf'],
      cost: 1.2,
      async run({ input, output }) {
        await host('printToPDF', { input, output });
        return output;
      },
    });
  }
  return edges;
}
