// Renderer for the pop-up wheel window (opened from Explorer's right-click menu).
import { showWheel } from './session.js';

const easy = window.easy;
const layer = document.getElementById('layer');
let wheel = null;

easy.onReset(() => { wheel?.el.remove(); wheel = null; });
easy.onOpen((data) => {
  wheel?.el.remove();
  wheel = showWheel(layer, data, {
    x: layer.clientWidth / 2,
    y: layer.clientHeight / 2,
    onClose: () => { wheel = null; easy.hide(); },
  });
  window.__wheel = wheel; // for automated tests
  easy.ready();
});
