// HTML -> PDF in the browser (extensions can't call Chrome's print engine).
// A small flow layout on pdf-lib: headings, paragraphs with bold/italic/code runs,
// lists, quotes, code blocks, tables, rules, images and page breaks. Text stays selectable.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const INK = rgb(0.11, 0.11, 0.12), SOFT = rgb(0.4, 0.4, 0.44), LINE = rgb(0.79, 0.79, 0.82), FILL = rgb(0.95, 0.95, 0.97);
const LINK = rgb(0.04, 0.4, 0.85);
const HEADINGS = { h1: 22, h2: 17, h3: 14, h4: 12.5, h5: 11.5, h6: 11 };
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'figure', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'blockquote', 'table', 'hr', 'dl', 'dt', 'dd', 'body', 'center', 'address']);
const SKIP = new Set(['script', 'style', 'head', 'noscript', 'template', 'svg', 'iframe', 'button', 'input', 'select', 'textarea']);
const CHAR_FALLBACK = { ' ': ' ', '\t': '    ', '→': '->', '←': '<-', '✓': 'v', '✔': 'v', '✕': 'x', '●': '•', '▪': '•', '−': '-', '‑': '-' };

export async function htmlToPdf(html, { title } = {}) {
  const dom = new DOMParser().parseFromString(String(html), 'text/html');
  const landscape = /@page\s*{[^}]*landscape/i.test(html);
  const pdf = await PDFDocument.create();
  pdf.setTitle(title || dom.title || 'Document');
  pdf.setCreator('Easy Convert');
  pdf.setProducer('Easy Convert');
  const F = {
    r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold),
    i: await pdf.embedFont(StandardFonts.HelveticaOblique), bi: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    m: await pdf.embedFont(StandardFonts.Courier), mb: await pdf.embedFont(StandardFonts.CourierBold),
  };
  const fontFor = (s) => (s.mono ? (s.bold ? F.mb : F.m) : s.bold ? (s.italic ? F.bi : F.b) : s.italic ? F.i : F.r);

  const [PW, PH] = landscape ? [841.89, 595.28] : [595.28, 841.89];
  const M = 54;
  let page, y;
  const newPage = () => { page = pdf.addPage([PW, PH]); y = PH - M; };
  newPage();
  const ensure = (h) => { if (y - h < M) newPage(); };

  // WinAnsi-safe text: standard fonts can't encode every Unicode character.
  const okChar = new Map();
  const safe = (str, font) => [...str].map((ch) => {
    const key = ch;
    if (!okChar.has(key)) {
      try { font.widthOfTextAtSize(ch, 10); okChar.set(key, ch); } catch { okChar.set(key, CHAR_FALLBACK[ch] ?? '?'); }
    }
    return okChar.get(key);
  }).join('');

  // ---------- inline runs ----------

  function collectRuns(node, style, runs) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        runs.push({ text: n.data.replace(/\s+/g, ' '), ...style });
      } else if (n.nodeType === 1) {
        const tag = n.tagName.toLowerCase();
        if (SKIP.has(tag)) continue;
        if (tag === 'br') { runs.push({ text: '\n', ...style }); continue; }
        const st = { ...style };
        if (['b', 'strong', 'th'].includes(tag) || /font-weight:\s*(bold|[6-9]00)/.test(n.getAttribute('style') || '')) st.bold = true;
        if (['i', 'em', 'cite', 'var'].includes(tag) || /font-style:\s*italic/.test(n.getAttribute('style') || '')) st.italic = true;
        if (['code', 'kbd', 'samp', 'tt'].includes(tag)) st.mono = true;
        if (tag === 'a' && n.getAttribute('href')) { st.link = true; }
        collectRuns(n, st, runs);
      }
    }
    return runs;
  }

  /** Break runs into lines no wider than `width`. Each line: [{text, font, size, link}] */
  function wrap(runs, width, size) {
    const lines = [];
    let line = [], lineW = 0;
    const push = () => { lines.push(line); line = []; lineW = 0; };
    for (const run of runs) {
      const font = fontFor(run);
      const sz = run.mono ? size * 0.92 : size;
      for (const part of run.text.split(/(\n| +)/)) {
        if (!part) continue;
        if (part === '\n') { push(); continue; }
        const t = safe(part, font);
        let w = font.widthOfTextAtSize(t, sz);
        if (/^ +$/.test(part)) { if (line.length) { line.push({ text: ' ', font, size: sz, link: run.link, w: font.widthOfTextAtSize(' ', sz) }); lineW += font.widthOfTextAtSize(' ', sz); } continue; }
        if (lineW + w > width && line.length) {
          while (line.length && line[line.length - 1].text === ' ') lineW -= line.pop().w;
          push();
        }
        // A single word wider than the line gets split by characters.
        if (w > width) {
          let chunk = '';
          for (const ch of t) {
            if (font.widthOfTextAtSize(chunk + ch, sz) > width) { line.push({ text: chunk, font, size: sz, link: run.link, w: font.widthOfTextAtSize(chunk, sz) }); push(); chunk = ''; }
            chunk += ch;
          }
          line.push({ text: chunk, font, size: sz, link: run.link, w: font.widthOfTextAtSize(chunk, sz) });
          lineW = line.reduce((a, s) => a + s.w, 0);
          continue;
        }
        line.push({ text: t, font, size: sz, link: run.link, w });
        lineW += w;
      }
    }
    if (line.length) push();
    return lines.filter((l, i, all) => l.length || (i > 0 && i < all.length - 1));
  }

  function drawLines(lines, x, size, { color = INK, lh = 1.42 } = {}) {
    for (const l of lines) {
      const h = size * lh;
      ensure(h);
      let cx = x;
      for (const s of l) {
        if (s.text.trim()) page.drawText(s.text, { x: cx, y: y - size, size: s.size, font: s.font, color: s.link ? LINK : color });
        cx += s.w;
      }
      y -= h;
    }
  }

  function paragraph(node, { x = M, width = PW - 2 * M, size = 10.5, bold = false, color, marker, gapAfter = size * 0.6 } = {}) {
    const runs = collectRuns(node, { bold }, []);
    if (!runs.some((r) => r.text.trim())) return;
    // Trim leading/trailing whitespace of the paragraph.
    runs[0].text = runs[0].text.replace(/^\s+/, '');
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '');
    const lines = wrap(runs, width, size);
    if (marker) {
      ensure(size * 1.42);
      page.drawText(safe(marker, F.r), { x: x - F.r.widthOfTextAtSize(safe(marker, F.r), size) - 6, y: y - size, size, font: F.r, color: SOFT });
    }
    drawLines(lines, x, size, { color });
    y -= gapAfter;
  }

  // ---------- blocks ----------

  function block(node, indent = 0, listCtx = null) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        if (n.data.trim()) paragraph({ childNodes: [n] }, { x: M + indent, width: PW - 2 * M - indent });
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (SKIP.has(tag)) continue;
      const style = n.getAttribute('style') || '';
      if (/page-break-(after|before):\s*always|break-(after|before):\s*page/.test(style) || n.classList?.contains('page-break')) {
        if (y < PH - M - 1) newPage();
        continue;
      }
      if (HEADINGS[tag]) {
        const size = HEADINGS[tag];
        y -= size * 0.5;
        ensure(size * 3);
        paragraph(n, { x: M + indent, width: PW - 2 * M - indent, size, bold: true, gapAfter: size * 0.35 });
      } else if (tag === 'p' || ((tag === 'div' || tag === 'dd' || tag === 'dt' || tag === 'figcaption') && !hasBlockChild(n))) {
        paragraph(n, { x: M + indent, width: PW - 2 * M - indent, bold: tag === 'dt' });
      } else if (tag === 'ul' || tag === 'ol') {
        let i = Number(n.getAttribute('start') || 1);
        for (const li of n.children) {
          if (li.tagName.toLowerCase() !== 'li') continue;
          const marker = tag === 'ol' ? `${i++}.` : indent ? '◦' : '•';
          listItem(li, indent + 18, marker);
        }
        y -= 4;
      } else if (tag === 'pre') {
        const size = 8.6, lh = size * 1.35;
        const lines = n.textContent.replace(/\n$/, '').split('\n');
        for (let k = 0; k < lines.length; k++) {
          ensure(lh + 6);
          if (k === 0) y -= 4;
          page.drawRectangle({ x: M + indent - 6, y: y - lh - 2, width: PW - 2 * M - indent + 12, height: lh + 2, color: FILL });
          const wrapped = wrap([{ text: lines[k] || ' ', mono: true }], PW - 2 * M - indent, size);
          drawLines(wrapped.length ? wrapped : [[]], M + indent, size, { lh: 1.35 });
        }
        y -= 10;
      } else if (tag === 'blockquote') {
        const top = y;
        block(n, indent + 16);
        if (page && top > y) page.drawRectangle({ x: M + indent + 4, y, width: 2.5, height: Math.min(top - y, PH), color: LINE });
      } else if (tag === 'table') {
        table(n, indent);
      } else if (tag === 'hr') {
        ensure(16);
        y -= 6;
        page.drawLine({ start: { x: M + indent, y }, end: { x: PW - M, y }, thickness: 0.8, color: LINE });
        y -= 10;
      } else if (tag === 'img') {
        image(n, indent);
      } else if (BLOCK.has(tag) || hasBlockChild(n)) {
        block(n, indent, listCtx);
      } else {
        paragraph({ childNodes: [n] }, { x: M + indent, width: PW - 2 * M - indent });
      }
    }
  }

  function listItem(li, indent, marker) {
    // Text before any nested list is the item's own paragraph.
    const own = document.createElement('div');
    const nested = [];
    for (const c of [...li.childNodes]) {
      if (c.nodeType === 1 && ['ul', 'ol'].includes(c.tagName.toLowerCase())) nested.push(c);
      else own.appendChild(c.cloneNode(true));
    }
    paragraph(own, { x: M + indent, width: PW - 2 * M - indent, marker, gapAfter: 3 });
    for (const n of nested) block({ childNodes: [n] }, indent);
  }

  function table(t, indent) {
    const rows = [...t.querySelectorAll('tr')].filter((tr) => tr.closest('table') === t);
    if (!rows.length) return;
    const grid = rows.map((tr) => [...tr.children].filter((c) => /^t[dh]$/i.test(c.tagName)));
    const cols = Math.max(...grid.map((r) => r.reduce((a, c) => a + (+c.getAttribute('colspan') || 1), 0)));
    const avail = PW - 2 * M - indent;
    // Column widths follow content length, within sensible bounds.
    const weight = Array(cols).fill(1);
    for (const r of grid) {
      let ci = 0;
      for (const c of r) {
        const span = +c.getAttribute('colspan') || 1;
        if (span === 1) weight[ci] = Math.max(weight[ci], Math.min(40, c.textContent.trim().length));
        ci += span;
      }
    }
    const total = weight.reduce((a, b) => a + b, 0);
    const widths = weight.map((w) => Math.max(36, (w / total) * avail));
    const scale = avail / widths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cols; i++) widths[i] *= scale;
    const size = cols > 7 ? 8 : 9.5, padX = 5, padY = 4;
    y -= 4;
    grid.forEach((r, ri) => {
      const header = r.every((c) => c.tagName.toLowerCase() === 'th') || (ri === 0 && t.querySelector('thead'));
      let ci = 0;
      const cells = r.map((c) => {
        const span = +c.getAttribute('colspan') || 1;
        const w = widths.slice(ci, ci + span).reduce((a, b) => a + b, 0);
        const x = M + indent + widths.slice(0, ci).reduce((a, b) => a + b, 0);
        ci += span;
        const runs = collectRuns(c, { bold: header }, []);
        if (runs.length) { runs[0].text = runs[0].text.replace(/^\s+/, ''); runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, ''); }
        return { x, w, lines: wrap(runs, w - 2 * padX, size), right: /text-align:\s*right/.test(c.getAttribute('style') || '') };
      });
      const h = Math.max(size * 1.35 + 2 * padY, ...cells.map((c) => c.lines.length * size * 1.35 + 2 * padY));
      ensure(h);
      for (const c of cells) {
        page.drawRectangle({ x: c.x, y: y - h, width: c.w, height: h, borderColor: LINE, borderWidth: 0.6, color: header ? FILL : undefined });
        let ly = y - padY;
        for (const l of c.lines) {
          const lw = l.reduce((a, s) => a + s.w, 0);
          let cx = c.right ? c.x + c.w - padX - lw : c.x + padX;
          for (const s of l) {
            if (s.text.trim()) page.drawText(s.text, { x: cx, y: ly - size, size: s.size, font: s.font, color: INK });
            cx += s.w;
          }
          ly -= size * 1.35;
        }
      }
      y -= h;
    });
    y -= 10;
  }

  async function embedImage(src) {
    const m = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(src || '');
    if (!m) return null;
    const data = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    return m[1].toLowerCase() === 'png' ? pdf.embedPng(data) : pdf.embedJpg(data);
  }
  const imageJobs = [];
  function image(img, indent) {
    // Images are embedded asynchronously; reserve their place in the flow.
    const src = img.getAttribute('src');
    imageJobs.push({ src, page, y, indent });
    const w = Math.min(PW - 2 * M - indent, +img.getAttribute('width') || 400);
    const h = +img.getAttribute('height') || w * 0.6;
    ensure(h);
    imageJobs[imageJobs.length - 1] = { src, page, top: y, indent, w, h };
    y -= h + 8;
  }

  block(dom.body);
  for (const job of imageJobs) {
    try {
      const em = await embedImage(job.src);
      if (!em) continue;
      const k = Math.min(job.w / em.width, job.h / em.height);
      job.page.drawImage(em, { x: M + job.indent, y: job.top - em.height * k, width: em.width * k, height: em.height * k });
    } catch { /* skip broken images */ }
  }
  return pdf.save();
}

function hasBlockChild(n) {
  for (const c of n.children) if (BLOCK.has(c.tagName.toLowerCase()) || c.tagName.toLowerCase() === 'img') return true;
  return false;
}
