// Runs on every page. Kept tiny: it only notices Shift+file drags and right-clicks,
// then mounts the wheel overlay — an extension page in an iframe inside a closed
// shadow root, so the page can't reach into it.

(() => {
  if (window.__easyConvertLoaded) return;
  window.__easyConvertLoaded = true;

  const ORIGIN = new URL(chrome.runtime.getURL('')).origin;
  let host = null;
  let frame = null;
  let nonce = null; // overlay -> us (page scripts may see it)
  let key = null; // us -> overlay (never leaves this script or the iframe URL)
  let lastPoint = { x: innerWidth / 2, y: innerHeight / 2 };
  let alwaysOnDrag = false;
  let pendingFile = null;

  chrome.storage?.sync.get({ alwaysOnDrag: false }).then((s) => { alwaysOnDrag = s.alwaysOnDrag; }).catch(() => {});
  chrome.storage?.onChanged.addListener((c) => { if (c.alwaysOnDrag) alwaysOnDrag = c.alwaysOnDrag.newValue; });

  addEventListener('contextmenu', (e) => { lastPoint = { x: e.clientX, y: e.clientY }; }, true);

  const isFileDrag = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');

  function mount(params) {
    unmount();
    nonce = crypto.randomUUID();
    key = crypto.randomUUID();
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:auto;';
    const root = host.attachShadow({ mode: 'closed' });
    frame = document.createElement('iframe');
    const q = new URLSearchParams({ ...params, n: nonce, k: key });
    frame.src = `${chrome.runtime.getURL('overlay.html')}#${q}`;
    frame.allow = 'clipboard-write';
    frame.style.cssText = 'border:0;width:100%;height:100%;background:transparent;color-scheme:normal;display:block;';
    root.appendChild(frame);
    (document.body || document.documentElement).appendChild(host);
  }

  function unmount() {
    host?.remove();
    host = frame = null;
    pendingFile = null;
  }

  // Shift + drag a file over the page -> wheel appears under the cursor.
  const onDrag = (e) => {
    if (host || !isFileDrag(e) || !(e.shiftKey || alwaysOnDrag)) return;
    const types = [...e.dataTransfer.items].filter((i) => i.kind === 'file').map((i) => i.type || '');
    mount({ mode: 'drag', x: Math.round(e.clientX), y: Math.round(e.clientY), types: types.join(',') });
  };
  addEventListener('dragenter', onDrag, true);
  addEventListener('dragover', onDrag, true);

  addEventListener('message', (e) => {
    if (e.origin !== ORIGIN || e.data?.nonce !== nonce) return;
    if (e.data.type === 'close') unmount();
    if (e.data.type === 'ready' && pendingFile) {
      frame?.contentWindow?.postMessage({ type: 'file', key, ...pendingFile }, ORIGIN);
      pendingFile = null;
    }
  });

  addEventListener('keydown', (e) => { if (e.key === 'Escape' && host) unmount(); }, true);

  // Right-click menu entry (from the background worker).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'ec-open') return;
    const { src } = msg;
    const name = nameFromUrl(src);
    if (/^(blob|data):/.test(src)) {
      // Only this page can read its own blob: URLs — fetch here, hand the Blob over.
      fetch(src).then((r) => r.blob()).then((blob) => {
        mount({ mode: 'file', x: lastPoint.x, y: lastPoint.y });
        pendingFile = { blob, name: withExtension(name, blob.type) }; // sent once the overlay says it's ready
      }).catch(() => {});
    } else {
      mount({ mode: 'url', src, name, x: lastPoint.x, y: lastPoint.y });
    }
  });

  function nameFromUrl(src) {
    try {
      if (/^(blob|data):/.test(src)) return 'image';
      const last = decodeURIComponent(new URL(src).pathname.split('/').filter(Boolean).pop() || 'download');
      return last.slice(0, 120);
    } catch {
      return 'download';
    }
  }

  function withExtension(name, type) {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
      'image/avif': 'avif', 'image/bmp': 'bmp', 'application/pdf': 'pdf' }[type];
    return /\.[a-z0-9]{2,5}$/i.test(name) || !ext ? name : `${name}.${ext}`;
  }
})();
