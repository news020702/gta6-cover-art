// A tiny static server for app/ (Node 22, standard library only), so the cover
// maker can be tried locally without a build step:
//   node serve.ts
// then open http://localhost:8080. A development convenience only — the app
// itself is plain static files and needs no server to run.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./app', import.meta.url)));
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const requested = portIndex === -1 ? 8080 : Number(args[portIndex + 1]);
const port = Number.isInteger(requested) && requested > 0 && requested < 65536 ? requested : 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const cleaned = normalize(decodeURIComponent(url.pathname))
    .replace(/^(\.\.[/\\])+/, '')
    .replace(/^[/\\]/, '');
  const path = join(root, cleaned === '' ? 'index.html' : cleaned);
  if (path !== root && !path.startsWith(root + sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  let st;
  try {
    st = statSync(path);
  } catch {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  if (!st.isFile()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(path)] ?? 'application/octet-stream',
    'content-length': st.size,
  });
  createReadStream(path).pipe(res);
});

server.listen(port, () => {
  console.log(`Sunset Cover Studio at http://localhost:${port}`);
});
