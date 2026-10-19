// Rebuilds readable structure (headings, paragraphs, lists, tables) from a PDF's
// positioned text runs. Used for PDF -> DOCX/HTML/MD/TXT/XLSX when Word isn't available.

import { escapeHtml, wrapHtml } from './markup.js';

const BULLET = /^([•·▪◦‣●○■□–—*-])\s+/;
const NUMBERED = /^(\(?\d{1,3}[.)]|[a-z][.)])\s+/i;

/** pdfjs PDFDocumentProxy -> { pages: [{ lines, blocks }], bodySize, title } */
export async function extractStructure(pdf, { maxPages = Infinity } = {}) {
  const pages = [];
  for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push({ lines: groupLines(content.items) });
    page.cleanup();
  }
  const bodySize = medianSize(pages.flatMap((p) => p.lines));
  for (const p of pages) p.blocks = toBlocks(p.lines, bodySize);
  let title = '';
  try {
    const meta = await pdf.getMetadata();
    title = meta?.info?.Title || '';
  } catch { /* no metadata */ }
  if (!title) title = pages[0]?.blocks.find((b) => /^h/.test(b.type))?.text ?? '';
  return { pages, bodySize, title };
}

function groupLines(items) {
  // pdf.js bridges column gaps with wide whitespace items; drop them so gaps stay visible.
  const runs = items
    .filter((it) => it.str !== undefined && it.str.trim() !== '')
    .map((it) => {
      const [a, b, c, d, x, y] = it.transform;
      const size = Math.hypot(c, d) || Math.hypot(a, b) || it.height || 10;
      return { str: it.str, x, y, w: it.width, size };
    })
    .sort((p, q) => q.y - p.y || p.x - q.x);

  const lines = [];
  for (const r of runs) {
    const line = lines.find((l) => Math.abs(l.y - r.y) < Math.min(l.size, r.size) * 0.45);
    if (line) {
      line.runs.push(r);
      line.size = Math.max(line.size, r.str.trim() ? r.size : 0);
    } else {
      lines.push({ y: r.y, size: r.str.trim() ? r.size : 0, runs: [r] });
    }
  }
  lines.sort((p, q) => q.y - p.y);

  for (const line of lines) {
    line.runs.sort((p, q) => p.x - q.x);
    // Split into cells on wide gaps (table columns), join runs with spaces on small gaps.
    const cells = [];
    let cur = null, prevEnd = -Infinity;
    for (const r of line.runs) {
      const gap = r.x - prevEnd;
      const s = line.size || r.size;
      if (!cur || gap > Math.max(s * 1.6, 9)) {
        cur = { x: r.x, text: r.str };
        cells.push(cur);
      } else {
        const needSpace = gap > s * 0.12 && !/\s$/.test(cur.text) && !/^\s/.test(r.str);
        cur.text += (needSpace ? ' ' : '') + r.str;
      }
      prevEnd = Math.max(prevEnd, r.x + r.w);
    }
    line.cells = cells.map((c) => ({ x: c.x, text: c.text.replace(/\s+/g, ' ').trim() })).filter((c) => c.text);
    line.text = line.cells.map((c) => c.text).join('  ');
    line.x = line.cells[0]?.x ?? 0;
  }
  return lines.filter((l) => l.text);
}

function medianSize(lines) {
  const sizes = [];
  for (const l of lines) for (let i = 0; i < Math.min(l.text.length, 200); i += 10) sizes.push(l.size);
  if (!sizes.length) return 11;
  sizes.sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)];
}

function headingLevel(line, body) {
  const r = line.size / body;
  if (line.text.length > 140) return 0;
  if (r >= 1.75) return 1;
  if (r >= 1.35) return 2;
  if (r >= 1.15) return 3;
  return 0;
}

