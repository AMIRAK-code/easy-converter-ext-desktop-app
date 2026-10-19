// 25-second promo, rendered deterministically: the capture tool calls seek(t)
// for every frame. Uses the real Wheel and ImageEditor components.

import { Wheel } from '../shared/wheel/wheel.js';
import { ImageEditor } from '../shared/editor/editor.js';
import { TOOLS } from '../shared/tools.js';
import { labelOf } from '../shared/formats.js';

const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const pop = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p) * Math.cos(p * Math.PI * 1.7)); // springy 0→1
const lerp = (a, b, p) => a + (b - a) * p;
const span = (t, a, b) => clamp01((t - a) / (b - a));

const WHEEL = 520;
const layer = $('wheelLayer');

// ---------- scenes ----------

const SCENES = [
  ['s-title', 0, 2.75], ['s-desk', 2.55, 19.1], ['s-editor', 15.45, 18.05], ['s-chrome', 18.9, 22.75], ['s-end', 22.55, 25.5],
];
function sceneOpacity(t) {
  for (const [id, a, b] of SCENES) {
    const fade = 0.3;
    $(id).style.opacity = String(Math.min(span(t, a, a + fade), 1 - span(t, b - fade, b)));
  }
}

// ---------- desktop files ----------

const FILES = {
  report: { name: 'Report.docx', ext: 'DOCX', color: '#2b6cdf', x: 100, y: 150 },
  budget: { name: 'Budget.xlsx', ext: 'XLSX', color: '#1f8f4e', x: 290, y: 150 },
  photo: { name: 'Photo.png', ext: 'PNG', color: '#a650c8', x: 480, y: 150, thumb: true },
  slides: { name: 'Slides.pptx', ext: 'PPTX', color: '#d24726', x: 670, y: 150 },
  contract: { name: 'Contract.pdf', ext: 'PDF', color: '#d93025', x: 860, y: 150 },
  reportPdf: { name: 'Report.pdf', ext: 'PDF', color: '#d93025', x: 100, y: 610, hidden: true },
  budgetDocx: { name: 'Budget.docx', ext: 'DOCX', color: '#2b6cdf', x: 290, y: 610, hidden: true },
  photoBg: { name: 'Photo with BG.png', ext: 'PNG', color: '#a650c8', x: 480, y: 610, thumb: true, hidden: true },
};
for (const [id, f] of Object.entries(FILES)) {
  const el = document.createElement('div');
  el.className = 'file';
  el.id = `f-${id}`;
  el.style.left = `${f.x}px`;
  el.style.top = `${f.y}px`;
  el.innerHTML = `<div class="page">${f.thumb ? '<div class="thumb"></div>' : '<div class="lines"><i></i><i></i><i style="width:70%"></i><i></i><i style="width:55%"></i></div>'}
    <div class="badge" style="background:${f.color}">${f.ext}</div></div><div class="name">${f.name}</div>`;
  if (f.hidden) el.style.opacity = '0';
  $('files').append(el);
}
const fileCenter = (id) => ({ x: FILES[id].x + 75, y: FILES[id].y + 58 });

// ---------- context menu ----------

const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
$('menu').innerHTML = `
  <div>${icon('M14 3h7v7M10 14L21 3M21 14v7H3V3h7')}Open</div>
  <div>${icon('M4 4h16v16H4zM9 9h6v6H9z')}Open with</div>
  <div>${icon('M4 12v8h16v-8M12 3v13M7 8l5-5 5 5')}Share</div><hr>
  <div class="ec"><img src="icon-512.png" alt="">Easy Convert</div><hr>
  <div>${icon('M21 8v13H3V8M1 3h22v5H1zM10 12h4')}Compress to ZIP file</div>
  <div>${icon('M8 4h10v14H8zM4 8v12h10')}Copy as path</div>
  <div>${icon('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01')}Properties</div>`;
const menuEc = () => $('menu').querySelector('.ec');

// ---------- cursor ----------

let cursor = { x: 900, y: 900 };
const path = []; // [t, x, y] keyframes; x/y may be functions, resolved once when first needed
const at = (t, x, y) => path.push({ t, x, y });
function point(k) {
  if (k.cache) return k.cache;
  const x = typeof k.x === 'function' ? k.x() : k.x, y = typeof k.y === 'function' ? k.y() : k.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null; // target not on screen yet
  return (k.cache = { x, y });
}
function cursorAt(t) {
  let prev = path[0];
  for (const k of path) {
    if (k.t > t) {
      const a = point(prev), b = point(k) ?? a;
      const p = ease(span(t, prev.t, k.t));
      return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) };
    }
    prev = k;
  }
  return point(prev);
}
const clicks = [];
const click = (t) => clicks.push(t);

