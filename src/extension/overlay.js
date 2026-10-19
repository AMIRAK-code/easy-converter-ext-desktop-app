// The in-page wheel (an extension page in a full-viewport iframe).
//   #mode=drag  Shift+drag in progress: wheel follows the drop
//   #mode=url   right-clicked image or link: fetch it, then show the wheel
//   #mode=file  right-clicked blob:/data: image: the page hands us the Blob

import { showWebWheel, getEngine, optionsForTypes } from '../web/session.js';
import { formatOf } from '../shared/formats.js';

const p = new URLSearchParams(location.hash.slice(1));
const nonce = p.get('n'), key = p.get('k'), mode = p.get('mode');
const x = Number(p.get('x')) || innerWidth / 2, y = Number(p.get('y')) || innerHeight / 2;
const layer = document.getElementById('layer');
const close = () => parent.postMessage({ type: 'close', nonce }, '*');
let wheel = null;

const same = (a = [], b = []) => a.length === b.length && a.every((v, i) => v === b[i]);

function show(files, options, at = { x, y }) {
  wheel?.el.remove();
  layer.classList.add('dim');
  wheel = showWebWheel(layer, files, options, { ...at, onClose: close });
}

if (mode === 'drag') {
  const types = (p.get('types') || '').split(',');
  const known = types.every((t) => formatOf(t));
  const opts = known && types.length ? optionsForTypes(types) : { targets: [], tools: [] };
  layer.classList.add('dim');
  wheel = showWebWheel(layer, null, opts, {
    x, y, dragMode: true, onClose: close,
    title: types.length > 1 ? `${types.length} files` : 'Drop on an option',
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (wheel?.opts.dragMode) wheel.hoverAt(e.clientX, e.clientY);
  });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) close(); });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].map((f) => ({ blob: f, name: f.name }));
    if (!files.length) return close();
    const real = getEngine().optionsFor(files);
    const hit = wheel.hitTest(e.clientX, e.clientY);
    // Dropped on an option we could already show -> run it. Otherwise reopen with the real options.
    if (typeof hit === 'number' && hit >= 0 && same(real.targets, opts.targets) && same(real.tools, opts.tools)) {
      wheel.setFiles(files);
      wheel.opts.dragMode = false;
      wheel.activate(hit);
    } else {
      show(files, real, { x: e.clientX, y: e.clientY });
    }
  });
} else if (mode === 'url') {
  (async () => {
    const src = p.get('src');
    try {
      const res = await fetch(src, { credentials: 'include' });
      if (!res.ok) throw new Error(`Couldn't download the file (${res.status})`);
      const blob = await res.blob();
      const name = nameWithType(fileNameFrom(res) || p.get('name') || 'download', blob.type);
      const files = [{ blob, name }];
      show(files, getEngine().optionsFor(files));
    } catch (e) {
      show([{ blob: new Blob(), name: p.get('name') || 'file' }], { targets: [], tools: [] });
      wheel.setError(e.message || 'Download failed');
    }
  })();
} else if (mode === 'file') {
  addEventListener('message', (e) => {
    if (e.data?.type !== 'file' || e.data.key !== key || !(e.data.blob instanceof Blob)) return;
    const files = [{ blob: e.data.blob, name: e.data.name || 'image' }];
    show(files, getEngine().optionsFor(files));
  });
  parent.postMessage({ type: 'ready', nonce }, '*');
}

addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

function fileNameFrom(res) {
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
  return m ? decodeURIComponent(m[1]) : '';
}

function nameWithType(name, type) {
  if (formatOf(name)) return name;
  const ext = formatOf(type);
  return ext ? `${name.replace(/\.[^.]*$/, '')}.${ext}` : name;
}