function toBlocks(lines, body) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Table: 2+ consecutive lines with 3+ cells each.
    if (line.cells.length >= 3) {
      let j = i;
      while (j < lines.length && lines[j].cells.length >= 3 && !headingLevel(lines[j], body)) j++;
      if (j - i >= 2) {
        blocks.push({ type: 'table', rows: alignColumns(lines.slice(i, j)) });
        i = j;
        continue;
      }
    }

    const level = headingLevel(line, body);
    if (level) {
      // Multi-line headings share size and sit close together.
      let text = line.text, j = i + 1;
      while (j < lines.length && Math.abs(lines[j].size - line.size) < 0.5 &&
             lines[j - 1].y - lines[j].y < line.size * 1.6) text += ' ' + lines[j++].text;
      blocks.push({ type: `h${level}`, text });
      i = j;
      continue;
    }

    const listMatch = BULLET.exec(line.text) || NUMBERED.exec(line.text);
    if (listMatch) {
      const ordered = !BULLET.test(line.text);
      let text = line.text.slice(listMatch[0].length), j = i + 1;
      // Continuation lines are indented past the marker.
      while (j < lines.length && lines[j].x > line.x + 4 && !BULLET.test(lines[j].text) &&
             !NUMBERED.test(lines[j].text) && lines[j - 1].y - lines[j].y < lines[j].size * 1.7) {
        text = joinLine(text, lines[j++].text);
      }
      blocks.push({ type: 'li', ordered, text });
      i = j;
      continue;
    }

    let text = line.text, j = i + 1;
    while (j < lines.length) {
      const prev = lines[j - 1], next = lines[j];
      const gap = prev.y - next.y;
      if (gap > prev.size * 1.75 || Math.abs(next.size - prev.size) > 1 || headingLevel(next, body) ||
          BULLET.test(next.text) || NUMBERED.test(next.text) || next.cells.length >= 3) break;
      text = joinLine(text, next.text);
      j++;
    }
    blocks.push({ type: 'p', text });
    i = j;
  }
  return blocks;
}

function joinLine(a, b) {
  if (/[a-z]-$/i.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b; // de-hyphenate
  return `${a} ${b}`;
}

/** Snap cells from several lines onto shared column positions. */
function alignColumns(lines) {
  const xs = [];
  for (const l of lines) for (const c of l.cells) {
    if (!xs.some((x) => Math.abs(x - c.x) < 12)) xs.push(c.x);
  }
  xs.sort((a, b) => a - b);
  return lines.map((l) => {
    const row = Array(xs.length).fill('');
    for (const c of l.cells) {
      let best = 0;
      for (let k = 1; k < xs.length; k++) if (Math.abs(xs[k] - c.x) < Math.abs(xs[best] - c.x)) best = k;
      row[best] = row[best] ? `${row[best]} ${c.text}` : c.text;
    }
    return row;
  });
}

export function structureToHtml(doc, fallbackTitle = 'Document') {
  const out = [];
  doc.pages.forEach((page, pi) => {
    let list = null;
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const b of page.blocks) {
      if (b.type === 'li') {
        const tag = b.ordered ? 'ol' : 'ul';
        if (list !== tag) { closeList(); out.push(`<${tag}>`); list = tag; }
        out.push(`<li>${escapeHtml(b.text)}</li>`);
        continue;
      }
      closeList();
      if (b.type === 'table') {
        const [head, ...rows] = b.rows;
        out.push('<table>',
          `<tr>${head.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`,
          ...rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`),
          '</table>');
      } else {
        out.push(`<${b.type}>${escapeHtml(b.text)}</${b.type}>`);
      }
    }
    closeList();
    if (pi < doc.pages.length - 1) out.push('<div class="page-break" style="break-after: page; page-break-after: always"></div>');
  });
  return wrapHtml(out.join('\n'), doc.title || fallbackTitle);
}

export function structureToText(doc) {
  return doc.pages.map((p) => p.blocks.map((b) => {
    if (b.type === 'table') return b.rows.map((r) => r.join('\t')).join('\n');
    if (b.type === 'li') return `${b.ordered ? '1.' : '•'} ${b.text}`;
    return b.text;
  }).join('\n\n')).join('\n\n\f\n\n').trim() + '\n';
}

export function structureToMarkdown(doc) {
  return doc.pages.map((p) => p.blocks.map((b) => {
    if (b.type === 'table') {
      const cell = (c) => c.replace(/\|/g, '\\|');
      const [head, ...rows] = b.rows;
      return [`| ${head.map(cell).join(' | ')} |`, `|${' --- |'.repeat(head.length)}`,
        ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
    }
    if (b.type === 'li') return `${b.ordered ? '1.' : '-'} ${b.text}`;
    if (b.type[0] === 'h') return `${'#'.repeat(+b.type[1])} ${b.text}`;
    return b.text;
  }).join('\n\n')).join('\n\n---\n\n').trim() + '\n';
}

/** One sheet per page; every text line is a row, split into cells by column gaps. */
export function structureToSheets(doc) {
  return doc.pages.map((p, i) => ({
    name: doc.pages.length > 1 ? `Page ${i + 1}` : 'PDF',
    rows: p.lines.map((l) => l.cells.map((c) => c.text)),
  }));
}
