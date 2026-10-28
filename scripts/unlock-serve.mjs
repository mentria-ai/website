import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, extname, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf'
};

export function serve(port) {
  let root = null;
  const server = http.createServer((req, res) => {
    if (!root) { res.writeHead(503); res.end('no root'); return; }
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch (_) { res.writeHead(400); res.end(); return; }
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      if (!statSync(file).isFile()) throw new Error('not a file');
    } catch (_) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  });
  const ready = new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => ok());
  });
  return {
    ready,
    root: () => root,
    setRoot(dir) {
      const next = resolve(dir);
      if (!statSync(next).isDirectory()) throw new Error('not a directory: ' + dir);
      root = next;
    },
    close() {
      return new Promise((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      });
    }
  };
}
