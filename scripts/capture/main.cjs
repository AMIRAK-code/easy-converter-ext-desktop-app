// Offscreen page capture with Electron (no visible window needed).
// Options come from the CAPTURE env var (JSON) to keep argv clean:
//   { url, out, width, height, js, wait, dark, frames: { count, every, dir } }
// With `frames`, saves a PNG sequence (for video); otherwise one screenshot.
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const o = JSON.parse(process.env.CAPTURE || '{}');
app.disableHardwareAcceleration();
// 1 CSS px = 1 captured px, regardless of Windows display scaling.
// (`dsf` + `zoom` render a page larger than the screen: e.g. 540px window, dsf 2, zoom .5
// lays out 1080 CSS px and captures 1080 device px.)
app.commandLine.appendSwitch('force-device-scale-factor', String(o.dsf || 1));

app.whenReady().then(async () => {
  try {
    nativeTheme.themeSource = o.dark ? 'dark' : 'light';
    const win = new BrowserWindow({
      width: o.width || 1280, height: o.height || 800, show: false, useContentSize: true, frame: false, enableLargerThanScreen: true,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    win.webContents.setFrameRate(60);
    if (o.zoom) win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(o.zoom));
    await win.loadURL(o.url);
    if (o.zoom) win.webContents.setZoomFactor(o.zoom);
    await sleep(300);
    if (o.js) await win.webContents.executeJavaScript(o.js);
    if (o.awaitReady) await win.webContents.executeJavaScript('window.ready');
    if (o.eval) {
      // Print the (awaited) result of an expression and quit — used by test harnesses.
      console.log(await win.webContents.executeJavaScript(o.eval));
      app.quit();
      return;
    }
    await sleep(o.wait ?? 600);
    if (o.frames) {
      await fs.mkdir(o.frames.dir, { recursive: true });
      for (let i = 0; i < o.frames.count; i++) {
        const t0 = Date.now();
        if (o.frames.step) await win.webContents.executeJavaScript(`(${o.frames.step})(${i})`);
        const img = await win.webContents.capturePage();
        const jpg = o.frames.format === 'jpg';
        await fs.writeFile(path.join(o.frames.dir, `f${String(i).padStart(5, '0')}.${jpg ? 'jpg' : 'png'}`), jpg ? img.toJPEG(94) : img.toPNG());
        await sleep(Math.max(0, (o.frames.every ?? 33) - (Date.now() - t0)));
      }
      console.log('frames', o.frames.count);
    } else {
      const img = await win.webContents.capturePage();
      await fs.writeFile(o.out, img.toPNG());
      console.log('saved', o.out, JSON.stringify(img.getSize()));
    }
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
  app.quit();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
