// Renderer for the editor window (Crop / Add BG / Redact / … / Metadata).
import { ImageEditor } from '../../shared/editor/editor.js';
import { mimeOf } from '../../shared/formats.js';

const easy = window.easy;
const root = document.getElementById('root');
const clean = (e) => new Error(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));

const init = await easy.editorInit();
let image = null;
if (init.bytes) {
  const type = init.bytes && ['png', 'jpg', 'webp', 'gif', 'avif', 'bmp'].includes(init.fmt) ? mimeOf(init.fmt) : 'image/png';
  image = await createImageBitmap(new Blob([init.bytes], { type }));
}

new ImageEditor(root, {
  desktop: true,
  image,
  name: init.name,
  fmt: init.fmt,
  mode: init.tool,
  meta: init.meta,
  async onSave(blob, ext, suffix) {
    try { await easy.editorSave(new Uint8Array(await blob.arrayBuffer()), ext, suffix); } catch (e) { throw clean(e); }
  },
  async onStripMetadata() {
    try { await easy.editorStrip(); } catch (e) { throw clean(e); }
  },
  onClose: () => easy.editorClose(),
});
document.title = init.name;
