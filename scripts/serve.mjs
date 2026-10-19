// Minimal static server for previewing build/ output: node scripts/serve.mjs [dir] [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || 'build');
const port = Number(process.argv[3] || 5317);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.map': 'application/json', '.wasm': 'application/wasm', '.pdf': 'application/pdf' };

http.createServer((req, res) => {
  let p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(dir)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`Serving ${dir} on http://localhost:${port}`));
