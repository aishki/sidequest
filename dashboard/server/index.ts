// sidequest dashboard server: JSON API over src/core, plus the web app (Vite in dev, dist/ in prod).
// Binds to 127.0.0.1 only. Phone access (Tailscale + PIN) comes in a later phase.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../../src/core/db.ts';
import { handleApi } from './api.ts';
import { applyTimezone } from '../../src/core/planning.ts';
import { promoteDueTickets } from '../../src/core/tickets.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const prod = process.argv.includes('--prod');
const port = Number(process.env.DASHBOARD_PORT || 4321);
const host = '127.0.0.1';
const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);

await applyTimezone().catch((e: Error & { code?: string }) => {
  console.error(e.code === 'ECONNREFUSED' ? 'Can\'t reach Postgres. Is it running? Check with: npm run setup' : e.message);
  process.exit(1);
});

// Tickets due by tomorrow move from Inbox to To Do on start, and again each minute so it also happens at midnight.
// Open pages refresh on their own, because each move is logged as an event.
const promote = () => promoteDueTickets().catch(() => undefined);
await promote();
setInterval(promote, 60_000).unref();

const server = http.createServer(async (req, res) => {
  // Refuse other Host names (DNS rebinding) and cross-site writes.
  const origin = req.headers.origin;
  if (!allowedHosts.has(req.headers.host ?? '') || (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, '')))) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (vite) return vite.middlewares(req, res);
  return serveStatic(url.pathname, res);
});

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.json': 'application/json',
};

async function serveStatic(pathname: string, res: http.ServerResponse) {
  let file = normalize(join(dist, decodeURIComponent(pathname)));
  if (!file.startsWith(dist + sep) && file !== dist) { res.writeHead(400).end(); return; }
  try {
    if (!(await stat(file)).isFile()) throw new Error('dir');
  } catch {
    file = join(dist, 'index.html'); // single-page app
  }
  try {
    const body = await readFile(file);
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' }).end('No build found. Run npm run dashboard:build first, or use npm run dashboard for dev mode.');
  }
}

const vite = prod ? undefined : await (await import('vite')).createServer({
  configFile: join(root, 'vite.config.ts'),
  server: { middlewareMode: true, hmr: { server } },
  appType: 'spa',
});

server.on('error', (e: Error & { code?: string }) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Is the dashboard already running?` : e.message);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`sidequest dashboard: http://localhost:${port}${prod ? '' : '  (dev mode)'}`);
});

async function shutdown() {
  server.close();
  await vite?.close();
  await sql.end({ timeout: 2 });
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
