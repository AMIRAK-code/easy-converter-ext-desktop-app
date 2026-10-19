// Home window: drop zone (wheel opens where you drop) + settings.
import { showWheel, cleanError } from './session.js';

const easy = window.easy;
const layer = document.getElementById('layer');
const drop = document.getElementById('drop');

async function openAt(paths, x, y) {
  if (!paths.length) return;
  const data = await easy.options(paths);
  layer.classList.add('active');
  showWheel(layer, data, { x, y, onClose: () => layer.classList.remove('active') });
}

// Drops anywhere in the window.
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
  const paths = [...(e.dataTransfer?.files ?? [])].map((f) => easy.pathForFile(f)).filter(Boolean);
  openAt(paths, e.clientX, e.clientY);
});

async function pick() {
  const paths = await easy.pickFiles();
  const r = drop.getBoundingClientRect();
  openAt(paths, r.left + r.width / 2, r.top + r.height / 2);
}
document.getElementById('pick').addEventListener('click', (e) => { e.stopPropagation(); pick(); });
drop.addEventListener('keydown', (e) => {
  if (e.target === drop && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(); }
});

// ---------- settings ----------

async function refresh() {
  const s = await easy.getSettings();
  for (const input of document.querySelectorAll('[data-key]')) {
    const key = input.dataset.key;
    input.checked = key === 'wordPdf' ? !!s.office?.wordPdf : !!s[key];
  }
  const o = s.office || {};
  const found = [o.word && 'Word', o.excel && 'Excel', o.powerpoint && 'PowerPoint'].filter(Boolean);
  document.getElementById('office-status').textContent = found.length
    ? `Found ${found.join(', ')}. Best quality for Office files.`
    : 'Office not found — built-in converters are used.';
  document.querySelector('[data-key="useOffice"]').disabled = !found.length;
  document.getElementById('wordpdf-row').hidden = !o.word;
  const out = document.getElementById('outdir');
  out.textContent = s.outDir || 'Same folder as the original';
  out.title = s.outDir || '';
  document.getElementById('same').hidden = !s.outDir;
  document.getElementById('version').textContent = `Version ${s.version}`;
}

for (const input of document.querySelectorAll('[data-key]')) {
  input.addEventListener('change', async () => {
    input.disabled = true;
    try {
      await easy.setSettings({ [input.dataset.key]: input.checked });
    } catch (e) {
      alert(cleanError(e));
    }
    input.disabled = false;
    refresh();
  });
}
document.getElementById('choose').addEventListener('click', async () => { await easy.setSettings({ chooseOutDir: true }); refresh(); });
document.getElementById('same').addEventListener('click', async () => { await easy.setSettings({ outDir: null }); refresh(); });
refresh();