// ---------- wheels ----------

let wheel = null;
let wheelOpenedAt = 0;
const rings = (targets, tools) => [
  { id: 'convert', label: 'Convert', icon: 'convert', items: targets.map((x) => ({ id: x, label: labelOf(x) })) },
  ...(tools ? [{ id: 'tools', label: 'Tools', icon: 'tools', items: tools.map((x) => ({ id: x, label: TOOLS[x].label, icon: TOOLS[x].icon })) }] : []),
];
function openWheel(t, title, r, opts = {}) {
  wheel?.el.remove();
  wheel = new Wheel(layer, { title, rings: r, size: WHEEL, autoCloseMs: 0, onSelect: () => new Promise(() => {}), ...opts }).open(cursor.x, cursor.y);
  wheel.el.classList.add('ecw-open');
  wheelOpenedAt = t;
}
// Layout positions (offsetLeft ignores the opening scale animation).
const wheelCenter = () => (wheel ? { x: wheel.el.offsetLeft + WHEEL / 2, y: wheel.el.offsetTop + WHEEL / 2 } : {});
function petal(index) {
  // Point inside petal `index` of the open wheel (for cursor targets).
  return () => {
    if (!wheel) return {};
    const c = wheelCenter();
    const n = wheel.items.length, a = (index * Math.PI * 2) / n, rad = (wheel.R + wheel.r) / 2;
    return { x: c.x + Math.sin(a) * rad, y: c.y - Math.cos(a) * rad };
  };
}
const px = (fn) => () => fn().x;
const py = (fn) => () => fn().y;

// ---------- editor ----------

let editor = null;
function screenshotImage() {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 760;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1200, 760);
  g.fillStyle = '#f4f2f8'; g.fillRect(0, 0, 1200, 90);
  g.fillStyle = '#1d1b26'; g.font = '700 40px Segoe UI'; g.fillText('Revenue — Q3', 50, 60);
  g.fillStyle = '#8b8798'; g.font = '26px Segoe UI'; g.fillText('+24% vs last quarter', 860, 58);
  const bars = [210, 300, 260, 380, 340, 470, 430, 560];
  bars.forEach((h, i) => {
    const grad = g.createLinearGradient(0, 700 - h, 0, 700);
    grad.addColorStop(0, '#ff8a3c'); grad.addColorStop(1, '#ef3b5e');
    g.fillStyle = grad;
    g.beginPath(); g.roundRect(90 + i * 135, 700 - h, 80, h, 14); g.fill();
  });
  g.strokeStyle = '#e6e3ec'; g.lineWidth = 2; g.beginPath(); g.moveTo(60, 702); g.lineTo(1140, 702); g.stroke();
  return c;
}
function openEditor() {
  editor = new ImageEditor($('editorWin'), {
    image: screenshotImage(), name: 'Photo.png', fmt: 'png', mode: 'addbg', onSave: async () => {}, onClose: () => {},
  });
}
const centerOf = (el) => { if (!el) return {}; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const rectOf = (sel) => () => centerOf(document.querySelector(sel));
const swatch = (i) => () => centerOf(document.querySelectorAll('.ece-bgs .ece-sw')[i]);
const slider = (row, p) => () => {
  const el = document.querySelectorAll('.ece-range')[row];
  if (!el) return {};
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width * p, y: r.top + r.height / 2 };
};

// ---------- timeline ----------

const events = []; // [t, fn]
const on = (t, fn) => events.push([t, fn]);
let progressWindow = null; // [t0, t1] drives wheel progress

