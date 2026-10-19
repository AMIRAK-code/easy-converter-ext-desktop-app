// Text, Markdown and HTML conversions that run the same in Node and the browser.

import { marked } from 'marked';
import TurndownService from 'turndown';
import { parseDocument, DomUtils } from 'htmlparser2';
import { htmlToContent } from 'docx/html';
import { Document, Packer, PageOrientation } from 'docx';

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const PAGE_CSS = `
  :root { color-scheme: light; }
  body { font: 11pt/1.55 "Segoe UI", system-ui, -apple-system, Helvetica, Arial, sans-serif; color: #1d1d1f;
         max-width: 820px; margin: 32px auto; padding: 0 24px; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.4em 0 .5em; }
  h1 { font-size: 1.9em; } h2 { font-size: 1.45em; } h3 { font-size: 1.2em; }
  p { margin: 0 0 .8em; }
  pre { background: #f5f5f7; padding: 12px 14px; border-radius: 8px; overflow: auto; white-space: pre-wrap; }
  code { font-family: Consolas, "Cascadia Mono", monospace; font-size: .92em; }
  :not(pre) > code { background: #f2f2f5; padding: 1px 5px; border-radius: 4px; }
  blockquote { margin: 0 0 1em; padding: 4px 16px; border-left: 3px solid #d0d0d7; color: #555; }
  table { border-collapse: collapse; margin: 0 0 1.2em; font-size: .95em; }
  th, td { border: 1px solid #c9c9d1; padding: 5px 9px; text-align: left; vertical-align: top; }
  th { background: #f2f2f6; }
  img { max-width: 100%; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 1.5em 0; }
  .page-break { break-after: page; }
  @media print { body { margin: 0; max-width: none; } }
`;

export function wrapHtml(body, title = 'Document', { landscape = false, extraCss = '' } = {}) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}${landscape ? '@page { size: A4 landscape; }' : '@page { size: A4; margin: 18mm; }'}${extraCss}</style>
</head><body>
${body}
</body></html>`;
}

export function mdToHtml(md, title) {
  return wrapHtml(marked.parse(String(md), { gfm: true, breaks: false }), title);
}

export function txtToHtml(txt, title) {
  const paras = String(txt).replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const body = paras
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return wrapHtml(body, title);
}

let turndown;
function getTurndown() {
  if (turndown) return turndown;
  turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  turndown.remove(['script', 'style', 'noscript', 'head', 'title']);
  // GitHub-style pipe tables (turndown drops tables by default).
  const cellText = (n) => turndown.turndown(n.innerHTML ?? '').replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim();
  // Plain childNodes walking: Node's DOM shim lacks querySelectorAll/children.
  const elements = (node) => [...node.childNodes].filter((c) => c.nodeType === 1);
  const rowsOf = (node) => elements(node).flatMap((c) => (c.nodeName === 'TR' ? [c] : c.nodeName === 'TABLE' ? [] : rowsOf(c)));
  turndown.addRule('table', {
    filter: 'table',
    replacement(_content, node) {
      const rows = rowsOf(node).map((tr) => elements(tr).filter((c) => /^T[DH]$/.test(c.nodeName)).map(cellText));
      if (!rows.length) return '';
      const width = Math.max(...rows.map((r) => r.length));
      const pad = (r) => [...r, ...Array(width - r.length).fill('')];
      const [head, ...rest] = rows.map(pad);
      const line = (r) => `| ${r.join(' | ')} |`;
      return `\n\n${[line(head), line(head.map(() => '---')), ...rest.map(line)].join('\n')}\n\n`;
    },
  });
  return turndown;
}

export function htmlToMd(html) {
  return getTurndown().turndown(String(html)).trim() + '\n';
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'pre', 'blockquote', 'table', 'ul', 'ol', 'br', 'hr', 'title',
]);

export function htmlToText(html) {
  const dom = parseDocument(String(html));
  let out = '';
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type === 'text') out += n.data.replace(/\s+/g, ' ');
      else if (n.type === 'tag' || n.type === 'script' || n.type === 'style') {
        if (['script', 'style', 'head', 'noscript'].includes(n.name)) continue;
        if (n.name === 'td' || n.name === 'th') out += '\t';
        walk(n.children || []);
        if (BLOCK_TAGS.has(n.name)) out += '\n';
      }
    }
  };
  walk(dom.children);
  return decodeEntities(out)
    .split('\n').map((l) => l.replace(/^\t/, '').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return named[e.toLowerCase()] ?? m;
  });
}

/** Text content of the <title> or first heading, for document metadata. */
export function htmlTitle(html) {
  const dom = parseDocument(String(html));
  const t = DomUtils.findOne((n) => n.name === 'title' || /^h[1-3]$/.test(n.name), dom.children, true);
  return t ? DomUtils.textContent(t).trim().slice(0, 120) : '';
}

/** Body of an HTML document (or the input if it's already a fragment). */
export function htmlBody(html) {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return m ? m[1] : html;
}

/** Style rules from <style> blocks, so docx/html can honour them. */
function htmlStyles(html) {
  return [...String(html).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
}

/** HTML -> DOCX bytes (Uint8Array). Wide tables switch the page to landscape. */
export async function htmlToDocx(html, { title, images } = {}) {
  const body = htmlBody(html);
  const widest = Math.max(0, ...[...body.matchAll(/<tr[\s>][\s\S]*?<\/tr>/gi)]
    .map((m) => (m[0].match(/<t[dh][\s>]/gi) || []).length));
  const landscape = widest > 7;
  const children = htmlToContent(body, {
    stylesheet: htmlStyles(html),
    images,
    maxImageWidth: landscape ? 860 : 601,
  });
  const doc = new Document({
    title: title || htmlTitle(html) || undefined,
    creator: 'Easy Convert',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{
      properties: landscape ? { page: { size: { orientation: PageOrientation.LANDSCAPE } } } : {},
      children: children.length ? children : [],
    }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}
