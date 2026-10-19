// Editor tab: #<tool>:<handoff id> — loads the file the wheel stored, saves via Downloads.
import { ImageEditor } from '../shared/editor/editor.js';
import { formatOf, splitName } from '../shared/formats.js';
import { takeFile } from '../web/store.js';
import { decodeImage } from '../web/engine.js';
import { download } from '../web/session.js';

const root = document.getElementById('root');
const [tool, id] = location.hash.slice(1).split(':');
const file = id ? await takeFile(id) : null;

if (!file) {
  root.innerHTML = '<div class="done">This edit session has expired. Open the file from the wheel again.</div>';
} else {
  const fmt = formatOf(file.name);
  document.title = `${file.name} — Easy Convert`;
  new ImageEditor(root, {
    image: await decodeImage(file.blob, fmt),
    name: file.name,
    fmt,
    mode: tool,
    async onSave(blob, ext, suffix) {
      const { base } = splitName(file.name);
      await download([{ blob, name: `${base} ${suffix}.${ext}` }]);
      document.body.innerHTML = '<div class="done">Saved to Downloads ✓</div>';
      setTimeout(() => window.close(), 1200);
    },
    onClose: () => window.close(),
  });
}
