// Image editor shared by the desktop app and the extension:
// Crop · Edit · Annotate · Redact · Add BG · Info. Canvas-based, framework-free.

import { iconSvg } from '../wheel/icons.js';
import { EDITOR_CSS } from './editor-css.js';

const MODES = [
  { id: 'crop', label: 'Crop', icon: 'crop', title: 'Crop Image', suffix: 'Cropped' },
  { id: 'edit', label: 'Edit', icon: 'sliders', title: 'Edit Image', suffix: 'Edited' },
  { id: 'annotate', label: 'Annotate', icon: 'pen', title: 'Annotate', suffix: 'Annotated' },
  { id: 'redact', label: 'Redact', icon: 'eyeOff', title: 'Redact', suffix: 'Redacted' },
  { id: 'addbg', label: 'Add BG', icon: 'background', title: 'Add BG', suffix: 'with BG' },
];

const RATIOS = [['Free', 0], ['Original', -1], ['1:1', 1], ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9], ['9:16', 9 / 16], ['4:5', 4 / 5]];
const BG_RATIOS = [['Auto', 0], ['1:1', 1], ['16:9', 16 / 9], ['4:3', 4 / 3], ['4:5', 4 / 5], ['9:16', 9 / 16]];
const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#5e5ce6', '#1c1c1e', '#ffffff'];
const GRADIENTS = [
  ['#ff9a3c', '#ff3b2f', '#c9488a'], ['#f7b733', '#fc4a1a'], ['#a18cd1', '#fbc2eb'], ['#84fab0', '#8fd3f4'],
  ['#4facfe', '#00f2fe'], ['#43e97b', '#38f9d7'], ['#fa709a', '#fee140'], ['#30cfd0', '#330867'],
  ['#0f2027', '#2c5364'], ['#ee9ca7', '#ffdde1'],
];
const SOLIDS = ['#ffffff', '#f5f5f7', '#ffd60a', '#34c759', '#30b0c7', '#0a84ff', '#5e5ce6', '#1c1c1e', '#ff9f0a'];

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const h = (tag, attrs = {}, html = '') => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  if (html) el.innerHTML = html;
  return el;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function toCanvas(src, w = src.width, h = src.height) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

export class ImageEditor {
  /**
   * @param {HTMLElement} root
   * @param {object} o
   * @param {CanvasImageSource} [o.image]  decoded image (omit for info-only, e.g. a PDF's metadata)
   * @param {string} o.name   original file name
   * @param {string} o.fmt    original format (png, jpg, …)
   * @param {string} o.mode   crop | edit | annotate | redact | addbg | metadata
   * @param {object} [o.meta] metadata table for the Info view
   * @param {(blob: Blob, ext: string, suffix: string) => Promise<void>} o.onSave
   * @param {() => void} o.onClose
   * @param {() => Promise<void>} [o.onStripMetadata]
   * @param {boolean} [o.desktop] frameless window chrome (drag region, close button)
   */
  constructor(root, o) {
    this.root = root;
    this.o = o;
    this.base = o.image ? toCanvas(o.image) : null;
    this.history = [];
    this.future = [];
    this.usedModes = new Set();
    this.mode = o.mode === 'metadata' ? 'info' : o.mode || 'crop';
    this.state = this.#freshState();
    this.#mount();
    this.setMode(this.mode, { force: true });
    if (this.base) new ResizeObserver(() => this.render()).observe(this.stage);
  }

