// Dev-only page for previewing the wheel in a browser.
import { Wheel } from '../shared/wheel/wheel.js';
import { TOOLS } from '../shared/tools.js';
import { labelOf } from '../shared/formats.js';

const layer = document.getElementById('layer');
const params = new URLSearchParams(location.search);
const targets = (params.get('targets') || 'docx,jpg,png,txt,xlsx,pptx,html,webp,csv,md,tiff,json').split(',');
const tools = (params.get('tools') || 'compress,metadata,edit,annotate,addbg,crop,redact').split(',');
let wheel;

function open(x, y) {
  wheel = new Wheel(layer, {
    title: params.get('file') || 'Page 001.pdf',
    rings: [
      { id: 'convert', label: 'Convert', icon: 'convert', items: targets.map((t) => ({ id: t, label: labelOf(t) })) },
      { id: 'tools', label: 'Tools', icon: 'tools', items: tools.map((t) => ({ id: t, label: TOOLS[t].label, icon: TOOLS[t].icon })) },
    ],
    async onSelect(item, ring, w) {
      for (let i = 1; i <= 10; i++) { await new Promise((r) => setTimeout(r, 90)); w.setProgress(i / 10, `PDF → ${item.label}`); }
      if (item.id === 'tiff') throw new Error('Demo error: this one fails on purpose.');
      return { title: 'Saved', detail: `Page 001.${item.id}`, actions: [{ label: 'Open', icon: 'folder', run: () => w.close() }] };
    },
    onClose: () => { wheel = null; },
  }).open(x, y);
  if (params.has('ring')) wheel.switchRing(+params.get('ring'));
}

layer.addEventListener('click', (e) => { if (!wheel) open(e.clientX, e.clientY); });
// Wait for a real viewport (hidden preview panes start at 0×0).
(function first() { if (innerWidth > 0) open(innerWidth / 2, innerHeight / 2); else requestAnimationFrame(first); })();
