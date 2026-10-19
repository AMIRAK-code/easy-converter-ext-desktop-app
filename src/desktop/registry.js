// Explorer right-click menu ("Easy Convert") for every supported file type.
// Per-user keys under HKCU\Software\Classes, so no admin rights are needed.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from './convert/util.js';
import { FORMATS, ALIASES } from '../shared/formats.js';

const VERB = 'EasyConvert';

export const EXTENSIONS = [
  ...Object.entries(FORMATS).filter(([, f]) => !f.outputOnly).map(([ext]) => ext),
  ...Object.keys(ALIASES),
];

const keyFor = (ext) => `HKCU\\Software\\Classes\\SystemFileAssociations\\.${ext}\\shell\\${VERB}`;

const reg = (...args) => run('reg.exe', args, { timeoutMs: 15_000 });

const regString = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Applies a generated .reg file in one `reg import` (≈190 values). */
async function importReg(lines) {
  const file = path.join(os.tmpdir(), `easy-convert-${process.pid}-${Date.now()}.reg`);
  const text = ['Windows Registry Editor Version 5.00', '', ...lines, ''].join('\r\n');
  await fs.writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
  try { await reg('import', file); } finally { await fs.rm(file, { force: true }); }
}

/** @param {string} command e.g. `"C:\…\Easy Convert.exe" --wheel "%1"` */
export async function installContextMenu({ command, icon, label = 'Easy Convert' }) {
  const lines = [];
  for (const ext of EXTENSIONS) {
    const key = keyFor(ext).replace(/^HKCU/, 'HKEY_CURRENT_USER');
    lines.push(`[${key}]`, `@=${regString(label)}`, `"Icon"=${regString(icon)}`,
      // Explorer starts one process per selected file (up to 15); the app gathers them.
      '"MultiSelectModel"="Document"', '', `[${key}\\command]`, `@=${regString(command)}`, '');
  }
  await importReg(lines);
}

export async function uninstallContextMenu() {
  await importReg(EXTENSIONS.map((ext) => `[-${keyFor(ext).replace(/^HKCU/, 'HKEY_CURRENT_USER')}]`));
}

export async function contextMenuInstalled() {
  try {
    const { stdout } = await reg('query', `${keyFor('pdf')}\\command`, '/ve');
    return /--wheel/.test(stdout) ? stdout.match(/REG_SZ\s+(.*)/)?.[1]?.trim() ?? true : false;
  } catch {
    return false;
  }
}
