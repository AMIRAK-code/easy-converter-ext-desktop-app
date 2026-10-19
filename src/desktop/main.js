// Easy Convert — Windows app (Electron main process).
//
// Lives in the tray. Explorer's "Easy Convert" menu entry runs
//   EasyConvert.exe --wheel "<file>"
// which hands the file to the running instance; the wheel pops up at the cursor.

import { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, utilityProcess, Notification, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatOf, splitName } from '../shared/formats.js';
import { TOOLS, suffixed } from '../shared/tools.js';
import { installContextMenu, uninstallContextMenu, contextMenuInstalled } from './registry.js';
import { enableWordPdf, detectOffice } from './convert/office.js';
import { uniquePath } from './convert/util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const UI = path.join(here, '..', '..', 'build', 'desktop');
const PRELOAD = path.join(here, 'preload.cjs');
const ICON = path.join(UI, 'icons', 'icon.ico');
const WHEEL_SIZE = 460;
const APP_ID = 'com.amirak.easyconvert';

app.setAppUserModelId(APP_ID);
app.setName('Easy Convert');

// ---------- command line ----------

function parseArgs(argv) {
  const i = argv.indexOf('--wheel');
  return {
    files: i >= 0 ? argv.slice(i + 1).filter((a) => !a.startsWith('--') && existsSync(a)).map((a) => path.resolve(a)) : [],
    register: argv.includes('--register'),
    unregister: argv.includes('--unregister'),
    background: argv.includes('--background'),
  };
}

const args = parseArgs(process.argv);

if (args.register || args.unregister) {
  // One-shot: install/remove the Explorer menu, then exit.
  app.whenReady().then(async () => {
    try {
      if (args.register) await registerMenu();
      else await uninstallContextMenu();
      console.log(args.register ? 'Context menu installed.' : 'Context menu removed.');
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
    }
    app.quit();
  });
} else if (!app.requestSingleInstanceLock({ argv: process.argv })) {
  // Another instance owns the tray: it receives our argv via 'second-instance'.
  app.quit();
} else {
  main();
}

// ---------- settings ----------

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { useOffice: true, outDir: null, startAtLogin: false, revealAfter: false };

async function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(await fs.readFile(SETTINGS_FILE(), 'utf8')) }; } catch { /* first run */ }
}
async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  await fs.mkdir(path.dirname(SETTINGS_FILE()), { recursive: true });
  await fs.writeFile(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
  worker?.postMessage({ type: 'settings', settings });
}

function menuCommand() {
  return app.isPackaged
    ? `"${process.execPath}" --wheel "%1"`
    : `"${process.execPath}" "${app.getAppPath()}" --wheel "%1"`;
}

async function registerMenu() {
  await installContextMenu({ command: menuCommand(), icon: app.isPackaged ? process.execPath : ICON });
}

// ---------- worker ----------

let worker = null;
let seq = 0;
const calls = new Map();

function startWorker() {
  worker = utilityProcess.fork(path.join(here, 'worker.js'), [], { serviceName: 'Easy Convert engine', stdio: 'inherit' });
  worker.postMessage({ type: 'settings', settings });
  worker.on('message', onWorkerMessage);
  worker.on('exit', () => {
    worker = null;
    for (const c of calls.values()) c.reject(new Error('The conversion engine stopped unexpectedly'));
    calls.clear();
  });
}

function call(type, payload = {}, onProgress) {
  if (!worker) startWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    calls.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, type, ...payload });
  });
}

async function onWorkerMessage(msg) {
  if (msg.type === 'host') {
    try {
      const value = await hostOps[msg.op](msg.args);
      worker?.postMessage({ type: 'hostResult', hid: msg.hid, value });
    } catch (e) {
      worker?.postMessage({ type: 'hostResult', hid: msg.hid, error: e.message });
    }
    return;
  }
  const c = calls.get(msg.id);
  if (!c) return;
  if (msg.type === 'progress') c.onProgress?.({ fraction: msg.fraction, label: msg.label });
  else {
    calls.delete(msg.id);
    if (msg.type === 'result') c.resolve(msg.value); else c.reject(new Error(msg.message));
  }
}

// Things only the main process can do, requested by the worker.
const hostOps = {
  /** HTML file -> PDF with Chromium's print engine (scripts disabled). */
  async printToPDF({ input, output }) {
    const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
    try {
      await win.loadFile(input);
      const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, generateDocumentOutline: true });
      await fs.writeFile(output, pdf);
    } finally {
      win.destroy();
    }
  },
};

// ---------- wheel window ----------

let wheelWin = null;
let wheelReady = null;
let wheelBusy = false;