function convertFlow(file, targets, tools, menuStart, pick, label, saved, newFile) {
  const c = fileCenter(file);
  at(menuStart - 0.6, c.x, c.y);
  at(menuStart, c.x, c.y);
  on(menuStart - 0.15, () => document.querySelectorAll('.file').forEach((f) => f.classList.toggle('sel', f.id === `f-${file}`)));
  click(menuStart);
  on(menuStart + 0.02, () => {
    const m = $('menu');
    m.style.display = 'block';
    m.style.left = `${cursor.x + 6}px`;
    m.style.top = `${cursor.y + 6}px`;
    menuEc().classList.remove('hot');
  });
  const ecPos = () => { const r = menuEc().getBoundingClientRect(); return r.width ? { x: r.left + 110, y: r.top + r.height / 2 } : {}; };
  at(menuStart + 0.4, px(ecPos), py(ecPos));
  at(menuStart + 0.75, px(ecPos), py(ecPos));
  on(menuStart + 0.38, () => menuEc().classList.add('hot'));
  click(menuStart + 0.65);
  on(menuStart + 0.66, () => { $('menu').style.display = 'none'; openWheel(menuStart + 0.66, FILES[file].name, rings(targets, tools)); });
  return { c, wheelAt: menuStart + 0.66, finish(pickAt, petalIndex, doneLabel) {
    at(pickAt - 0.1, px(petal(petalIndex)), py(petal(petalIndex)));
    at(pickAt + 0.2, px(petal(petalIndex)), py(petal(petalIndex)));
    click(pickAt);
    on(pickAt, () => { wheel.el.classList.add('ecw-picked'); wheel.setBusy(label, 0, 'Converting'); progressWindow = [pickAt, pickAt + 1.05]; });
    on(pickAt + 1.1, () => { progressWindow = null; wheel.setDone({ title: 'Saved', detail: doneLabel }); });
    on(pickAt + 1.95, () => { wheel.el.style.transition = 'none'; });
    on(pickAt + 2.2, () => { wheel?.el.remove(); wheel = null; });
    on(pickAt + 2.3, () => { $(`f-${newFile}`).dataset.popAt = pickAt + 2.3; });
  } };
}

// Scene B: Word -> PDF
at(0, 900, 900);
at(2.9, 760, 700);
const b = convertFlow('report', ['pdf', 'txt', 'jpg', 'png', 'html', 'md', 'odt', 'xlsx'], null, 3.55, 0, 'DOCX → PDF', 'Report.pdf', 'reportPdf');
b.finish(5.25, 0, 'Report.pdf');
on(2.6, () => { $('cap-desk').innerHTML = 'Right-click any file → <b>Easy Convert</b>'; });

// Scene C: Excel -> Word
on(8.4, () => { $('cap-desk').innerHTML = '<b>Excel → Word</b> · Word → PDF · PDF → Word…'; });
const c2 = convertFlow('budget', ['pdf', 'docx', 'csv', 'json', 'html', 'png', 'jpg', 'md'], null, 9.0, 1, 'XLSX → DOCX', 'Budget.docx', 'budgetDocx');
c2.finish(10.55, 1, 'Budget.docx');

// Scene D: tools ring -> Add BG editor
on(12.85, () => { $('cap-desk').innerHTML = 'One wheel for <b>formats</b> and <b>tools</b>'; });
convertFlow('photo', ['jpg', 'webp', 'pdf', 'ico', 'avif', 'tiff', 'docx', 'bmp'], ['crop', 'addbg', 'redact', 'annotate', 'edit', 'compress', 'metadata'], 13.35, 0, '', '', 'photoBg');
at(14.45, px(wheelCenter), py(wheelCenter));
at(14.6, px(wheelCenter), py(wheelCenter));
click(14.6);
on(14.6, () => wheel.switchRing());
at(15.05, px(petal(1)), py(petal(1)));
at(15.25, px(petal(1)), py(petal(1)));
click(15.25);
on(15.3, () => { wheel.el.remove(); wheel = null; openEditor(); $('cap-desk').style.opacity = '0'; });
on(18.1, () => { $('cap-desk').innerHTML = 'Saved next to the original: <b>Photo with BG.png</b>'; $('cap-desk').style.opacity = '1'; });
at(16.0, px(swatch(2)), py(swatch(2)));
at(16.15, px(swatch(2)), py(swatch(2)));
click(16.15);
on(16.15, () => document.querySelectorAll('.ece-bgs .ece-sw')[2].click());
at(16.55, px(slider(0, 0.12)), py(slider(0, 0.12)));
at(17.05, px(slider(0, 0.55)), py(slider(0, 0.55)));
let dragPadding = null;
on(16.55, () => { dragPadding = [16.55, 17.05]; });
on(17.06, () => { dragPadding = null; });
at(17.55, px(rectOf('.ece-primary')), py(rectOf('.ece-primary')));
at(17.7, px(rectOf('.ece-primary')), py(rectOf('.ece-primary')));
click(17.7);
on(18.15, () => { $('f-photoBg').dataset.popAt = 18.15; });
at(18.6, 640, 760);

// Scene E: Chrome Shift+drag
const ghost = document.createElement('div');
ghost.className = 'file ghost';
ghost.innerHTML = '<div class="page"><div class="lines"><i></i><i></i><i style="width:60%"></i></div><div class="badge" style="background:#d93025">PDF</div></div><div class="name">invoice.pdf</div>';
ghost.style.display = 'none';
$('stage').append(ghost);
const shift = document.createElement('div');
shift.className = 'shiftkey';
shift.textContent = '⇧ Shift';
shift.style.display = 'none';
$('stage').append(shift);

