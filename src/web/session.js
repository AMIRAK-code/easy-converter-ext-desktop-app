// A wheel session in the browser: rings for some files, conversions through the
// web engine, results saved with chrome.downloads, editor tools in a new tab.

import { Wheel } from '../shared/wheel/wheel.js';
import { TOOLS } from '../shared/tools.js';
import { labelOf, formatOf } from '../shared/formats.js';
import { DESCRIPTIONS } from '../shared/descriptions.js';
import { createWebEngine } from './engine.js';
import { putFile } from './store.js';

let engine;
export const getEngine = () => (engine ??= createWebEngine());

export function ringsFor({ targets = [], tools = [] }) {
  const rings = [];
  if (targets.length) {
    rings.push({ id: 'convert', label: 'Convert', icon: 'convert',
      items: targets.map((t) => ({ id: t, label: labelOf(t), hint: DESCRIPTIONS[t] })) });
  }
  if (tools.length) {
    rings.push({ id: 'tools', label: 'Tools', icon: 'tools',
      items: tools.map((t) => ({ id: t, label: TOOLS[t].label, icon: TOOLS[t].icon })) });
  }
  return rings;
}

/** Options from MIME types alone (during a drag, before files are readable). */
export function optionsForTypes(types) {
  const names = types.map((t, i) => `file${i}.${formatOf(t) ?? 'unknown'}`);
  return getEngine().optionsFor(names.map((name) => ({ name, blob: new Blob() })));
}

const safeName = (n) => n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').slice(0, 180) || 'file';

/** Save results with chrome.downloads and wait until they're written. */
export async function download(results) {
  const ids = [];
  const urls = [];
  for (const r of results) {
    const url = URL.createObjectURL(r.blob);
    urls.push(url);
    const filename = (r.folder ? `${safeName(r.folder)}/` : '') + safeName(r.name);
    ids.push(await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false }));
  }
  await waitForDownloads(ids);
  urls.forEach((u) => URL.revokeObjectURL(u));
  return ids;
}

function waitForDownloads(ids, timeoutMs = 60_000) {
  const pending = new Set(ids);
  return new Promise((resolve) => {
    const done = () => { chrome.downloads.onChanged.removeListener(onChanged); clearTimeout(timer); resolve(); };
    const onChanged = (d) => {
      if (pending.has(d.id) && (d.state?.current === 'complete' || d.state?.current === 'interrupted')) {
        pending.delete(d.id);
        if (!pending.size) done();
      }
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({}).then((all) => {
      for (const d of all) if (pending.has(d.id) && d.state !== 'in_progress') pending.delete(d.id);
      if (!pending.size) done();
    });
  });
}

/**
 * @param {HTMLElement} layer
 * @param {{ blob: Blob, name: string }[] | null} files  null while dragging (filled in on drop)
 * @param {object} options from engine.optionsFor
 */
export function showWebWheel(layer, files, options, { x, y, dragMode = false, onClose, title } = {}) {
  const state = { files };
  const rings = ringsFor(options);
  const wheel = new Wheel(layer, {
    title: title ?? (files?.length === 1 ? files[0].name : files ? `${files.length} files` : 'Drop here'),
    rings,
    dragMode,
    onClose,
    async onSelect(item, ring, w) {
      const list = state.files;
      if (!list?.length) throw new Error('No file');
      const eng = getEngine();
      const progress = ({ fraction, label }) => w.setProgress(fraction, label);
      let results;
      if (ring.id === 'convert') {
        const src = formatOf(list[0].name);
        w.setBusy(`${list.length === 1 && src ? labelOf(src) : 'Files'} → ${item.label}`, null, 'Converting');
        results = [];
        for (let i = 0; i < list.length; i++) results.push(...await eng.convert(list[i], item.id, { progress }));
      } else if (TOOLS[item.id].editor) {
        const id = await putFile(list[0]);
        await chrome.tabs.create({ url: chrome.runtime.getURL(`editor.html#${item.id}:${id}`) });
        return { title: 'Opened', detail: `${TOOLS[item.id].label} in a new tab` };
      } else {
        w.setBusy(TOOLS[item.id].label, null, 'Working');
        results = await eng.tool(item.id, list, { progress });
      }
      if (!results.length) return { title: 'Nothing to do', detail: 'Already in that format' };
      w.setProgress(1, 'Saving');
      await download(results);
      return {
        title: 'Downloaded',
        detail: results.length > 1 ? `${results.length} files` : results[0].name,
        actions: [{ label: 'Show', icon: 'folder', run: () => { chrome.downloads.showDefaultFolder(); w.close(); } }],
      };
    },
  }).open(x, y);
  if (options.unsupported?.length || (!rings.length && files)) {
    wheel.setError(options.note || `Can't convert ${options.unsupported?.join(', ') || 'this file'} in the browser`);
  }
  return Object.assign(wheel, {
    /** Drag mode: supply the dropped files, then activate the option under the drop point. */
    setFiles(f) { state.files = f; },
  });
}
