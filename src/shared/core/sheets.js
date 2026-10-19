// Spreadsheet & data conversions (SheetJS). Runs in Node and the browser.

import * as XLSX from 'xlsx';
import { parseDocument, DomUtils } from 'htmlparser2';
import { escapeHtml, wrapHtml } from './markup.js';

const textDecoder = new TextDecoder('utf-8');

export function readWorkbook(bytes, fmt) {
  if (fmt === 'json') {
    const data = JSON.parse(stripBom(textDecoder.decode(bytes)));
    return jsonToWorkbook(data);
  }
  if (fmt === 'csv' || fmt === 'tsv') {
    const text = stripBom(textDecoder.decode(bytes));
    const FS = fmt === 'tsv' ? '\t' : sniffDelimiter(text);
    return XLSX.read(text, { type: 'string', FS, raw: false, cellDates: true });
  }
  return XLSX.read(bytes, { type: 'array', cellDates: true, cellNF: true });
}

const stripBom = (s) => s.replace(/^﻿/, '');

/** CSVs from European Excel use ';' — pick whichever separator is most consistent. */
function sniffDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ',', bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => l.split(d).length - 1);
    if (!counts.length || counts[0] === 0) continue;
    const consistent = counts.filter((c) => c === counts[0]).length;
    const score = consistent * 10 + counts[0];
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

function jsonToWorkbook(data) {
  const wb = XLSX.utils.book_new();
  const addSheet = (name, value) => {
    const rows = Array.isArray(value) ? value : [value];
    const ws = rows.every((r) => Array.isArray(r))
      ? XLSX.utils.aoa_to_sheet(rows)
      : XLSX.utils.json_to_sheet(rows.map(flatten));
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(name, wb));
  };
  // { "Sheet A": [...], "Sheet B": [...] } becomes one sheet per key.
  if (data && !Array.isArray(data) && typeof data === 'object' && Object.values(data).every(Array.isArray)) {
    for (const [k, v] of Object.entries(data)) addSheet(k, v);
  } else {
    addSheet('Data', data);
  }
  return wb;
}

/** Nested objects become dotted columns: { a: { b: 1 } } -> { "a.b": 1 } */
function flatten(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') {
    out[prefix || 'value'] = obj;
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

function safeSheetName(name, wb) {
  let base = String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
  let n = base, i = 2;
  while (wb.SheetNames.includes(n)) n = `${base.slice(0, 28)} ${i++}`;
  return n;
}

const nonEmptySheets = (wb) =>
  wb.SheetNames.filter((n) => {
    const ws = wb.Sheets[n];
    return ws && ws['!ref'];
  });

const BOOK_TYPES = { xlsx: 'xlsx', xls: 'biff8', ods: 'ods' };

/** Workbook -> bytes (Uint8Array) or string for text formats. */
export function writeWorkbook(wb, fmt, title = 'Workbook') {
  if (BOOK_TYPES[fmt]) {
    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: BOOK_TYPES[fmt], compression: true }));
  }
  const sheets = nonEmptySheets(wb);
  switch (fmt) {
    case 'csv':
    case 'tsv': {
      const FS = fmt === 'csv' ? ',' : '\t';
      // Multiple sheets are stacked with a title row each so nothing is silently dropped.
      if (sheets.length <= 1) return '﻿' + XLSX.utils.sheet_to_csv(wb.Sheets[sheets[0] ?? wb.SheetNames[0]], { FS });
      return '﻿' + sheets.map((n) => `${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS })}`).join('\n\n');
    }
    case 'json': {
      const toJson = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null, raw: true });
      const value = sheets.length <= 1 ? toJson(sheets[0] ?? wb.SheetNames[0]) : Object.fromEntries(sheets.map((n) => [n, toJson(n)]));
      return JSON.stringify(value, null, 2) + '\n';
    }
    case 'html':
      return workbookToHtml(wb, title);
    case 'md':
      return sheets.map((n) => (sheets.length > 1 ? `## ${n}\n\n` : '') + sheetToMarkdown(wb.Sheets[n])).join('\n\n') + '\n';
    case 'txt':
      return sheets.map((n) => (sheets.length > 1 ? `${n}\n` : '') + XLSX.utils.sheet_to_txt(wb.Sheets[n]).replace(/^﻿/, '')).join('\n\n');
    default:
      throw new Error(`Can't write a workbook as ${fmt}`);
  }
}

function sheetToRows(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
}

function sheetToMarkdown(ws) {
  const rows = sheetToRows(ws);
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const line = (r) => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(' | ')} |`;
  return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n');
}

export function workbookToHtml(wb, title) {
  const sheets = nonEmptySheets(wb);
  let widest = 0;
  const parts = sheets.map((name) => {
    const ws = wb.Sheets[name];
    const range = XLSX.utils.decode_range(ws['!ref']);
    widest = Math.max(widest, range.e.c - range.s.c + 1);
    // sheet_to_html keeps merged cells; we only need its <table>.
    const html = XLSX.utils.sheet_to_html(ws, { header: '', footer: '' });
    const table = /<table[\s\S]*<\/table>/i.exec(html)?.[0] ?? '';
    const heading = sheets.length > 1 ? `<h2>${escapeHtml(name)}</h2>\n` : '';
    return heading + table.replace(/<td([^>]*)\bdata-t="n"/g, '<td$1data-t="n" style="text-align:right"');
  });
  const firstRowCss = 'table tr:first-child td { font-weight: 600; background: #f2f2f6; }';
  return wrapHtml(parts.join('\n<div style="height:12px"></div>\n'), title, {
    landscape: widest > 7,
    extraCss: firstRowCss,
  });
}

/**
 * HTML -> workbook: one sheet per <table> (headings above a table name its sheet).
 * Documents without tables become one sheet with a row per paragraph.
 */
export function htmlToWorkbook(html) {
  const dom = parseDocument(String(html));
  const text = (n) => DomUtils.textContent(n).replace(/\s+/g, ' ').trim();
  const tables = DomUtils.findAll((n) => n.name === 'table', dom.children)
    .filter((t) => !DomUtils.findOne((n) => n.name === 'table', t.children, true)); // innermost only
  const sheets = tables.map((t, i) => {
    const rows = DomUtils.findAll((n) => n.name === 'tr', t.children).map((tr) => {
      const cells = [];
      for (const c of tr.children.filter((n) => n.name === 'td' || n.name === 'th')) {
        cells.push(text(c));
        for (let k = 1; k < (+c.attribs?.colspan || 1); k++) cells.push('');
      }
      return cells;
    });
    let prev = DomUtils.prevElementSibling(t);
    while (prev && !/^h[1-6]$/.test(prev.name) && prev.name !== 'p') prev = DomUtils.prevElementSibling(prev);
    const name = prev && /^h[1-6]$/.test(prev.name) ? text(prev) : `Table ${i + 1}`;
    return { name, rows };
  }).filter((s) => s.rows.length);
  if (!sheets.length) {
    const blocks = DomUtils.findAll((n) => /^(h[1-6]|p|li|pre)$/.test(n.name), dom.children).map((n) => [text(n)]).filter((r) => r[0]);
    sheets.push({ name: 'Document', rows: blocks });
  }
  return rowsToWorkbook(sheets);
}

/** Rows of text (e.g. extracted from a PDF) -> workbook. */
export function rowsToWorkbook(sheets) {
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows.map((r) => r.map(numberish))), safeSheetName(name, wb));
  }
  return wb;
}

function numberish(v) {
  const s = String(v).trim();
  if (/^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(s) || /^-?\d+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
  return s;
}
