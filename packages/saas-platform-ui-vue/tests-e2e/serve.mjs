// Minimal HTTP server for Playwright E2E. Serves the package root
// so that `tests-e2e/fixtures/index.html` can access `dist/index.js`
// via a relative `..` path (CORS rejects file:// → file://).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const PORT = Number(process.env.PORT ?? 5174);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.cjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/') pathname = '/tests-e2e/fixtures/index.html';
    const fullPath = normalize(join(ROOT, pathname));
    if (!fullPath.startsWith(ROOT)) {
        res.statusCode = 403;
        return res.end('Forbidden');
    }
    try {
        const data = await readFile(fullPath);
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME[extname(fullPath)] ?? 'application/octet-stream');
        res.end(data);
    } catch {
        res.statusCode = 404;
        res.end(`Not found: ${pathname}`);
    }
});

server.listen(PORT, () => {
    console.log(`E2E fixture server on http://localhost:${PORT}`);
});
