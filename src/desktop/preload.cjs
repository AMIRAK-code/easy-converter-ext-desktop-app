// The only bridge between the sandboxed UI pages and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, cb) => {
  const listener = (_e, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('easy', {
  // wheel
  onOpen: (cb) => on('wheel:open', cb),
  onReset: (cb) => on('wheel:reset', cb),
  ready: () => ipcRenderer.invoke('wheel:ready'),
  hide: () => ipcRenderer.invoke('wheel:hide'),
  busy: (b) => ipcRenderer.invoke('wheel:busy', b),

  // jobs
  convert: (files, target) => ipcRenderer.invoke('job:convert', { files, target }),
  tool: (files, tool) => ipcRenderer.invoke('job:tool', { files, tool }),
  onProgress: (cb) => on('job:progress', cb),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),

  // editor
  editorInit: () => ipcRenderer.invoke('editor:init'),
  editorSave: (bytes, ext, suffix) => ipcRenderer.invoke('editor:save', { bytes, ext, suffix }),
  editorStrip: () => ipcRenderer.invoke('editor:strip'),
  editorClose: () => ipcRenderer.invoke('editor:close'),
  editorMinimize: () => ipcRenderer.invoke('editor:minimize'),

  // home
  pathForFile: (file) => webUtils.getPathForFile(file),
  openWheel: (paths) => ipcRenderer.invoke('home:wheel', paths),
  options: (paths) => ipcRenderer.invoke('home:options', paths),
  pickFiles: () => ipcRenderer.invoke('home:pick'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
});
