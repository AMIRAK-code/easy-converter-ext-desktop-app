// Dev harness: runs the extension's browser engine over the test fixtures.
// Served from build/webtest; driven by scripts/capture (window.runMatrix()).
import { createWebEngine } from '../web/engine.js';
import { formatOf } from '../shared/formats.js';

const SIG = {
  pdf: (b) => b[0] === 0x25 && b[1] === 0x50, zip: (b) => b[0] === 0x50 && b[1] === 0x4b, ole: (b) => b[0] === 0xd0,
  png: (b) => b[0] === 0x89, jpg: (b) => b[0] === 0xff && b[1] === 0xd8, webp: (b) => b[8] === 0x57 && b[9] === 0x45,
  bmp: (b) => b[0] === 0x42 && b[1] === 0x4d, ico: (b) => b[0] === 0 && b[2] === 1, avif: (b) => b[8] === 0x61,
  text: (b) => b.length > 0,
};
const KIND = { pdf: 'pdf', docx: 'zip', xlsx: 'zip', pptx: 'zip', ods: 'zip', xls: 'ole', png: 'png', jpg: 'jpg', webp: 'webp',
  bmp: 'bmp', ico: 'ico', avif: 'avif', html: 'text', md: 'text', txt: 'text', csv: 'text', tsv: 'text', json: 'text' };

window.runMatrix = async (names) => {
  const engine = createWebEngine();
  const lines = [];
  let pass = 0, fail = 0;
  for (const name of names) {
    const blob = await (await fetch(`fixtures/${name}`)).blob();
    const file = { blob, name };
    const { targets, tools } = engine.optionsFor([file]);
    for (const to of targets) {
      const t0 = performance.now();
      try {
        const [out] = await engine.convert(file, to);
        const bytes = new Uint8Array(await out.blob.arrayBuffer());
        if (!SIG[KIND[to]]?.(bytes)) throw new Error(`bad signature for ${to}`);
        pass++;
        lines.push(`ok   ${name} -> ${to} ${Math.round(performance.now() - t0)}ms ${bytes.length}B [${engine.explain(formatOf(name), to)}]`);
      } catch (e) {
        fail++;
        lines.push(`FAIL ${name} -> ${to}: ${e.message} [${engine.explain(formatOf(name), to)}]`);
      }
    }
    for (const tool of tools.filter((t) => !['crop', 'addbg', 'redact', 'annotate', 'edit'].includes(t))) {
      try {
        const out = await engine.tool(tool, [file]);
        pass++;
        lines.push(`ok   ${name} tool:${tool} -> ${out.map((o) => `${o.name} ${o.blob.size}B`).join(', ')}`);
      } catch (e) {
        fail++;
        lines.push(`FAIL ${name} tool:${tool}: ${e.message}`);
      }
    }
  }
  lines.push(`${pass} passed, ${fail} failed`);
  return lines.join('\n');
};
