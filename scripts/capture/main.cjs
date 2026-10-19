// Offscreen page capture with Electron (no visible window needed).
// Options come from the CAPTURE env var (JSON) to keep argv clean:
//   { url, out, width, height, js, wait, dark, frames: { count, every, dir } }
// With `frames`, saves a PNG sequence (for video); otherwise one screenshot.
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const o = JSON.parse(process.env.CAPTURE || '{}');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    nativeTheme.themeSource = o.dark ? 'dark' : 'light';
    const win = new BrowserWindow({
      width: o.width || 1280, height: o.height || 800, show: false, useContentSize: true, frame: false,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    win.webContents.setFrameRate(60);
    await win.loadURL(o.url);
    await sleep(300);
    if (o.js) await win.webContents.executeJavaScript(o.js);
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
        await fs.writeFile(path.join(o.frames.dir, `f${String(i).padStart(5, '0')}.png`), img.toPNG());
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
