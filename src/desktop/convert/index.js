// Desktop conversion engine: builds the any-to-any graph from available
// converters and executes routes through a temp folder.

import fs from 'node:fs/promises';
import path from 'node:path';
import { ConversionGraph, describeRoute } from '../../shared/graph.js';
import { formatOf, labelOf } from '../../shared/formats.js';
import { toolsFor } from '../../shared/tools.js';
import { detectOffice, officeEdges } from './office.js';
import { imageEdges } from './images.js';
import { pdfEdges } from './pdf.js';
import { docEdges } from './docs.js';
import { mediaEdges } from './media.js';
import { runTool, readMetadata } from './tools.js';
import { baseName, makeTempDir, removeDir, uniquePath } from './util.js';

/**
 * @param {object} [opts]
 * @param {(op:string, args:object)=>Promise<any>} [opts.host] services only the Electron
 *   main process can provide (HTML -> PDF printing). Optional: the CLI runs without it.
 * @param {boolean} [opts.useOffice=true]
 */
export async function createEngine({ host, useOffice = true } = {}) {
  const office = useOffice ? await detectOffice() : { word: false, excel: false, powerpoint: false };
  const graph = new ConversionGraph();
  for (const e of [...officeEdges(office), ...imageEdges(), ...pdfEdges(), ...docEdges({ host }), ...mediaEdges()]) {
    graph.add(e);
  }

  const canPdf = (fmt) => fmt === 'pdf' || !!graph.plan(fmt, 'pdf');

  /** Wheel contents for a selection of files. */
  function optionsFor(files) {
    const formats = files.map((f) => formatOf(f)).filter(Boolean);
    if (formats.length !== files.length) {
      return { formats, targets: [], tools: [], unsupported: files.filter((f) => !formatOf(f)).map((f) => path.basename(f)) };
    }
    const targets = graph.commonTargets(formats).map((t) => t.to);
    return { formats, targets, tools: toolsFor(formats, { canPdf }) };
  }

  /**
   * Convert one file. Returns created paths (a folder when a multi-page source
   * becomes one image per page).
   */
  async function convert(input, target, { outDir, progress = () => {}, signal } = {}) {
    const src = formatOf(input);
    if (src === target) return [];
    const route = graph.plan(src, target);
    if (!route) throw new Error(`Can't convert ${labelOf(src)} to ${labelOf(target)}`);
    const dir = outDir ?? path.dirname(input);
    await fs.mkdir(dir, { recursive: true });
    const tmpDir = await makeTempDir();
    const base = baseName(input);
    const ctx = {
      tmpDir, signal,
      progress: (fraction, label) => progress({ fraction, label }),
      placePages: (pages, output) => placePages(pages, output, target),
    };
    try {
      let current = input, fmt = src, steps = route.steps, i = 0, n = 0;
      const exclude = new Set();
      while (i < steps.length) {
        const { edge, from, to } = steps[i];
        const last = i === steps.length - 1;
        const output = last ? uniquePath(dir, base, to) : path.join(tmpDir, `step${++n}-${safe(base)}.${to}`);
        progress({ fraction: i / steps.length, label: `${labelOf(from)} → ${labelOf(to)}` });
        try {
          current = await edge.run({ input: current, from, to, output, ctx });
          fmt = to;
          i++;
        } catch (e) {
          // If Office stalls or fails, finish the job with the built-in converters instead.
          if (!e.office || signal?.aborted) throw e;
          exclude.add(edge.id);
          const retry = graph.plan(fmt, target, { exclude });
          if (!retry) throw e;
          progress({ fraction: i / steps.length, label: 'Office unavailable — using built-in converter' });
          steps = retry.steps;
          i = 0;
        }
      }
      progress({ fraction: 1, label: 'Done' });
      return Array.isArray(current) ? current : [current];
    } finally {
      await removeDir(tmpDir);
    }
  }

  async function tool(toolId, files, { outDir, progress = () => {}, signal } = {}) {
    const ctx = { signal, progress: (fraction, label) => progress({ fraction, label }) };
    let tmp;
    const toPdf = async (file) => {
      tmp ??= await makeTempDir();
      const [pdf] = await convert(file, 'pdf', { outDir: tmp, signal });
      return pdf;
    };
    try {
      return await runTool(toolId, files, { outDir, ctx, toPdf });
    } finally {
      if (tmp) await removeDir(tmp);
    }
  }

  return { graph, office, optionsFor, convert, tool, readMetadata, explain: (src, dst) => describeRoute(graph.plan(src, dst)) };
}

const safe = (s) => s.replace(/[^\w.-]+/g, '_').slice(0, 40);

/** One page -> a single file; many pages -> "Name (PNG)/Name 01.png …". Returns created paths. */
async function placePages(pages, output, target) {
  const dir = path.dirname(output);
  const base = path.basename(output, path.extname(output));
  if (pages.length === 1) {
    await moveFile(pages[0], output);
    return output;
  }
  const folder = uniquePath(dir, `${base} (${labelOf(target)})`, '');
  await fs.mkdir(folder, { recursive: true });
  const pad = Math.max(2, String(pages.length).length);
  for (let i = 0; i < pages.length; i++) {
    await moveFile(pages[i], path.join(folder, `${base} ${String(i + 1).padStart(pad, '0')}.${target}`));
  }
  return folder;
}

async function moveFile(from, to) {
  try {
    await fs.rename(from, to);
  } catch {
    await fs.copyFile(from, to); // across drives
    await fs.rm(from, { force: true });
  }
}
