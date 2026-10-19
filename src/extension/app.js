// Full-page converter (toolbar button): drop zone + settings.
import { showWebWheel, getEngine } from '../web/session.js';
import { formatOf } from '../shared/formats.js';

const layer = document.getElementById('layer');
const drop = document.getElementById('drop');
const input = document.getElementById('file');

function openAt(files, x, y) {
  if (!files.length) return;
  layer.classList.add('active');
  showWebWheel(layer, files, getEngine().optionsFor(files), { x, y, onClose: () => layer.classList.remove('active') });
}

let depth = 0;
addEventListener('dragenter', (e) => {
  if (e.dataTransfer?.types.includes('Files')) { depth++; drop.classList.add('over'); }
});
addEventListener('dragleave', () => {
  if (--depth <= 0) { depth = 0; drop.classList.remove('over'); }
});
addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
addEventListener('drop', (e) => {
  e.preventDefault();
  depth = 0;
  drop.classList.remove('over');
  openAt([...e.dataTransfer.files].map((f) => ({ blob: f, name: f.name })), e.clientX, e.clientY);
});

const center = () => {
  const r = drop.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};
document.getElementById('pick').addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
drop.addEventListener('keydown', (e) => {
  if (e.target === drop && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); input.click(); }
});
input.addEventListener('change', () => {
  openAt([...input.files].map((f) => ({ blob: f, name: f.name })), ...center());
  input.value = '';
});

// Opened by the background worker for a link it couldn't handle in the page.
const src = new URLSearchParams(location.search).get('src');
if (src && /^https?:/.test(src)) {
  fetch(src, { credentials: 'include' }).then(async (res) => {
    const blob = await res.blob();
    let name = decodeURIComponent(new URL(src).pathname.split('/').pop() || 'download');
    if (!formatOf(name) && formatOf(blob.type)) name += `.${formatOf(blob.type)}`;
    openAt([{ blob, name }], ...center());
  }).catch(() => {});
}

const toggle = document.getElementById('alwaysOnDrag');
chrome.storage.sync.get({ alwaysOnDrag: false }).then((s) => { toggle.checked = s.alwaysOnDrag; });
toggle.addEventListener('change', () => chrome.storage.sync.set({ alwaysOnDrag: toggle.checked }));
