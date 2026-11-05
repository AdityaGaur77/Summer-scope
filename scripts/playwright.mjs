// Resolving Playwright, wherever it happens to live.
//
// The build and test scripts are ES modules, and ESM resolution only walks up
// from the importing file looking for node_modules. That finds a local
// `npm install`, and nothing else — not NODE_PATH, not a global install, not
// the preinstalled copy some CI images ship. On a machine where Playwright is
// present but not in ./node_modules, `import 'playwright'` fails with
// ERR_MODULE_NOT_FOUND while `require('playwright')` works fine.
//
// createRequire gives these scripts CommonJS resolution, which does check
// those other places. So: try the ESM import first, because that is the right
// answer when the dependency is installed normally, and fall back to require.
//
// CHROMIUM_PATH overrides the browser binary. A Playwright that was not the
// one that downloaded the browsers will not find them on its own.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

let pw;
try {
  pw = await import('playwright');
} catch (err) {
  if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
  try {
    pw = createRequire(import.meta.url)('playwright');
  } catch (_) {
    throw new Error(
      'Playwright is not installed. Run `npm install playwright`, or set\n' +
      'CHROMIUM_PATH and install Playwright somewhere this Node can resolve it.\n' +
      'Original ESM resolution error: ' + err.message
    );
  }
}

export const chromium = pw.chromium;
export const devices = pw.devices;

/** The browser binary, preferring an explicit path and then a known install. */
export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium';
  return undefined;   // let Playwright use its own download
}

/** launch() with the binary and the flags a container needs. */
export function launch(opts = {}) {
  const executablePath = chromiumPath();
  return chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', ...(opts.args || [])],
    ...opts,
  });
}
