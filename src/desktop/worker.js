// Utility process that runs conversions, so heavy work never blocks the UI.
// Talks to main over parentPort: requests carry an `id`, replies echo it.

import { createEngine } from './convert/index.js';

// pdf.js only treats Electron's *main* process as Node ("browser" type) and would
// look for a DOM here. This utility process is plain Node, so say so.
try { Object.defineProperty(process, 'type', { value: 'browser', configurable: true }); } catch { /* read-only */ }

const port = process.parentPort;
const jobs = new Map(); // id -> AbortController
const hostCalls = new Map();
let hostSeq = 0;

function host(op, args) {
  const hid = ++hostSeq;
  port.postMessage({ type: 'host', hid, op, args });
  return new Promise((resolve, reject) => hostCalls.set(hid, { resolve, reject }));
}

let settings = { useOffice: true };
let enginePromise = createEngine({ host, useOffice: settings.useOffice });

port.on('message', async ({ data: msg }) => {
  if (msg.type === 'hostResult') {
    const call = hostCalls.get(msg.hid);
    hostCalls.delete(msg.hid);
    if (msg.error) call?.reject(new Error(msg.error)); else call?.resolve(msg.value);
    return;
  }
  if (msg.type === 'settings') {
    settings = { ...settings, ...msg.settings };
    enginePromise = createEngine({ host, useOffice: settings.useOffice });
    return;
  }
  if (msg.type === 'cancel') {
    jobs.get(msg.id)?.abort();
    return;
  }

  const { id } = msg;
  const controller = new AbortController();
  jobs.set(id, controller);
  const progress = ({ fraction, label }) => port.postMessage({ id, type: 'progress', fraction, label });
  try {
    const engine = await enginePromise;
    let value;
    switch (msg.type) {
      case 'options': value = engine.optionsFor(msg.files); break;
      case 'convert': {
        value = [];
        for (let i = 0; i < msg.files.length; i++) {
          const each = (p) => progress({ fraction: (i + p.fraction) / msg.files.length, label: msg.files.length > 1 ? `${i + 1}/${msg.files.length} · ${p.label}` : p.label });
          value.push(...await engine.convert(msg.files[i], msg.target, { outDir: msg.outDir, progress: each, signal: controller.signal }));
        }
        break;
      }
      case 'tool': value = await engine.tool(msg.tool, msg.files, { outDir: msg.outDir, progress, signal: controller.signal }); break;
      case 'metadata': value = await engine.readMetadata(msg.file); break;
      case 'office': value = engine.office; break;
      case 'toPng': value = await toEditable(msg.file); break;
      default: throw new Error(`Unknown request ${msg.type}`);
    }
    port.postMessage({ id, type: 'result', value });
  } catch (e) {
    port.postMessage({ id, type: 'error', message: e?.message || String(e) });
  } finally {
    jobs.delete(id);
  }
});

/** Formats the editor's <canvas> can't decode become PNG bytes first. */
async function toEditable(file) {
  const { openImage } = await import('./convert/images.js');
  const { formatOf } = await import('../shared/formats.js');
  const img = await openImage(file, formatOf(file));
  const buf = await img.png().toBuffer();
  return new Uint8Array(buf);
}