function createWheelWindow() {
  wheelWin = new BrowserWindow({
    width: WHEEL_SIZE, height: WHEEL_SIZE, show: false, frame: false, transparent: true, resizable: false,
    movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000', title: 'Easy Convert',
    webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  wheelWin.setAlwaysOnTop(true, 'pop-up-menu');
  wheelReady = new Promise((r) => wheelWin.webContents.once('did-finish-load', r));
  wheelWin.loadFile(path.join(UI, 'wheel.html'));
  wheelWin.on('blur', () => { if (!wheelBusy) hideWheel(); });
  wheelWin.on('closed', () => { wheelWin = null; });
}

function hideWheel() {
  if (wheelWin && wheelWin.isVisible()) {
    wheelWin.webContents.send('wheel:reset');
    wheelWin.hide();
  }
  wheelBusy = false;
}

async function openWheel(files, at) {
  if (!files.length) return;
  if (!wheelWin) createWheelWindow();
  await wheelReady;
  const options = await call('options', { files }).catch((e) => ({ targets: [], tools: [], error: e.message }));
  const pt = at ?? screen.getCursorScreenPoint();
  const { workArea: wa } = screen.getDisplayNearestPoint(pt);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  wheelWin.setBounds({
    x: Math.round(clamp(pt.x - WHEEL_SIZE / 2, wa.x, wa.x + wa.width - WHEEL_SIZE)),
    y: Math.round(clamp(pt.y - WHEEL_SIZE / 2, wa.y, wa.y + wa.height - WHEEL_SIZE)),
    width: WHEEL_SIZE, height: WHEEL_SIZE,
  });
  wheelBusy = false;
  wheelWin.webContents.send('wheel:open', {
    files: files.map((f) => ({ path: f, name: path.basename(f), fmt: formatOf(f) })),
    ...options,
  });
}

// Explorer launches one process per selected file; gather them into one wheel.
let pending = [];
let pendingTimer = null;
function queueFiles(files) {
  pending.push(...files);
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    const batch = [...new Set(pending)];
    pending = [];
    openWheel(batch).catch((e) => console.error(e));
  }, 220);
}

// ---------- editor windows ----------

const editors = new Map(); // webContents.id -> { tool, file, resolve, win }

function openEditor(tool, file) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 820, height: 760, minWidth: 560, minHeight: 560, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', title: TOOLS[tool]?.label ?? 'Edit', icon: ICON,
      webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true },
    });
    const id = win.webContents.id;
    editors.set(id, { tool, file, resolve, win });
    win.loadFile(path.join(UI, 'editor.html'));
    win.once('ready-to-show', () => { win.show(); win.focus(); devCapture(win, `editor-${tool}`, 1200); });
    win.on('closed', () => {
      const e = editors.get(id);
      editors.delete(id);
      e?.resolve(null);
    });
  });
}

const CANVAS_FORMATS = new Set(['png', 'jpg', 'webp', 'gif', 'avif', 'bmp']);

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle('wheel:ready', () => {
    if (!wheelWin) return;
    wheelWin.show();
    wheelWin.focus();
    devCapture(wheelWin, 'wheel');
    if (process.env.EASY_TEST_PICK) {
      // Test hook: choose a segment automatically ("png" or "tools:compress").
      const [ring, id] = process.env.EASY_TEST_PICK.includes(':') ? process.env.EASY_TEST_PICK.split(':') : [null, process.env.EASY_TEST_PICK];
      setTimeout(() => wheelWin?.webContents.executeJavaScript(`(() => { const w = window.__wheel;
        if (${JSON.stringify(ring)} === 'tools') w.switchRing();
        setTimeout(() => w.activate(w.items.findIndex((i) => i.id === ${JSON.stringify(id)})), 200); })()`), 400);
      setTimeout(() => devCapture(wheelWin, 'wheel-after', 0), 3500);
    }
  });
  ipcMain.handle('wheel:hide', () => hideWheel());
  ipcMain.handle('wheel:busy', (_e, busy) => { wheelBusy = !!busy; });

  ipcMain.handle('job:convert', (e, { files, target }) =>
    call('convert', { files, target, outDir: settings.outDir }, (p) => e.sender.send('job:progress', p)).then(afterJob));

  ipcMain.handle('job:tool', async (e, { files, tool }) => {
    if (TOOLS[tool]?.editor || tool === 'metadata') {
      hideWheel();
      const saved = await openEditor(tool, files[0]);
      if (saved) notifySaved(saved);
      return saved ? [saved] : null;
    }
    return call('tool', { tool, files, outDir: settings.outDir }, (p) => e.sender.send('job:progress', p)).then(afterJob);
  });

  ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));
  ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));

  ipcMain.handle('editor:init', async (e) => {
    const ed = editors.get(e.sender.id);
    if (!ed) return null;
    const fmt = formatOf(ed.file);
    const isImage = ['png', 'jpg', 'webp', 'gif', 'avif', 'bmp', 'tiff', 'heic', 'ico', 'svg'].includes(fmt);
    const bytes = !isImage ? null
      : CANVAS_FORMATS.has(fmt) ? new Uint8Array(await fs.readFile(ed.file)) : await call('toPng', { file: ed.file });
    const meta = ed.tool === 'metadata' ? await call('metadata', { file: ed.file }) : null;
    return { tool: ed.tool, name: path.basename(ed.file), fmt, bytes, meta };
  });

  ipcMain.handle('editor:save', async (e, { bytes, ext, suffix }) => {
    const ed = editors.get(e.sender.id);
    if (!ed) throw new Error('Editor closed');
    const { base } = splitName(path.basename(ed.file));
    const out = uniquePath(settings.outDir ?? path.dirname(ed.file), suffixed(base, suffix), ext);
    await fs.writeFile(out, Buffer.from(bytes));
    editors.delete(e.sender.id);
    ed.resolve(out);
    ed.win.close();
    return out;
  });

  ipcMain.handle('editor:strip', async (e) => {
    const ed = editors.get(e.sender.id);
    if (!ed) throw new Error('Editor closed');
    const [out] = await call('tool', { tool: 'metadata', files: [ed.file], outDir: settings.outDir });
    editors.delete(e.sender.id);
    ed.resolve(out);
    ed.win.close();
    return out;
  });
  ipcMain.handle('editor:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.handle('editor:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());

  ipcMain.handle('home:wheel', (_e, files) => openWheel(files.filter(Boolean)));
  ipcMain.handle('home:options', async (_e, files) => ({
    files: files.map((f) => ({ path: f, name: path.basename(f), fmt: formatOf(f) })),
    ...(await call('options', { files })),
  }));
  ipcMain.handle('home:pick', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('settings:get', async () => ({
    ...settings,
    menuInstalled: !!(await contextMenuInstalled()),
    office: await detectOffice(),
    version: app.getVersion(),
  }));
  ipcMain.handle('settings:set', async (_e, patch) => {
    if ('menuInstalled' in patch) {
      if (patch.menuInstalled) await registerMenu(); else await uninstallContextMenu();
      delete patch.menuInstalled;
    }
    if ('wordPdf' in patch) {
      await enableWordPdf(patch.wordPdf);
      delete patch.wordPdf;
      worker?.postMessage({ type: 'settings', settings }); // rebuild routes
    }
    if ('startAtLogin' in patch) setLoginItem(patch.startAtLogin);
    if ('chooseOutDir' in patch) {
      delete patch.chooseOutDir;
      const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      if (!r.canceled) patch.outDir = r.filePaths[0];
    }
    await saveSettings(patch);
    return true;
  });
}

