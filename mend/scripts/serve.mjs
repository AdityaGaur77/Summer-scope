#!/usr/bin/env node
// Zero-dependency static server for local checks. Serves public/ by default.
//
//   npm run site:serve            -> http://localhost:4173  (whatever is activated)
//   node scripts/serve.mjs versions/v2 4174
//
// Directory requests resolve to index.html so the built tree behaves the way
// Vercel serves it.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, process.argv[2] ?? 'public');
const port = Number(process.argv[3] ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

async function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let candidate = join(dir, clean);
  try {
    if ((await stat(candidate)).isDirectory()) candidate = join(candidate, 'index.html');
    return candidate;
  } catch {
    // Bare path with no extension: try it as a directory index, the way cleanUrls does.
    if (!extname(candidate)) {
      const asIndex = join(candidate, 'index.html');
      try {
        await stat(asIndex);
        return asIndex;
      } catch {
        /* fall through */
      }
    }
    return candidate;
  }
}

createServer(async (req, res) => {
  const file = await resolve(req.url ?? '/');
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'x-robots-tag': 'noindex, nofollow',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404\n');
  }
}).listen(port, () => {
  console.log(`serving ${dir} on http://localhost:${port}`);
});
