// Serves the built client (client/dist) with an index.html fallback for
// client-side routes. Hashed /assets/* files are cached for a year;
// index.html never is, so a deploy is picked up on the next load.
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Hono } from 'hono';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function staticFiles(dir: string): Hono {
  const root = resolve(dir);
  const app = new Hono();

  const file = async (path: string): Promise<Buffer | null> => {
    const full = resolve(join(root, path));
    if (full !== root && !full.startsWith(root + sep)) return null;
    try {
      if (!(await stat(full)).isFile()) return null;
      return await readFile(full);
    } catch {
      return null;
    }
  };

  app.get('*', async (c) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    if (path.startsWith('/auth/')) return c.notFound();
    const body = path !== '/' ? await file(path) : null;
    if (body) {
      c.header('content-type', types[extname(path)] ?? 'application/octet-stream');
      c.header('cache-control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      return c.body(new Uint8Array(body));
    }
    const index = await file('index.html');
    if (!index) return c.text('client not built — run `pnpm build`', 404);
    c.header('cache-control', 'no-cache');
    return c.html(index.toString('utf8'));
  });
  return app;
}