at(18.95, 40, 620);
at(19.75, 540, 560);
on(18.95, () => { ghost.style.display = 'flex'; });
on(19.45, () => { shift.style.display = 'block'; });
on(19.8, () => openWheel(19.8, 'Drop on an option', rings(['docx', 'jpg', 'png', 'txt', 'xlsx', 'pptx', 'html', 'md'], null), { dragMode: true }));
at(20.45, px(petal(0)), py(petal(0)));
at(20.7, px(petal(0)), py(petal(0)));
on(20.72, () => {
  ghost.style.display = 'none'; shift.style.display = 'none';
  wheel.el.classList.add('ecw-picked'); wheel.setBusy('PDF → DOCX', 0, 'Converting'); progressWindow = [20.72, 21.5];
});
on(21.55, () => { progressWindow = null; wheel.setDone({ title: 'Downloaded', detail: 'invoice.docx' }); });
on(21.75, () => { $('dl').style.display = 'flex'; });
on(22.35, () => { wheel?.el.remove(); wheel = null; });
at(22.5, 1100, 1100);

events.sort((p, q) => p[0] - q[0]);
path.sort((p, q) => p.t - q.t);

// ---------- frame ----------

let fired = 0;
function render(t) {
  sceneOpacity(t);

  // title animation
  const lp = pop(span(t, 0.1, 0.9));
  $('logo').style.transform = `scale(${lerp(0.4, 1, lp)}) rotate(${lerp(-40, 0, ease(span(t, 0.1, 0.9)))}deg)`;
  $('t1').style.opacity = String(span(t, 0.55, 1.0));
  $('t1').style.transform = `translateY(${lerp(30, 0, ease(span(t, 0.55, 1.0)))}px)`;
  $('t2').style.opacity = String(span(t, 0.95, 1.4));
  $('t2').style.transform = `translateY(${lerp(30, 0, ease(span(t, 0.95, 1.4)))}px)`;

  while (fired < events.length && events[fired][0] <= t) events[fired++][1]();

  cursor = cursorAt(t);
  const cur = $('cursor');
  cur.style.left = `${cursor.x - 5}px`;
  cur.style.top = `${cursor.y - 3}px`;
  cur.style.opacity = t < 2.6 || t > 22.45 ? '0' : '1';
  if (ghost.style.display !== 'none') { ghost.style.left = `${cursor.x - 40}px`; ghost.style.top = `${cursor.y - 30}px`; }
  if (shift.style.display !== 'none') { shift.style.left = `${cursor.x + 34}px`; shift.style.top = `${cursor.y + 40}px`; }

  // click pulse
  const last = clicks.filter((c) => c <= t).pop();
  const pp = last == null ? 1 : span(t, last, last + 0.35);
  const pulse = $('pulse');
  const size = lerp(10, 70, pp);
  Object.assign(pulse.style, { left: `${cursor.x - size / 2}px`, top: `${cursor.y - size / 2}px`, width: `${size}px`, height: `${size}px`, opacity: String(pp < 1 ? 1 - pp : 0) });

  // wheel: open spring, hover follows the cursor, progress
  if (wheel) {
    const op = span(t, wheelOpenedAt, wheelOpenedAt + 0.42);
    wheel.el.style.opacity = String(Math.min(1, op * 3));
    wheel.el.style.transform = op < 1 ? `scale(${lerp(0.55, 1, pop(op))}) rotate(${lerp(-24, 0, ease(op))}deg)` : 'none';
    if (wheel.state === 'idle') wheel.hoverAt(cursor.x, cursor.y);
    if (progressWindow) wheel.setProgress(ease(span(t, ...progressWindow)));
  }

  // new files pop in
  for (const el of document.querySelectorAll('.file[data-pop-at]')) {
    const p = span(t, +el.dataset.popAt, +el.dataset.popAt + 0.5);
    el.style.opacity = String(Math.min(1, p * 2));
    el.style.transform = `scale(${lerp(0.3, 1, pop(p))})`;
  }

  // editor padding drag
  if (dragPadding && editor) {
    const input = document.querySelectorAll('.ece-range')[0];
    const p = ease(span(t, ...dragPadding));
    input.value = String(Math.round(lerp(+input.min + (+input.max - +input.min) * 0.12, +input.min + (+input.max - +input.min) * 0.55, p)));
    input.dispatchEvent(new Event('input'));
  }
}

const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
window.seek = async (t) => { render(t); await frame(); };
window.ready = document.fonts.ready.then(() => new Promise((r) => {
  const img = new Image(); img.onload = r; img.onerror = r; img.src = 'icon-512.png';
}));
render(0);