  #freshState() {
    const w = this.base?.width ?? 1, hh = this.base?.height ?? 1;
    const pad = Math.round(Math.max(w, hh) * 0.08);
    return {
      crop: { x: 0, y: 0, w, h: hh, ratio: 0 },
      adjust: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, blur: 0, gray: false, width: w, height: hh, lock: true },
      shapes: [], redo: [], tool: 'arrow', color: COLORS[0], stroke: Math.max(3, Math.round(Math.max(w, hh) / 260)),
      redactions: [], redactStyle: 'black',
      bg: { kind: 'gradient', index: 0, padding: pad, corners: Math.round(pad * 0.45), shadow: Math.round(pad * 0.35), ratio: 0, custom: '#ff7a3d' },
    };
  }

  // ---------- DOM ----------

  #mount() {
    if (!document.querySelector('style[data-ece]')) {
      const s = document.createElement('style');
      s.dataset.ece = '';
      s.textContent = EDITOR_CSS;
      document.head.appendChild(s);
    }
    this.el = h('div', { class: `ece${this.o.desktop ? ' ece-desktop' : ''}` });
    this.titleEl = h('div', { class: 'ece-title' });
    const bar = h('div', { class: 'ece-bar' });
    bar.append(
      h('button', { class: 'ece-close', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => this.close() }, iconSvg('x', 12, 2.6)),
      this.titleEl,
      h('div', { class: 'ece-bar-right' }),
    );
    this.tabsEl = h('div', { class: 'ece-tabs', role: 'tablist' });
    if (this.base) {
      for (const m of MODES) {
        this.tabsEl.append(h('button', { class: 'ece-tab', role: 'tab', 'data-mode': m.id, onclick: () => this.setMode(m.id) },
          `${iconSvg(m.icon, 15)}<span>${m.label}</span>`));
      }
      if (this.o.meta) this.tabsEl.append(h('button', { class: 'ece-tab', role: 'tab', 'data-mode': 'info', onclick: () => this.setMode('info') }, `${iconSvg('info', 15)}<span>Info</span>`));
    }
    this.stage = h('div', { class: 'ece-stage' });
    this.view = h('canvas', { class: 'ece-view' });
    this.stage.append(this.view);
    this.panel = h('div', { class: 'ece-panel' });
    this.footer = h('div', { class: 'ece-footer' });
    this.el.append(bar, this.tabsEl, this.stage, this.panel, this.footer);
    this.root.append(this.el);
    this.#bindPointer();
    this.onKey = (e) => this.#key(e);
    document.addEventListener('keydown', this.onKey);
  }

  setMode(mode, { force = false } = {}) {
    if (mode === this.mode && !force) return;
    if (!force) this.#commitPending();
    this.mode = mode;
    const def = MODES.find((m) => m.id === mode);
    this.titleEl.textContent = mode === 'info' ? 'Metadata' : def?.title ?? 'Edit';
    for (const t of this.tabsEl.children) t.classList.toggle('ece-on', t.dataset.mode === mode);
    this.el.dataset.mode = mode;
    if (mode === 'crop') this.state.crop = { x: 0, y: 0, w: this.base.width, h: this.base.height, ratio: this.state.crop.ratio };
    if (mode === 'edit') Object.assign(this.state.adjust, { width: this.base.width, height: this.base.height });
    this.#renderPanel();
    this.render();
  }

  // ---------- panels ----------

  #renderPanel() {
    const p = this.panel, s = this.state;
    p.innerHTML = '';
    this.footer.innerHTML = '';
    const row = (label, ...children) => {
      const r = h('div', { class: 'ece-row' });
      r.append(h('div', { class: 'ece-label' }, esc(label)), ...children);
      return r;
    };
    const chips = (items, current, onPick) => {
      const wrap = h('div', { class: 'ece-chips' });
      items.forEach(([label, value]) => wrap.append(h('button', {
        class: `ece-chip${value === current ? ' ece-on' : ''}`,
        onclick: () => { onPick(value); this.#renderPanel(); this.render(); },
      }, esc(label))));
      return wrap;
    };
    const slider = (label, value, min, max, unit, onInput, step = 1) => {
      const out = h('div', { class: 'ece-val' }, `${value}${unit}`);
      const input = h('input', { type: 'range', min, max, step, value, class: 'ece-range' });
      input.addEventListener('input', () => { out.textContent = `${input.value}${unit}`; onInput(+input.value); this.render(); });
      return row(label, input, out);
    };

    switch (this.mode) {
      case 'crop': {
        p.append(row('Ratio', chips(RATIOS, s.crop.ratio, (r) => this.#setCropRatio(r))));
        this.cropSize = h('div', { class: 'ece-hint' });
        p.append(row('Size', this.cropSize));
        break;
      }
      case 'edit': {
        const a = s.adjust;
        p.append(
          slider('Brightness', a.brightness, -100, 100, '', (v) => { a.brightness = v; }),
          slider('Contrast', a.contrast, -100, 100, '', (v) => { a.contrast = v; }),
          slider('Saturation', a.saturation, -100, 100, '', (v) => { a.saturation = v; }),
          slider('Warmth', a.warmth, -100, 100, '', (v) => { a.warmth = v; }),
          slider('Blur', a.blur, 0, 20, 'px', (v) => { a.blur = v; }, 0.5),
        );
        const tools = h('div', { class: 'ece-chips' });
        const btn = (icon, title, fn) => tools.append(h('button', { class: 'ece-chip ece-icon', title, 'aria-label': title, onclick: fn }, iconSvg(icon, 15)));
        btn('rotateLeft', 'Rotate left', () => this.#transform('rotl'));
        btn('rotate', 'Rotate right', () => this.#transform('rotr'));
        btn('flipH', 'Flip horizontally', () => this.#transform('flipH'));
        btn('flipV', 'Flip vertically', () => this.#transform('flipV'));
        tools.append(h('button', { class: `ece-chip${a.gray ? ' ece-on' : ''}`, onclick: () => { a.gray = !a.gray; this.#renderPanel(); this.render(); } }, 'B&W'));
        p.append(row('Transform', tools));
        const w = h('input', { type: 'number', min: 1, max: 20000, value: a.width, class: 'ece-num', 'aria-label': 'Width' });
        const hh = h('input', { type: 'number', min: 1, max: 20000, value: a.height, class: 'ece-num', 'aria-label': 'Height' });
        const ratio = this.base.width / this.base.height;
        w.addEventListener('input', () => { a.width = +w.value || 1; if (a.lock) { a.height = Math.round(a.width / ratio); hh.value = a.height; } });
        hh.addEventListener('input', () => { a.height = +hh.value || 1; if (a.lock) { a.width = Math.round(a.height * ratio); w.value = a.width; } });
        const lock = h('button', { class: `ece-chip${a.lock ? ' ece-on' : ''}`, title: 'Keep proportions', onclick: () => { a.lock = !a.lock; lock.classList.toggle('ece-on', a.lock); } }, 'Lock');
        const size = h('div', { class: 'ece-inline' });
        size.append(w, h('span', { class: 'ece-x' }, '×'), hh, lock);
        p.append(row('Resize', size));
        break;
      }
      case 'annotate': {
        const tools = [['arrow', 'Arrow'], ['rect', 'Box'], ['ellipse', 'Circle'], ['pen', 'Pen'], ['highlight', 'Marker'], ['text', 'Text']];
        const icons = { arrow: 'arrow', rect: 'square', ellipse: 'circle', pen: 'pen', highlight: 'highlighter', text: 'text' };
        const wrap = h('div', { class: 'ece-chips' });
        for (const [id, label] of tools) {
          wrap.append(h('button', { class: `ece-chip ece-icon${s.tool === id ? ' ece-on' : ''}`, title: label, 'aria-label': label,
            onclick: () => { s.tool = id; this.#renderPanel(); } }, iconSvg(icons[id], 15)));
        }
        p.append(row('Tool', wrap), row('Colour', this.#swatches(COLORS, s.color, (c) => { s.color = c; })),
          slider('Size', s.stroke, 1, Math.max(40, s.stroke * 3), 'px', (v) => { s.stroke = v; }));
        this.#historyButtons(() => s.shapes, () => s.redo);
        break;
      }
      case 'redact': {
        p.append(row('Style', chips([['Black box', 'black'], ['Pixelate', 'pixelate'], ['Blur', 'blur']], s.redactStyle, (v) => { s.redactStyle = v; })));
        p.append(h('div', { class: 'ece-hint ece-note' }, 'Drag over anything you want hidden. Black boxes remove the pixels for good; pixelate and blur are for looks, not secrets.'));
        this.#historyButtons(() => s.redactions, () => (s.redactRedo ??= []));
        break;
      }
      case 'addbg': {
        const b = s.bg;
        const sw = h('div', { class: 'ece-swatches ece-bgs' });
        GRADIENTS.forEach((g, i) => sw.append(h('button', {
          class: `ece-sw${b.kind === 'gradient' && b.index === i ? ' ece-on' : ''}`, style: `background:linear-gradient(135deg,${g.join(',')})`,
          'aria-label': `Gradient ${i + 1}`, onclick: () => { b.kind = 'gradient'; b.index = i; this.#renderPanel(); this.render(); },
        })));
        SOLIDS.forEach((c, i) => sw.append(h('button', {
          class: `ece-sw${b.kind === 'solid' && b.index === i ? ' ece-on' : ''}`, style: `background:${c}`,
          'aria-label': `Colour ${c}`, onclick: () => { b.kind = 'solid'; b.index = i; this.#renderPanel(); this.render(); },
        })));
        const custom = h('input', { type: 'color', value: b.custom, class: 'ece-color', title: 'Custom colour' });
        custom.addEventListener('input', () => { b.kind = 'custom'; b.custom = custom.value; this.render(); });
        sw.append(custom, h('button', {
          class: `ece-sw ece-checker${b.kind === 'none' ? ' ece-on' : ''}`, title: 'Transparent', 'aria-label': 'Transparent',
          onclick: () => { b.kind = 'none'; this.#renderPanel(); this.render(); },
        }));
        const big = Math.max(this.base.width, this.base.height);
        p.append(row('Background', sw),
          slider('Padding', b.padding, 0, Math.round(big * 0.4), ' px', (v) => { b.padding = v; }),
          slider('Corners', b.corners, 0, Math.round(Math.min(this.base.width, this.base.height) / 2), ' px', (v) => { b.corners = v; }),
          slider('Shadow', b.shadow, 0, Math.round(big * 0.1), ' px', (v) => { b.shadow = v; }),
          row('Ratio', chips(BG_RATIOS, b.ratio, (r) => { b.ratio = r; })));
        break;
      }
      case 'info': {
        const t = h('div', { class: 'ece-meta' });
        const meta = this.o.meta || {};
        for (const [k, v] of Object.entries(meta)) t.append(h('div', { class: 'ece-mk' }, esc(k)), h('div', { class: 'ece-mv' }, esc(v)));
        if (!Object.keys(meta).length) t.append(h('div', { class: 'ece-hint' }, 'No metadata found.'));
        p.append(t);
        if (meta.Location) p.append(h('div', { class: 'ece-hint ece-warn' }, 'This file contains the GPS location where it was taken.'));
        break;
      }
    }

    // Footer: Reset · Save
    if (this.mode === 'info') {
      if (this.o.onStripMetadata) {
        this.footer.append(h('div'), h('button', { class: 'ece-primary', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { await this.o.onStripMetadata(); } catch (err) { this.#toast(err.message); e.currentTarget.disabled = false; }
        } }, 'Save copy without metadata'));
      }
      return;
    }
    const reset = h('button', { class: 'ece-ghost', onclick: () => this.reset() }, 'Reset');
    this.undoBtn = h('button', { class: 'ece-ghost ece-icon', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: () => this.undo() }, iconSvg('undo', 15));
    const left = h('div', { class: 'ece-inline' });
    left.append(reset, this.undoBtn);
    this.saveBtn = h('button', { class: 'ece-primary', onclick: () => this.save() }, this.mode === 'addbg' ? 'Save with Background' : 'Save');
    this.footer.append(left, this.saveBtn);
    this.#syncUndo();
  }

  #historyButtons(getList, getRedo) {
    this.shapeUndo = () => { const l = getList(); if (l.length) { getRedo().push(l.pop()); this.render(); return true; } return false; };
    this.shapeRedo = () => { const r = getRedo(); if (r.length) { getList().push(r.pop()); this.render(); return true; } return false; };
  }

  #swatches(colors, current, onPick) {
    const wrap = h('div', { class: 'ece-swatches' });
    for (const c of colors) {
      wrap.append(h('button', { class: `ece-sw ece-dot${c === current ? ' ece-on' : ''}`, style: `background:${c}`, 'aria-label': `Colour ${c}`,
        onclick: () => { onPick(c); this.#renderPanel(); } }));
    }
    return wrap;
  }

  #setCropRatio(r) {
    const c = this.state.crop, W = this.base.width, H = this.base.height;
    c.ratio = r;
    const ratio = r === -1 ? W / H : r;
    if (!ratio) return;
    // Largest centred box with that ratio inside the current one.
    let w = c.w, hh = w / ratio;
    if (hh > c.h) { hh = c.h; w = hh * ratio; }
    c.x = clamp(c.x + (c.w - w) / 2, 0, W - w); c.y = clamp(c.y + (c.h - hh) / 2, 0, H - hh);
    c.w = w; c.h = hh;
  }

  // ---------- geometry ----------

  #layout() {
    const rect = this.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const out = this.mode === 'addbg' ? this.#bgSize() : { w: this.base.width, h: this.base.height };
    const pad = 18;
    const k = Math.min((rect.width - pad * 2) / out.w, (rect.height - pad * 2) / out.h, 4);
    const w = out.w * k, hh = out.h * k;
    return { k, x: (rect.width - w) / 2, y: (rect.height - hh) / 2, w, h: hh, dpr, cw: rect.width, ch: rect.height };
  }

  /** Client point -> image coordinates. */
  #toImage(e) {
    const r = this.view.getBoundingClientRect();
    const L = this.layout;
    return { x: (e.clientX - r.left - L.x) / L.k, y: (e.clientY - r.top - L.y) / L.k };
  }

  // ---------- rendering ----------

  render() {
    if (!this.base) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.#draw());
  }

  #draw() {
    if (this.stage.clientWidth < 20 || this.stage.clientHeight < 20) return;
    const L = (this.layout = this.#layout());
    const v = this.view;
    v.width = Math.round(L.cw * L.dpr);
    v.height = Math.round(L.ch * L.dpr);
    v.style.width = `${L.cw}px`;
    v.style.height = `${L.ch}px`;
    const ctx = v.getContext('2d');
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.clearRect(0, 0, L.cw, L.ch);

    if (this.mode === 'addbg') {
      ctx.save();
      ctx.translate(L.x, L.y);
      ctx.scale(L.k, L.k);
      this.#paintBg(ctx);
      ctx.restore();
      return;
    }

    // checkerboard under transparent images
    ctx.save();
    ctx.beginPath(); ctx.rect(L.x, L.y, L.w, L.h); ctx.clip();
    ctx.fillStyle = this.checker ??= this.#checkerPattern(ctx);
    ctx.fillRect(L.x, L.y, L.w, L.h);
    ctx.restore();

    ctx.save();
    ctx.translate(L.x, L.y);
    ctx.scale(L.k, L.k);
    if (this.mode === 'edit') ctx.filter = this.#filter();
    ctx.drawImage(this.base, 0, 0);
    ctx.filter = 'none';
    if (this.mode === 'edit' && this.state.adjust.warmth) this.#warmth(ctx, this.base.width, this.base.height, this.state.adjust.warmth);
    if (this.mode === 'annotate') this.#paintShapes(ctx, [...this.state.shapes, ...(this.draft ? [this.draft] : [])]);
    if (this.mode === 'redact') this.#paintRedactions(ctx, [...this.state.redactions, ...(this.draft ? [this.draft] : [])], true);
    ctx.restore();

    if (this.mode === 'crop') this.#paintCropOverlay(ctx, L);
  }

  #checkerPattern(ctx) {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#e9e4e1'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
    return ctx.createPattern(c, 'repeat');
  }

  #filter() {
    const a = this.state.adjust;
    const parts = [
      `brightness(${100 + a.brightness}%)`,
      `contrast(${100 + a.contrast}%)`,
      `saturate(${a.gray ? 0 : 100 + a.saturation}%)`,
    ];
    if (a.blur) parts.push(`blur(${a.blur}px)`);
    return parts.join(' ');
  }

  #warmth(ctx, w, hh, amount) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = Math.abs(amount) / 160;
    ctx.fillStyle = amount > 0 ? '#ff8a00' : '#0077ff';
    ctx.fillRect(0, 0, w, hh);
    ctx.restore();
  }

  #paintCropOverlay(ctx, L) {
    const c = this.state.crop;
    const x = L.x + c.x * L.k, y = L.y + c.y * L.k, w = c.w * L.k, hh = c.h * L.k;
    ctx.save();
    ctx.fillStyle = 'rgba(20, 12, 10, .55)';
    ctx.beginPath();
    ctx.rect(L.x, L.y, L.w, L.h);
    ctx.rect(x, y, w, hh);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(x + (w * i) / 3, y); ctx.lineTo(x + (w * i) / 3, y + hh);
      ctx.moveTo(x, y + (hh * i) / 3); ctx.lineTo(x + w, y + (hh * i) / 3);
    }
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, hh);
    // corner handles
    ctx.fillStyle = '#ff5a2e';
    ctx.strokeStyle = '#fff';
    for (const [hx, hy] of this.#handles(x, y, w, hh)) {
      ctx.beginPath(); ctx.arc(hx, hy, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    if (this.cropSize) this.cropSize.textContent = `${Math.round(c.w)} × ${Math.round(c.h)} px`;
  }

  #handles(x, y, w, hh) {
    return [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + hh / 2], [x + w, y + hh], [x + w / 2, y + hh], [x, y + hh], [x, y + hh / 2]];
  }

  #paintShapes(ctx, shapes) {
    for (const s of shapes) {
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle = s.color;
      ctx.lineWidth = s.stroke;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (s.type === 'highlight') { ctx.globalAlpha = 0.38; ctx.lineWidth = s.stroke * 4; ctx.lineCap = 'butt'; }
      if (['rect', 'ellipse', 'arrow'].includes(s.type)) { ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = s.stroke; }
      const { x1, y1, x2, y2 } = s;
      if (s.type === 'rect') {
        roundRect(ctx, Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1), s.stroke * 1.5);
        ctx.stroke();
      } else if (s.type === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.type === 'arrow') {
        const a = Math.atan2(y2 - y1, x2 - x1), head = Math.max(12, s.stroke * 4);
        ctx.beginPath(); ctx.moveTo(x1, y1);
        ctx.lineTo(x2 - Math.cos(a) * head * 0.6, y2 - Math.sin(a) * head * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(a - 0.45), y2 - head * Math.sin(a - 0.45));
        ctx.lineTo(x2 - head * Math.cos(a + 0.45), y2 - head * Math.sin(a + 0.45));
        ctx.closePath(); ctx.fill();
      } else if (s.type === 'pen' || s.type === 'highlight') {
        ctx.beginPath();
        s.points.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.stroke();
      } else if (s.type === 'text') {
        const size = s.stroke * 6;
        ctx.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.lineWidth = Math.max(2, size / 7);
        ctx.strokeStyle = s.color === '#ffffff' ? 'rgba(0,0,0,.6)' : '#fff';
        s.text.split('\n').forEach((line, i) => {
          ctx.strokeText(line, x1, y1 + i * size * 1.2);
          ctx.fillText(line, x1, y1 + i * size * 1.2);
        });
      }
      ctx.restore();
    }
  }

  #paintRedactions(ctx, rects, preview = false) {
    for (const r of rects) {
      const x = Math.round(Math.min(r.x1, r.x2)), y = Math.round(Math.min(r.y1, r.y2));
      const w = Math.round(Math.abs(r.x2 - r.x1)), hh = Math.round(Math.abs(r.y2 - r.y1));
      if (w < 1 || hh < 1) continue;
      if (r.style === 'black') {
        ctx.fillStyle = '#000';
        ctx.fillRect(x, y, w, hh);
      } else if (r.style === 'pixelate') {
        const cell = Math.max(8, Math.round(Math.max(this.base.width, this.base.height) / 80));
        const small = document.createElement('canvas');
        small.width = Math.max(1, Math.ceil(w / cell)); small.height = Math.max(1, Math.ceil(hh / cell));
        small.getContext('2d').drawImage(this.base, x, y, w, hh, 0, 0, small.width, small.height);
        ctx.save(); ctx.imageSmoothingEnabled = false;
        ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, hh);
        ctx.restore();
      } else {
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, w, hh); ctx.clip();
        ctx.filter = `blur(${Math.max(8, Math.round(Math.max(w, hh) / 12))}px)`;
        ctx.drawImage(this.base, x - 20, y - 20, w + 40, hh + 40, x - 20, y - 20, w + 40, hh + 40);
        ctx.restore();
      }
      if (preview && r === this.draft) {
        ctx.save(); ctx.strokeStyle = '#ff5a2e'; ctx.lineWidth = 2 / this.layout.k; ctx.setLineDash([6 / this.layout.k, 4 / this.layout.k]);
        ctx.strokeRect(x, y, w, hh); ctx.restore();
      }
    }
  }

  #bgSize() {
    const b = this.state.bg, W = this.base.width, H = this.base.height;
    let w = W + b.padding * 2, hh = H + b.padding * 2;
    if (b.ratio) {
      if (w / hh < b.ratio) w = hh * b.ratio; else hh = w / b.ratio;
    }
    return { w: Math.round(w), h: Math.round(hh) };
  }

  #paintBg(ctx) {
    const b = this.state.bg, { w, h: hh } = this.#bgSize(), W = this.base.width, H = this.base.height;
    if (b.kind === 'gradient') {
      const stops = GRADIENTS[b.index];
      const g = ctx.createLinearGradient(0, 0, w, hh);
      stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, hh);
    } else if (b.kind === 'solid' || b.kind === 'custom') {
      ctx.fillStyle = b.kind === 'solid' ? SOLIDS[b.index] : b.custom;
      ctx.fillRect(0, 0, w, hh);
    }
    const x = (w - W) / 2, y = (hh - H) / 2;
    if (b.shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(20, 10, 30, .38)';
      ctx.shadowBlur = b.shadow * 2;
      ctx.shadowOffsetY = b.shadow * 0.6;
      roundRect(ctx, x, y, W, H, b.corners);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    roundRect(ctx, x, y, W, H, b.corners);
    ctx.clip();
    ctx.drawImage(this.base, x, y);
    ctx.restore();
  }

  // ---------- committing ----------

  #push(canvas, mode) {
    this.history.push(this.base);
    if (this.history.length > 20) this.history.shift();
    this.future = [];
    this.base = canvas;
    if (mode) this.usedModes.add(mode);
    this.checker = null;
    this.#syncUndo();
  }

  #syncUndo() {
    if (this.undoBtn) this.undoBtn.disabled = !this.history.length && !this.#hasPending();
  }

  #hasPending() {
    const s = this.state, a = s.adjust;
    switch (this.mode) {
      case 'crop': return Math.round(s.crop.w) !== this.base.width || Math.round(s.crop.h) !== this.base.height;
      case 'edit': return a.brightness || a.contrast || a.saturation || a.warmth || a.blur || a.gray ||
        a.width !== this.base.width || a.height !== this.base.height;
      case 'annotate': return s.shapes.length > 0;
      case 'redact': return s.redactions.length > 0;
      case 'addbg': return true;
      default: return false;
    }
  }

  /** Bake the current mode's pending changes into the image. */
  #commitPending() {
    if (!this.base || !this.#hasPending()) return;
    const s = this.state;
    const W = this.base.width, H = this.base.height;
    let out;
    switch (this.mode) {
      case 'crop': {
        const c = s.crop;
        out = document.createElement('canvas');
        out.width = Math.round(c.w); out.height = Math.round(c.h);
        out.getContext('2d').drawImage(this.base, Math.round(c.x), Math.round(c.y), out.width, out.height, 0, 0, out.width, out.height);
        break;
      }
      case 'edit': {
        const a = s.adjust;
        const full = document.createElement('canvas');
        full.width = W; full.height = H;
        const ctx = full.getContext('2d');
        ctx.filter = this.#filter();
        ctx.drawImage(this.base, 0, 0);
        ctx.filter = 'none';
        if (a.warmth) this.#warmth(ctx, W, H, a.warmth);
        out = a.width !== W || a.height !== H ? toCanvas(full, a.width, a.height) : full;
        Object.assign(a, { brightness: 0, contrast: 0, saturation: 0, warmth: 0, blur: 0, gray: false });
        break;
      }
      case 'annotate': {
        out = toCanvas(this.base);
        this.#paintShapes(out.getContext('2d'), s.shapes);
        s.shapes = []; s.redo = [];
        break;
      }
      case 'redact': {
        out = toCanvas(this.base);
        this.#paintRedactions(out.getContext('2d'), s.redactions);
        s.redactions = []; s.redactRedo = [];
        break;
      }
      case 'addbg': {
        const { w, h: hh } = this.#bgSize();
        out = document.createElement('canvas');
        out.width = w; out.height = hh;
        this.#paintBg(out.getContext('2d'));
        break;
      }
    }
    if (out) this.#push(out, this.mode);
  }

  #transform(kind) {
    const W = this.base.width, H = this.base.height;
    const rot = kind === 'rotl' || kind === 'rotr';
    const out = document.createElement('canvas');
    out.width = rot ? H : W; out.height = rot ? W : H;
    const ctx = out.getContext('2d');
    if (kind === 'rotr') { ctx.translate(H, 0); ctx.rotate(Math.PI / 2); }
    if (kind === 'rotl') { ctx.translate(0, W); ctx.rotate(-Math.PI / 2); }
    if (kind === 'flipH') { ctx.translate(W, 0); ctx.scale(-1, 1); }
    if (kind === 'flipV') { ctx.translate(0, H); ctx.scale(1, -1); }
    ctx.drawImage(this.base, 0, 0);
    this.#push(out, 'edit');
    Object.assign(this.state.adjust, { width: out.width, height: out.height });
    this.#renderPanel();
    this.render();
  }

  undo() {
    if (this.shapeUndo && ['annotate', 'redact'].includes(this.mode) && this.shapeUndo()) return;
    if (!this.history.length) return;
    this.future.push(this.base);
    this.base = this.history.pop();
    this.state = { ...this.#freshState(), tool: this.state.tool, color: this.state.color, redactStyle: this.state.redactStyle, bg: this.state.bg };
    this.setMode(this.mode, { force: true });
    this.#syncUndo();
  }

  redo() {
    if (this.shapeRedo && ['annotate', 'redact'].includes(this.mode) && this.shapeRedo()) return;
    if (!this.future.length) return;
    this.history.push(this.base);
    this.base = this.future.pop();
    this.setMode(this.mode, { force: true });
  }

  reset() {
    if (this.history.length) this.base = this.history[0];
    this.history = []; this.future = []; this.usedModes.clear();
    this.state = this.#freshState();
    this.setMode(this.mode, { force: true });
  }

  async save() {
    this.#commitPending();
    const fmt = this.o.fmt;
    const transparentBg = this.usedModes.has('addbg') && this.state.bg.kind === 'none';
    const keep = ['png', 'jpg', 'webp'].includes(fmt) && !this.usedModes.has('addbg') && !transparentBg;
    const ext = keep ? fmt : 'png';
    const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[ext];
    let canvas = this.base;
    if (ext === 'jpg') { // JPEG has no alpha: flatten on white
      canvas = document.createElement('canvas');
      canvas.width = this.base.width; canvas.height = this.base.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(this.base, 0, 0);
    }
    const blob = await new Promise((r) => canvas.toBlob(r, mime, 0.92));
    const modes = [...this.usedModes];
    const suffix = modes.length === 1 ? MODES.find((m) => m.id === modes[0]).suffix
      : modes.includes('addbg') ? `${modes.length > 1 ? 'Edited ' : ''}with BG` : 'Edited';
    this.saveBtn && (this.saveBtn.disabled = true);
    try {
      await this.o.onSave(blob, ext, suffix);
    } catch (e) {
      this.#toast(e.message || String(e));
      this.saveBtn && (this.saveBtn.disabled = false);
    }
  }

  close() {
    document.removeEventListener('keydown', this.onKey);
    this.o.onClose?.();
  }

  #toast(text) {
    const t = h('div', { class: 'ece-toast', role: 'alert' }, esc(text));
    this.el.append(t);
    setTimeout(() => t.remove(), 4000);
  }

  // ---------- input ----------

  #key(e) {
    if (e.target.matches?.('input, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.save(); }
    else if (e.key === 'Enter' && this.mode !== 'info') { e.preventDefault(); this.save(); }
  }

  #bindPointer() {
    const v = this.view;
    let drag = null;
    v.addEventListener('pointerdown', (e) => {
      if (!this.base || e.button !== 0) return;
      const p = this.#toImage(e);
      const s = this.state;
      if (this.mode === 'crop') {
        const L = this.layout, c = s.crop;
        const r = v.getBoundingClientRect();
        const cx = e.clientX - r.left, cy = e.clientY - r.top;
        const hs = this.#handles(L.x + c.x * L.k, L.y + c.y * L.k, c.w * L.k, c.h * L.k);
        const hi = hs.findIndex(([hx, hy]) => Math.hypot(hx - cx, hy - cy) < 14);
        const inside = p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h;
        if (hi < 0 && !inside) {
          drag = { kind: 'new', start: p, orig: { ...c } };
        } else {
          drag = { kind: hi >= 0 ? `h${hi}` : 'move', start: p, orig: { ...c } };
        }
      } else if (this.mode === 'annotate') {
        if (s.tool === 'text') { this.#textInput(e, p); return; }
        this.draft = { type: s.tool, color: s.color, stroke: s.stroke, x1: p.x, y1: p.y, x2: p.x, y2: p.y, points: [[p.x, p.y]] };
        drag = { kind: 'draw' };
      } else if (this.mode === 'redact') {
        this.draft = { style: s.redactStyle, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        drag = { kind: 'draw' };
      } else {
        return;
      }
      v.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    v.addEventListener('pointermove', (e) => {
      if (!this.base) return;
      if (!drag) { this.#cursor(e); return; }
      const p = this.#toImage(e);
      const W = this.base.width, H = this.base.height;
      if (this.mode === 'crop') this.#dragCrop(drag, { x: clamp(p.x, 0, W), y: clamp(p.y, 0, H) }, e.shiftKey);
      else if (this.draft) {
        this.draft.x2 = p.x; this.draft.y2 = p.y;
        if (this.draft.points && (this.draft.type === 'pen' || this.draft.type === 'highlight')) this.draft.points.push([p.x, p.y]);
        if (e.shiftKey && this.draft.type === 'highlight') this.draft.points = [this.draft.points[0], [p.x, this.draft.points[0][1]]];
      }
      this.render();
    });
    const end = () => {
      if (!drag) return;
      if (this.draft) {
        const d = this.draft;
        const big = Math.abs(d.x2 - d.x1) + Math.abs(d.y2 - d.y1) > 4 || (d.points?.length > 2);
        if (big) {
          if (this.mode === 'annotate') { this.state.shapes.push(d); this.state.redo = []; }
          else { this.state.redactions.push(d); this.state.redactRedo = []; }
        }
        this.draft = null;
      }
      drag = null;
      this.#syncUndo();
      this.render();
    };
    v.addEventListener('pointerup', end);
    v.addEventListener('pointercancel', end);
  }

  #cursor(e) {
    if (this.mode === 'crop') {
      const L = this.layout, c = this.state.crop, r = this.view.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      const hs = this.#handles(L.x + c.x * L.k, L.y + c.y * L.k, c.w * L.k, c.h * L.k);
      const hi = hs.findIndex(([hx, hy]) => Math.hypot(hx - cx, hy - cy) < 14);
      const cursors = ['nwse', 'ns', 'nesw', 'ew', 'nwse', 'ns', 'nesw', 'ew'];
      const p = this.#toImage(e);
      const inside = p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h;
      this.view.style.cursor = hi >= 0 ? `${cursors[hi]}-resize` : inside ? 'move' : 'crosshair';
    } else if (this.mode === 'annotate') {
      this.view.style.cursor = this.state.tool === 'text' ? 'text' : 'crosshair';
    } else {
      this.view.style.cursor = this.mode === 'redact' ? 'crosshair' : 'default';
    }
  }

  #dragCrop(drag, p, free) {
    const c = this.state.crop, o = drag.orig, W = this.base.width, H = this.base.height;
    const ratio = c.ratio === -1 ? W / H : c.ratio;
    const min = 8;
    if (drag.kind === 'move') {
      c.x = clamp(o.x + p.x - drag.start.x, 0, W - o.w);
      c.y = clamp(o.y + p.y - drag.start.y, 0, H - o.h);
      return;
    }
    let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
    if (drag.kind === 'new') { x1 = drag.start.x; y1 = drag.start.y; x2 = p.x; y2 = p.y; }
    else {
      const i = +drag.kind.slice(1);
      if ([0, 6, 7].includes(i)) x1 = p.x;
      if ([2, 3, 4].includes(i)) x2 = p.x;
      if ([0, 1, 2].includes(i)) y1 = p.y;
      if ([4, 5, 6].includes(i)) y2 = p.y;
    }
    let x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.max(min, Math.abs(x2 - x1)), hh = Math.max(min, Math.abs(y2 - y1));
    if (ratio && !free) {
      if (w / hh > ratio) w = hh * ratio; else hh = w / ratio;
      if (x1 > x2 || (drag.kind !== 'new' && [0, 6, 7].includes(+drag.kind.slice(1)))) x = Math.max(x1, x2) - w;
      if (y1 > y2 || (drag.kind !== 'new' && [0, 1, 2].includes(+drag.kind.slice(1)))) y = Math.max(y1, y2) - hh;
    }
    c.x = clamp(x, 0, W - min); c.y = clamp(y, 0, H - min);
    c.w = Math.min(w, W - c.x); c.h = Math.min(hh, H - c.y);
  }

  #textInput(e, p) {
    const s = this.state;
    const r = this.stage.getBoundingClientRect();
    const size = s.stroke * 6 * this.layout.k;
    const ta = h('textarea', { class: 'ece-textin', rows: 1, placeholder: 'Type, then Enter' });
    Object.assign(ta.style, { left: `${e.clientX - r.left}px`, top: `${e.clientY - r.top}px`, fontSize: `${Math.max(12, size)}px`, color: s.color });
    this.stage.append(ta);
    setTimeout(() => ta.focus());
    const done = (keep) => {
      if (ta.isConnected) {
        if (keep && ta.value.trim()) { s.shapes.push({ type: 'text', text: ta.value, color: s.color, stroke: s.stroke, x1: p.x, y1: p.y }); s.redo = []; }
        ta.remove();
        this.#syncUndo();
        this.render();
      }
    };
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); done(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
    });
    ta.addEventListener('blur', () => done(true));
  }
}
