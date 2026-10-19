// Radial action wheel. Framework-free so it runs in the Electron window,
// the extension's in-page overlay and the extension's app page alike.

import { iconSvg } from './icons.js';
import { WHEEL_CSS } from './wheel-css.js';

const TAU = Math.PI * 2;
const MAX_PER_PAGE = 8;

/**
 * @typedef {{ id: string, label: string, icon?: string, hint?: string }} WheelItem
 * @typedef {{ id: string, label: string, icon?: string, items: WheelItem[] }} WheelRing
 * @typedef {{ title: string, detail?: string, actions?: { label: string, icon?: string, run: () => void }[] }} WheelResult
 */
export class Wheel {
  /**
   * @param {HTMLElement} root   full-size layer that receives pointer events
   * @param {object} opts
   * @param {string} opts.title  file name, or "3 files"
   * @param {WheelRing[]} opts.rings
   * @param {(item: WheelItem, ring: WheelRing, wheel: Wheel) => Promise<WheelResult|void>} opts.onSelect
   * @param {() => void} [opts.onClose]
   * @param {number} [opts.size=380]
   * @param {boolean} [opts.dragMode=false]  host drives hover/drop from drag events
   * @param {number} [opts.autoCloseMs=2400]
   */
  constructor(root, opts) {
    this.root = root;
    this.opts = { size: 380, dragMode: false, autoCloseMs: 2400, ...opts };
    this.rings = opts.rings.filter((r) => r.items.length);
    this.ringIndex = 0;
    this.page = 0;
    this.hot = -1;
    this.state = 'idle'; // idle | busy | done | error | closed
    this.#mount();
  }

  // ---------- geometry ----------

  get S() { return this.opts.size; }
  get R() { return this.S / 2 - 16; }
  get r() { return Math.round(this.R * 0.43); }
  get hubR() { return this.r - 9; }

  /** Items on the current page, with "More"/"Back" paging entries when needed. */
  get items() {
    const all = this.rings[this.ringIndex]?.items ?? [];
    if (all.length <= MAX_PER_PAGE) return all;
    const per = MAX_PER_PAGE - 1;
    const pages = Math.ceil(all.length / per);
    const slice = all.slice(this.page * per, this.page * per + per);
    const last = this.page === pages - 1;
    return [...slice, { id: '__page', label: last ? 'Back' : 'More', icon: last ? 'back' : 'more', paging: true }];
  }

  // ---------- DOM ----------

