import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** "C:\a\Report.docx" + "pdf" -> "C:\a\Report.pdf", or "Report (1).pdf" if taken. */
export function uniquePath(dir, base, ext) {
  const name = (n) => path.join(dir, `${base}${n ? ` (${n})` : ''}${ext ? `.${ext}` : ''}`);
  let n = 0;
  while (existsSync(name(n))) n++;
  return name(n);
}

export async function makeTempDir(prefix = 'easy-convert-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeDir(dir) {
  try { await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ }
}

export function baseName(file) {
  return path.basename(file, path.extname(file));
}

/**
 * Run a process, collecting stderr. Rejects with the last stderr lines on failure.
 * `onStderr` sees each chunk (ffmpeg progress).
 */
export function run(cmd, args, { timeoutMs = 10 * 60_000, onStderr, onStdout, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(cmd)} timed out`)); }, timeoutMs);
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (d) => { stdout += d; onStdout?.(d.toString()); });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr = (stderr + s).slice(-8000);
      onStderr?.(s);
    });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new Error('Cancelled'));
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(cleanError(stderr) || `${path.basename(cmd)} exited with code ${code}`));
    });
  });
}

function cleanError(stderr) {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // PowerShell errors: keep the message, drop the position/category noise.
  const ps = lines.find((l) => /^(Exception|.*: )/.test(l) && !/^(At |\+|CategoryInfo|FullyQualifiedErrorId)/.test(l));
  return (ps || lines.slice(-3).join(' ')).replace(/^.*?Exception calling "[^"]+" with "\d+" argument\(s\): /, '').slice(0, 400);
}

export const readBytes = async (file) => new Uint8Array(await fs.readFile(file));
