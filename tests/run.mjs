/**
 * Runs every check against a local copy of the site.
 *
 *   npm test
 *
 * These lived outside the repo for a long time and were lost twice when the
 * machine they were written on went away, which each time meant re-deriving
 * what the site is supposed to do. They are in version control now.
 *
 * Needs a browser; like the icon and OG builders, the npm script fetches
 * Playwright on demand rather than making it a dependency of the site.
 * Set CHROMIUM_PATH if you already have a binary.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4173);
const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/vnd.microsoft.icon', '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml', '.txt': 'text/plain',
};

const server = createServer(async (req, res) => {
  // normalize() first: without it "/../secrets" escapes ROOT.
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, rel === '/' ? 'index.html' : rel);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((r) => server.listen(PORT, r));
console.log(`serving ${ROOT} on :${PORT}`);

const SUITES = ['sitecheck', 'viewcheck', 'seocheck', 'assetcheck'];
let failed = 0;
for (const s of SUITES) {
  console.log(`\n${'─'.repeat(64)}\n  ${s}\n${'─'.repeat(64)}`);
  const code = await new Promise((r) => {
    spawn(process.execPath, [join(ROOT, 'tests', `${s}.mjs`)], {
      stdio: 'inherit',
      env: { ...process.env, BASE_URL: `http://localhost:${PORT}` },
    }).on('close', r);
  });
  if (code !== 0) failed++;
}
server.close();
console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites passed');
process.exit(failed ? 1 : 0);