function afterJob(paths) {
  if (settings.revealAfter && paths?.[0]) shell.showItemInFolder(paths[0]);
  return paths;
}

function notifySaved(file) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: 'Saved', body: path.basename(file), icon: ICON, silent: true });
  n.on('click', () => shell.showItemInFolder(file));
  n.show();
}

function setLoginItem(on) {
  app.setLoginItemSettings(app.isPackaged
    ? { openAtLogin: on, args: ['--background'] }
    : { openAtLogin: on, path: process.execPath, args: [app.getAppPath(), '--background'] });
}

// ---------- home window & tray ----------

let homeWin = null;
let tray = null;

function showHome() {
  if (homeWin) { homeWin.show(); homeWin.focus(); return; }
  homeWin = new BrowserWindow({
    width: 880, height: 620, minWidth: 640, minHeight: 520, show: false, title: 'Easy Convert', icon: ICON,
    backgroundColor: '#fff5ef', autoHideMenuBar: true,
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#8a5a48', height: 40 },
    webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true },
  });
  homeWin.loadFile(path.join(UI, 'home.html'));
  homeWin.once('ready-to-show', () => { homeWin.show(); devCapture(homeWin, 'home', 900); });
  homeWin.on('closed', () => { homeWin = null; });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Easy Convert — right-click any file in Explorer');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Easy Convert', click: showHome },
    { label: 'Convert files…', click: async () => {
      const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
      if (!r.canceled) openWheel(r.filePaths);
    } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.exit(0); } },
  ]));
  tray.on('click', showHome);
}

// Dev/test hook: EASY_CAPTURE_DIR saves a PNG of windows as they appear.
function devCapture(win, name, delay = 700) {
  const dir = process.env.EASY_CAPTURE_DIR;
  if (!dir || !win) return;
  setTimeout(async () => {
    try {
      if (process.env.EASY_CAPTURE_JS) console.log('capture-js', JSON.stringify(await win.webContents.executeJavaScript(process.env.EASY_CAPTURE_JS)));
      const img = await win.webContents.capturePage();
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${name}-${Date.now()}.png`), img.toPNG());
    } catch (e) { console.error('capture failed', e.message); }
  }, delay);
}

// ---------- startup ----------

function main() {
  app.on('second-instance', (_e, argv, _cwd, data) => {
    const a = parseArgs(data?.argv ?? argv);
    if (a.files.length) queueFiles(a.files);
    else showHome();
  });
  app.on('window-all-closed', () => { /* keep running in the tray */ });

  app.whenReady().then(async () => {
    await loadSettings();
    registerIpc();
    startWorker();
    createTray();
    createWheelWindow();
    // Installed copy, first run: add the Explorer menu (the uninstaller removes it).
    if (app.isPackaged && !settings.menuSetUp && !process.env.EASY_SKIP_MENU) {
      try { await registerMenu(); } catch (e) { console.error('menu setup failed', e.message); }
      await saveSettings({ menuSetUp: true });
    }
    if (args.files.length) queueFiles(args.files);
    else if (!args.background) showHome();
    if (process.env.EASY_AUTOQUIT) setTimeout(() => app.exit(0), +process.env.EASY_AUTOQUIT);
  });
}
