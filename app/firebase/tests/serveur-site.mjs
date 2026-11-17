// Petit serveur du site construit, façon Cloudflare Pages : renvoie index.html pour les liens profonds
// et applique les en-têtes de sécurité de _headers (CSP comprise), en autorisant en plus les émulateurs.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
const [dossier, port] = [process.argv[2], Number(process.argv[3] ?? 8091)];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.css': 'text/css' };
const entetes = {};
if (existsSync(join(dossier, '_headers'))) {
  let bloc = false;
  for (const l of readFileSync(join(dossier, '_headers'), 'utf8').split('\n')) {
    if (l.startsWith('/*')) { bloc = true; continue; }
    if (l.startsWith('/')) { bloc = false; continue; }
    const m = l.match(/^\s{2}([\w-]+):\s*(.+)$/);
    if (bloc && m) entetes[m[1]] = m[2];
  }
}
delete entetes['Strict-Transport-Security'];
const EMU = 'http://127.0.0.1:* ws://127.0.0.1:*';
if (entetes['Content-Security-Policy']) {
  entetes['Content-Security-Policy'] = entetes['Content-Security-Policy'].replace('; upgrade-insecure-requests', '')
    .replace("connect-src 'self'", "connect-src 'self' " + EMU).replace("img-src 'self'", "img-src 'self' " + EMU).replace("media-src 'self'", "media-src 'self' " + EMU);
}
createServer((req, res) => {
  let f = join(dossier, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(f) || statSync(f).isDirectory()) f = existsSync(join(f, 'index.html')) ? join(f, 'index.html') : join(dossier, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] ?? 'application/octet-stream', ...entetes });
  createReadStream(f).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('site sur http://localhost:' + port + (entetes['Content-Security-Policy'] ? ' (avec CSP)' : '')));
