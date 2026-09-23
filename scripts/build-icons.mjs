/**
 * Renders the icon set from favicon.svg.
 *
 * The PNGs and the .ico are generated, not hand-made, so there is exactly one
 * place to change the mark: favicon.svg, which is itself the icon browsers get.
 * Re-run after editing it.
 *
 *   npm run build-icons
 *
 * Playwright is deliberately NOT in package.json: the mark changes about once
 * a year and the generated files are committed, so nobody installing this repo
 * to run the site should have to pull a browser. The npm script fetches it on
 * demand with npx; set CHROMIUM_PATH if you already have a binary.
 *
 * Chromium does the rasterising, and the .ico is assembled here: an ICO is just
 * a small directory followed by — in this case — PNG payloads, a form every
 * browser that still asks for /favicon.ico understands.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVG = readFileSync(join(ROOT, 'favicon.svg'), 'utf8');

/* favicon.svg is served to browsers as an image, so it has to be well-formed
   XML — not merely something Chromium can make sense of when it is parsing
   HTML. The trap that caught this file once: "--" is illegal inside an XML
   comment, so writing a CSS custom property name in one makes the whole file
   unrenderable as an <img>, while every PNG built from it still comes out
   fine. Fail the build rather than ship that again. */
for (const [re, why] of [
  [/<!--[\s\S]*?--[\s\S]*?-->/, 'a comment contains "--", which is illegal in XML'],
  [/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i, 'a bare "&" that is not an entity'],
]) {
  const m = SVG.replace(/<!--[\s\S]*?-->/g, (c) => (re.source.startsWith('<!--') ? c : ''));
  if (re.test(m)) {
    console.error(`favicon.svg is not valid XML: ${why}`);
    process.exit(1);
  }
}

/* Rounded for browser tabs and the manifest's "any" slot; square and
   full-bleed where the platform applies its own mask (iOS home screen,
   Android maskable), which would otherwise clip the corners twice. */
const SQUARE = SVG.replace(/ rx="[\d.]+"/, '');

const OUT = [
  { file: 'apple-touch-icon.png', size: 180, svg: SQUARE },
  { file: 'icon-192.png',         size: 192, svg: SVG },
  { file: 'icon-512.png',         size: 512, svg: SVG },
  { file: 'icon-maskable.png',    size: 512, svg: SQUARE },
];
const ICO_SIZES = [16, 32, 48];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
});

async function raster(svg, size) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`,
    { waitUntil: 'load' },
  );
  await page.locator('svg').evaluate((el, s) => {
    el.setAttribute('width', s);
    el.setAttribute('height', s);
  }, size);
  const buf = await page.screenshot({ omitBackground: true });
  await page.close();
  return buf;
}

/** ICONDIR + one ICONDIRENTRY per image, then the PNG payloads. */
function buildIco(images) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);              // reserved
  dir.writeUInt16LE(1, 2);              // 1 = icon
  dir.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);  // 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);                 // palette entries
    e.writeUInt8(0, 3);                 // reserved
    e.writeUInt16LE(1, 4);              // colour planes
    e.writeUInt16LE(32, 6);             // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([dir, ...entries, ...images.map((i) => i.data)]);
}

for (const { file, size, svg } of OUT) {
  writeFileSync(join(ROOT, file), await raster(svg, size));
  console.log(`  ${file} (${size}px)`);
}

const icoImages = [];
for (const size of ICO_SIZES) icoImages.push({ size, data: await raster(SVG, size) });
writeFileSync(join(ROOT, 'favicon.ico'), buildIco(icoImages));
console.log(`  favicon.ico (${ICO_SIZES.join(', ')}px)`);

await browser.close();
