// Dev-only page for previewing the editor: editor.html?mode=crop&img=fixtures/photo.jpg
import { ImageEditor } from '../shared/editor/editor.js';

const p = new URLSearchParams(location.search);
const blob = await (await fetch(p.get('img') || '../webtest/fixtures/photo.jpg')).blob();
const image = await createImageBitmap(blob);
window.editor = new ImageEditor(document.getElementById('root'), {
  image, name: 'photo.jpg', fmt: 'jpg', mode: p.get('mode') || 'crop',
  meta: { File: 'photo.jpg', Dimensions: `${image.width} × ${image.height}`, Camera: 'iPhone 15 Pro', Location: '45.46420, 9.18998' },
  onSave: async () => {}, onClose: () => {},
});