  #mount() {
    if (!this.root.querySelector('style[data-ecw]')) {
      const style = document.createElement('style');
      style.dataset.ecw = '';
      style.textContent = WHEEL_CSS;
      this.root.appendChild(style);
    }
    const el = document.createElement('div');
    el.className = 'ecw';
    el.tabIndex = 0;
    el.setAttribute('role', 'menu');
    el.style.width = el.style.height = `${this.S}px`;
    el.innerHTML = `
      <svg class="ecw-svg" viewBox="0 0 ${this.S} ${this.S}" aria-hidden="true">
        <defs>
          <linearGradient id="ecw-hot" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#ff9a3c"/><stop offset="1" stop-color="#ff3b2f"/>
          </linearGradient>
        </defs>
        <circle class="ecw-disc" cx="${this.S / 2}" cy="${this.S / 2}" r="${this.R + 9}"/>
        <g class="ecw-petals"></g>
        <circle class="ecw-track" cx="${this.S / 2}" cy="${this.S / 2}" r="${this.hubR + 4}"/>
        <circle class="ecw-progress" cx="${this.S / 2}" cy="${this.S / 2}" r="${this.hubR + 4}"
          transform="rotate(-90 ${this.S / 2} ${this.S / 2})"/>
      </svg>
      <div class="ecw-labels"></div>
      <div class="ecw-hub" style="width:${this.hubR * 2}px;height:${this.hubR * 2}px"></div>
      <div class="ecw-live" aria-live="polite"></div>`;
    this.el = el;
    this.petalsEl = el.querySelector('.ecw-petals');
    this.labelsEl = el.querySelector('.ecw-labels');
    this.hubEl = el.querySelector('.ecw-hub');
    this.liveEl = el.querySelector('.ecw-live');
    this.progressEl = el.querySelector('.ecw-progress');
    const circ = TAU * (this.hubR + 4);
    this.progressEl.style.strokeDasharray = `${circ}`;
    this.progressEl.style.strokeDashoffset = `${circ}`;
    this.root.appendChild(el);
    this.#renderPetals();
    this.#renderHub();
    this.#bind();
  }

  /** Center the wheel at (x, y) within the root, kept fully on screen. */
  open(x, y) {
    const w = this.root.clientWidth || innerWidth, h = this.root.clientHeight || innerHeight;
    const half = this.S / 2 + 6;
    const clamp = (v, max) => (max >= 2 * half ? Math.min(Math.max(v, half), max - half) : v);
    x = clamp(x ?? w / 2, w);
    y = clamp(y ?? h / 2, h);
    this.el.style.left = `${x - this.S / 2}px`;
    this.el.style.top = `${y - this.S / 2}px`;
    requestAnimationFrame(() => this.el.classList.add('ecw-open'));
    if (!this.opts.dragMode) this.el.focus({ preventScroll: true });
    return this;
  }

  #petalPath(i, n) {
    const c = this.S / 2, seg = TAU / n, mid = i * seg;
    const corner = 9, gap = n > 1 ? 7 : 0;
    const Ro = this.R - corner, Ri = this.r + corner;
    const half = (rad) => (n === 1 ? Math.PI - 0.0001 : seg / 2 - (gap / 2 + corner) / rad);
    const pt = (rad, a) => `${(c + rad * Math.sin(a)).toFixed(2)} ${(c - rad * Math.cos(a)).toFixed(2)}`;
    const ho = half(Ro), hi = half(Ri);
    const large = 2 * ho > Math.PI ? 1 : 0;
    return `M${pt(Ro, mid - ho)}A${Ro} ${Ro} 0 ${large} 1 ${pt(Ro, mid + ho)}L${pt(Ri, mid + hi)}A${Ri} ${Ri} 0 ${large} 0 ${pt(Ri, mid - hi)}Z`;
  }

  #renderPetals() {
    const items = this.items, n = items.length, c = this.S / 2;
    const labelR = (this.R + this.r) / 2;
    this.petalsEl.innerHTML = '';
    this.labelsEl.innerHTML = '';
    items.forEach((item, i) => {
      const a = (i * TAU) / n;
      const dx = (Math.sin(a) * 5).toFixed(1), dy = (-Math.cos(a) * 5).toFixed(1);
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      g.setAttribute('d', this.#petalPath(i, n));
      g.setAttribute('class', `ecw-petal${item.paging ? ' ecw-paging' : ''}`);
      g.style.setProperty('--i', i);
      g.style.setProperty('--dx', `${dx}px`);
      g.style.setProperty('--dy', `${dy}px`);
      this.petalsEl.appendChild(g);

      const label = document.createElement('div');
      label.className = `ecw-label${item.icon ? ' ecw-has-icon' : ''}${item.paging ? ' ecw-paging' : ''}`;
      label.setAttribute('role', 'menuitem');
      label.setAttribute('aria-label', item.hint ? `${item.label}: ${item.hint}` : item.label);
      label.style.left = `${c + labelR * Math.sin(a)}px`;
      label.style.top = `${c - labelR * Math.cos(a)}px`;
      label.style.setProperty('--i', i);
      label.style.setProperty('--dx', `${dx}px`);
      label.style.setProperty('--dy', `${dy}px`);
      label.innerHTML = `${item.icon ? iconSvg(item.icon, 17) : ''}<span>${escape(item.label)}</span>`;
      this.labelsEl.appendChild(label);
    });
    this.hot = -1;
  }

  #renderHub() {
    const ring = this.rings[this.ringIndex];
    const other = this.rings[(this.ringIndex + 1) % this.rings.length];
    const hotItem = this.items[this.hot];
    let html;
    if (this.state === 'busy') {
      html = `<div class="ecw-kicker">${escape(this.busyLabel || 'Working')}</div>
        <div class="ecw-big">${this.fraction != null ? Math.round(this.fraction * 100) + '%' : '<span class="ecw-spinner"></span>'}</div>
        <div class="ecw-sub">${escape(this.busyDetail || '')}</div>`;
    } else if (this.state === 'done') {
      const r = this.result || {};
      html = `<div class="ecw-badge ecw-ok">${iconSvg('check', 20, 2.4)}</div>
        <div class="ecw-title">${escape(r.title || 'Done')}</div>
        ${r.detail ? `<div class="ecw-sub">${escape(r.detail)}</div>` : ''}
        ${r.actions?.length ? `<div class="ecw-actions">${r.actions.map((a, i) =>
    `<button data-action="${i}" title="${escape(a.label)}">${a.icon ? iconSvg(a.icon, 14) : ''}<span>${escape(a.label)}</span></button>`).join('')}</div>` : ''}`;
    } else if (this.state === 'error') {
      html = `<div class="ecw-badge ecw-err">${iconSvg('x', 20, 2.4)}</div>
        <div class="ecw-err-text">${escape(this.errorText || 'Something went wrong')}</div>`;
    } else if (hotItem) {
      html = `<div class="ecw-pill">${escape(hotItem.label)}</div>${hotItem.hint ? `<div class="ecw-sub">${escape(hotItem.hint)}</div>` : ''}`;
    } else {
      html = `<div class="ecw-kicker">${escape(ring?.label ?? '')}</div>
        <div class="ecw-title" title="${escape(this.opts.title)}">${escape(this.opts.title)}</div>
        ${this.opts.dragMode ? '<div class="ecw-sub">Drop on an option</div>' : ''}
        ${this.rings.length > 1 ? `<button class="ecw-switch" data-switch>${iconSvg(other.icon || 'swap', 13)}<span>${escape(other.label)}</span></button>` : ''}`;
    }
    this.hubEl.innerHTML = html;
    this.hubEl.dataset.state = this.state;
    this.el.dataset.state = this.state;
  }

  #setHot(i) {
    if (i === this.hot || this.state !== 'idle') return;
    const petals = this.petalsEl.children, labels = this.labelsEl.children;
    if (this.hot >= 0) { petals[this.hot]?.classList.remove('ecw-hot'); labels[this.hot]?.classList.remove('ecw-hot'); }
    this.hot = i;
    if (i >= 0) {
      petals[i]?.classList.add('ecw-hot');
      labels[i]?.classList.add('ecw-hot');
      this.liveEl.textContent = this.items[i]?.label ?? '';
    }
    this.#renderHub();
  }

  // ---------- hit testing ----------

  /** 'hub' | item index | -1 for a client point. */
  hitTest(clientX, clientY, { generous = false } = {}) {
    const rect = this.el.getBoundingClientRect();
    const k = rect.width / this.S || 1;
    const dx = (clientX - rect.left) / k - this.S / 2, dy = (clientY - rect.top) / k - this.S / 2;
    const d = Math.hypot(dx, dy);
    if (d <= this.hubR) return 'hub';
    if (d < this.r - 4) return -1;
    if (d > this.R + (generous ? this.S : 70)) return -1;
    const n = this.items.length;
    let a = Math.atan2(dx, -dy); // clockwise from 12 o'clock
    if (a < 0) a += TAU;
    return Math.floor((a + TAU / n / 2) / (TAU / n)) % n;
  }

  /** Drag mode: update the highlighted option from a dragover position. */
  hoverAt(clientX, clientY) {
    const hit = this.hitTest(clientX, clientY);
    this.#setHot(typeof hit === 'number' ? hit : -1);
    return typeof hit === 'number' && hit >= 0 ? this.items[hit] : null;
  }

  /** Drag mode: drop at a position. Returns true when it landed on an option. */
  dropAt(clientX, clientY) {
    const hit = this.hitTest(clientX, clientY);
    if (typeof hit === 'number' && hit >= 0) { this.activate(hit); return true; }
    return false;
  }

  // ---------- actions ----------

  switchRing(delta = 1) {
    if (this.rings.length < 2 || this.state !== 'idle') return;
    this.ringIndex = (this.ringIndex + delta + this.rings.length) % this.rings.length;
    this.page = 0;
    this.#animateSwap();
  }

  #animateSwap() {
    this.el.classList.add('ecw-swap');
    setTimeout(() => {
      this.#renderPetals();
      this.#renderHub();
      this.el.classList.remove('ecw-swap');
    }, 120);
  }

  async activate(i) {
    if (this.state !== 'idle') return;
    const item = this.items[i];
    if (!item) return;
    if (item.paging) {
      const per = MAX_PER_PAGE - 1;
      const pages = Math.ceil(this.rings[this.ringIndex].items.length / per);
      this.page = (this.page + 1) % pages;
      this.#animateSwap();
      return;
    }
    this.#setHot(i);
    this.el.classList.add('ecw-picked');
    this.setBusy(item.label, null, this.opts.busyText?.(item) ?? 'Working');
    try {
      const result = await this.opts.onSelect(item, this.rings[this.ringIndex], this);
      if (this.state === 'closed') return;
      if (result === false) { this.reset(); return; }
      this.setDone(result || {});
    } catch (e) {
      if (this.state === 'closed') return;
      this.setError(e?.message || String(e));
    }
  }

  setBusy(detail, fraction = null, label) {
    this.state = 'busy';
    this.busyDetail = detail ?? this.busyDetail;
    if (label) this.busyLabel = label;
    this.fraction = fraction;
    const circ = TAU * (this.hubR + 4);
    this.progressEl.style.strokeDashoffset = `${circ * (1 - (fraction ?? 0.08))}`;
    this.progressEl.classList.toggle('ecw-indeterminate', fraction == null);
    this.#renderHub();
  }

  setProgress(fraction, label) {
    if (this.state !== 'busy') return;
    this.setBusy(label ?? this.busyDetail, fraction);
  }

  setDone(result) {
    this.state = 'done';
    this.result = result;
    this.progressEl.style.strokeDashoffset = '0';
    this.progressEl.classList.remove('ecw-indeterminate');
    this.#renderHub();
    this.liveEl.textContent = result.title || 'Done';
    clearTimeout(this.closeTimer);
    if (this.opts.autoCloseMs && !result.actions?.length) {
      this.closeTimer = setTimeout(() => this.close(), this.opts.autoCloseMs);
    } else if (this.opts.autoCloseMs) {
      this.closeTimer = setTimeout(() => { if (!this.el.matches(':hover')) this.close(); }, this.opts.autoCloseMs + 3000);
    }
  }

  setError(text) {
    this.state = 'error';
    this.errorText = text;
    this.el.classList.remove('ecw-picked');
    this.progressEl.classList.remove('ecw-indeterminate');
    this.#renderHub();
    this.liveEl.textContent = text;
  }

  /** Back to choosing (after an error or a cancelled editor). */
  reset() {
    this.state = 'idle';
    this.el.classList.remove('ecw-picked');
    const circ = TAU * (this.hubR + 4);
    this.progressEl.style.strokeDashoffset = `${circ}`;
    const hot = this.hot;
    this.hot = -1;
    this.#renderPetals();
    if (hot >= 0) this.#setHot(hot); else this.#renderHub();
  }

  close() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    clearTimeout(this.closeTimer);
    this.el.classList.remove('ecw-open');
    this.el.classList.add('ecw-closing');
    this.#unbind();
    setTimeout(() => { this.el.remove(); this.opts.onClose?.(); }, 170);
  }

  // ---------- input ----------

  #bind() {
    const onMove = (e) => {
      if (this.opts.dragMode || this.state !== 'idle') return;
      const hit = this.hitTest(e.clientX, e.clientY);
      this.#setHot(typeof hit === 'number' ? hit : -1);
      this.el.classList.toggle('ecw-hub-hover', hit === 'hub');
    };
    const onDown = (e) => {
      if (this.opts.dragMode || e.button !== 0) return;
      const target = e.target;
      const actionBtn = target.closest?.('[data-action]');
      if (actionBtn) {
        e.preventDefault();
        this.result?.actions?.[+actionBtn.dataset.action]?.run();
        return;
      }
      const hit = this.hitTest(e.clientX, e.clientY);
      if (this.state === 'error') { if (hit === -1) this.close(); else this.reset(); return; }
      if (this.state === 'done') { if (hit === -1) this.close(); return; }
      if (this.state !== 'idle') return;
      if (hit === 'hub') { e.preventDefault(); this.switchRing(); return; }
      if (hit === -1) { this.close(); return; }
      e.preventDefault();
      this.activate(hit);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
      if (this.state === 'error' && (e.key === 'Enter' || e.key === ' ')) { this.reset(); return; }
      if (this.state !== 'idle') return;
      const n = this.items.length;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); this.#setHot((this.hot + 1 + n) % n); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); this.#setHot((Math.max(this.hot, 0) - 1 + n) % n); }
      else if (e.key === 'Enter' && this.hot >= 0) { e.preventDefault(); this.activate(this.hot); }
      else if (e.key === 'Tab' || e.key === ' ') { e.preventDefault(); this.switchRing(e.shiftKey ? -1 : 1); }
      else if (/^[1-9]$/.test(e.key) && +e.key <= n) { e.preventDefault(); this.activate(+e.key - 1); }
    };
    const onWheel = (e) => {
      if (this.state !== 'idle' || this.opts.dragMode) return;
      e.preventDefault();
      if (this.rings.length > 1) this.switchRing(e.deltaY > 0 ? 1 : -1);
    };
    const onLeave = () => { if (!this.opts.dragMode) this.#setHot(-1); };
    this.handlers = { pointermove: onMove, pointerdown: onDown, keydown: onKey, wheel: onWheel, pointerleave: onLeave };
    // Keys are read document-wide: the wheel is modal while it's open.
    for (const [t, h] of Object.entries(this.handlers)) {
      (t === 'keydown' ? this.el.ownerDocument : this.root).addEventListener(t, h, { passive: t !== 'wheel' && t !== 'pointerdown' && t !== 'keydown' });
    }
  }

  #unbind() {
    for (const [t, h] of Object.entries(this.handlers || {})) (t === 'keydown' ? this.el.ownerDocument : this.root).removeEventListener(t, h);
  }
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
