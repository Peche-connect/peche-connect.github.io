// Petit serveur du site construit, façon hébergeur : renvoie index.html pour les liens profonds.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
const [dossier, port] = [process.argv[2], Number(process.argv[3] ?? 8091)];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.css': 'text/css' };
createServer((req, res) => {
  let f = join(dossier, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(f) || statSync(f).isDirectory()) f = existsSync(join(f, 'index.html')) ? join(f, 'index.html') : join(dossier, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] ?? 'application/octet-stream' });
  createReadStream(f).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('site sur http://localhost:' + port));
