// Microsoft Office edges (best quality). Only registered when Office is installed.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './util.js';

const SCRIPT = fileURLToPath(new URL('./office.ps1', import.meta.url)).replace('app.asar', 'app.asar.unpacked');
const PROG_IDS = { word: 'Word.Application', excel: 'Excel.Application', powerpoint: 'PowerPoint.Application' };

// Word asks "Word will now convert your PDF…" before opening a PDF — invisibly, when automated —
// unless this option (its "Don't show this message again" box) is set.
export const WORD_PDF_KEY = 'HKCU\\Software\\Microsoft\\Office\\16.0\\Word\\Options';
export const WORD_PDF_VALUE = 'DisableConvertPdfWarning';

let detected;
/** { word, excel, powerpoint, wordPdf } booleans, from the COM registrations in HKCR. */
export async function detectOffice({ refresh = false } = {}) {
  if (detected && !refresh) return detected;
  const has = async (progId) => {
    try { await run('reg.exe', ['query', `HKCR\\${progId}\\CLSID`], { timeoutMs: 10_000 }); return true; } catch { return false; }
  };
  if (process.platform !== 'win32') return (detected = { word: false, excel: false, powerpoint: false, wordPdf: false });
  const [word, excel, powerpoint] = await Promise.all(Object.values(PROG_IDS).map(has));
  let wordPdf = false;
  try {
    const { stdout } = await run('reg.exe', ['query', WORD_PDF_KEY, '/v', WORD_PDF_VALUE], { timeoutMs: 10_000 });
    wordPdf = /0x1\b/.test(stdout);
  } catch { /* not set */ }
  return (detected = { word, excel, powerpoint, wordPdf });
}

/** Tick Word's "don't warn before converting PDFs" box (only on the user's request). */
export async function enableWordPdf(on) {
  await run('reg.exe', ['add', WORD_PDF_KEY, '/v', WORD_PDF_VALUE, '/t', 'REG_DWORD', '/d', on ? '1' : '0', '/f'], { timeoutMs: 10_000 });
  return detectOffice({ refresh: true });
}

// Office automation isn't safe to run concurrently against one app instance.
const queues = {};
function serial(app, fn) {
  const prev = queues[app] || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues[app] = next;
  return next;
}

export function office(app, input, output, to, from, { signal, timeoutMs } = {}) {
  return serial(app, async () => {
    let pid = null;
    try {
      return await run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
        '-App', app, '-In', path.resolve(input), '-Out', path.resolve(output), '-To', to, '-From', from || '',
      ], {
        signal,
        timeoutMs: timeoutMs ?? (to === 'mp4' ? 30 * 60_000 : 90_000),
        onStdout: (s) => { pid ??= Number(/PID:(\d+)/.exec(s)?.[1]) || null; },
      });
    } catch (e) {
      throw Object.assign(new Error(`${app[0].toUpperCase()}${app.slice(1)}: ${e.message}`), { office: true });
    } finally {
      // Office can hang on Quit (e.g. waiting for an offline printer). The instance is ours
      // and hidden, so end it rather than leave it running.
      if (pid) setTimeout(() => { try { process.kill(pid); } catch { /* exited normally */ } }, 4000);
    }
  });
}

export function officeEdges(avail) {
  const edges = [];
  if (avail.word) {
    edges.push({
      id: 'word',
      from: ['docx', 'doc', 'rtf', 'odt', 'txt', 'html', ...(avail.wordPdf ? ['pdf'] : [])],
      to: ['pdf', 'docx', 'doc', 'rtf', 'odt', 'txt', 'html', 'xps'],
      // PDF reflow and HTML import are good but not perfect; Word -> Word formats is lossless.
      // Plain text is a lossy hop, so routes prefer going through HTML.
      cost: (from, to) => (from === 'pdf' ? 1.6 : from === 'html' ? (to === 'pdf' ? 1.5 : 1.1) : from === 'txt' ? 1.5 : 1),
      async run({ input, from, to, output, ctx }) {
        await office('word', input, output, to, from, ctx);
        return output;
      },
    });
  }
  if (avail.excel) {
    edges.push({
      id: 'excel',
      from: ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'],
      to: ['xlsx', 'xls', 'ods', 'pdf', 'html', 'xps'],
      cost: 1,
      async run({ input, from, to, output, ctx }) {
        await office('excel', input, output, to, from, ctx);
        return output;
      },
    });
  }
  if (avail.powerpoint) {
    edges.push({
      id: 'powerpoint',
      from: ['pptx', 'ppt', 'odp'],
      to: ['pdf', 'pptx', 'ppt', 'odp', 'xps', 'mp4'],
      cost: (from, to) => (to === 'mp4' ? 2 : 1),
      async run({ input, from, to, output, ctx }) {
        await office('powerpoint', input, output, to, from, ctx);
        return output;
      },
    });
    edges.push({
      id: 'powerpoint-slides',
      from: ['pptx', 'ppt', 'odp'],
      to: ['png', 'jpg'],
      cost: 1,
      terminal: true,
      async run({ input, from, to, output, ctx }) {
        const tmp = path.join(ctx.tmpDir, `slides-${Date.now()}`);
        await office('powerpoint', input, tmp, to, from, ctx);
        const files = (await fs.readdir(tmp)).filter((f) => f.endsWith(`.${to}`)).sort();
        return ctx.placePages(files.map((f) => path.join(tmp, f)), output);
      },
    });
  }
  return edges;
}
