// One wheel "session" for a set of files: builds the rings and runs the
// chosen action through the main process. Used by the pop-up and home windows.
import { Wheel } from '../../shared/wheel/wheel.js';
import { TOOLS } from '../../shared/tools.js';
import { labelOf } from '../../shared/formats.js';
import { DESCRIPTIONS } from '../../shared/descriptions.js';

const easy = window.easy;
let current = null;
easy.onProgress((p) => current?.setProgress(p.fraction, p.label));

export const cleanError = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function showWheel(layer, { files, targets = [], tools = [], error, unsupported }, { x, y, onClose, autoCloseMs } = {}) {
  current?.el.remove();
  const paths = files.map((f) => f.path);
  const src = files[0]?.fmt;
  const rings = [];
  if (targets.length) {
    rings.push({ id: 'convert', label: 'Convert', icon: 'convert',
      items: targets.map((t) => ({ id: t, label: labelOf(t), hint: DESCRIPTIONS[t] })) });
  }
  if (tools.length) {
    rings.push({ id: 'tools', label: 'Tools', icon: 'tools',
      items: tools.map((t) => ({ id: t, label: TOOLS[t].label, icon: TOOLS[t].icon })) });
  }

  const wheel = new Wheel(layer, {
    title: files.length === 1 ? files[0].name : `${files.length} files`,
    rings,
    autoCloseMs,
    onClose: () => { if (current === wheel) current = null; onClose?.(); },
    async onSelect(item, ring, w) {
      easy.busy(true);
      try {
        let out;
        if (ring.id === 'convert') {
          w.setBusy(`${src && files.length === 1 ? labelOf(src) : 'Files'} → ${item.label}`, null, 'Converting');
          out = await easy.convert(paths, item.id);
        } else {
          w.setBusy(TOOLS[item.id].label, null, 'Working');
          out = await easy.tool(paths, item.id);
          if (!out) return false; // editor closed without saving
        }
        if (!out?.length) return { title: 'Nothing to do', detail: 'Already in that format' };
        const first = out[0];
        return {
          title: 'Saved',
          detail: out.length > 1 ? `${out.length} files` : first.split(/[/\\]/).pop(),
          actions: [
            { label: 'Open', icon: 'more', run: () => { easy.openPath(first); w.close(); } },
            { label: 'Folder', icon: 'folder', run: () => { easy.reveal(first); w.close(); } },
          ],
        };
      } catch (e) {
        throw new Error(cleanError(e));
      } finally {
        easy.busy(false);
      }
    },
  }).open(x, y);
  current = wheel;
  if (error || unsupported?.length || !rings.length) {
    wheel.setError(error || `Can't convert ${unsupported?.join(', ') || 'this file'}`);
  }
  return wheel;
}
