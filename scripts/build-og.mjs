/**
 * Renders og.png, the 1200x630 card that shows when the site is pasted into
 * a message, a post, or a search result preview.
 *
 *   npm run build-og
 *
 * The counts come from data.json, so re-run it after a data change rather
 * than letting the preview claim a number the site no longer shows. Same
 * deal as the icons: Playwright is fetched on demand, not depended on.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { programs, events, meta } = JSON.parse(readFileSync(join(ROOT, 'data.json'), 'utf8'));
const live = programs.filter((p) => p.status !== 'discontinued');
const free = live.filter((p) => p.costB === 'Free').length;
const icon = readFileSync(join(ROOT, 'favicon.svg'), 'utf8').trim();

/* The dark palette's own tokens, copied rather than imported because this
   renders standalone with no stylesheet. Keep in step with styles.css. */
const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,600;1,600&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;background:#152324;color:#D6DADA;
       font-family:'DM Sans',system-ui,sans-serif;display:flex;flex-direction:column;
       justify-content:space-between;padding:68px 72px;overflow:hidden;position:relative}
  /* One soft teal bloom so the card is not a flat rectangle. */
  body::after{content:'';position:absolute;right:-180px;top:-220px;width:720px;height:720px;
       border-radius:50%;background:radial-gradient(circle,rgba(92,194,196,.16),transparent 68%)}
  .top{display:flex;align-items:center;gap:16px;position:relative;z-index:1}
  .top svg{width:52px;height:52px}
  .word{font-family:'Lora',serif;font-size:34px;letter-spacing:-.01em}
  h1{font-family:'Lora',serif;font-size:76px;line-height:1.06;letter-spacing:-.025em;
     max-width:19ch;position:relative;z-index:1}
  h1 em{font-style:italic;color:#5CC2C4}
  .stats{display:flex;gap:64px;position:relative;z-index:1}
  .s b{display:block;font-size:46px;font-weight:700;line-height:1.1}
  .s span{font-size:19px;color:#A3A7A7}
  .foot{display:flex;justify-content:space-between;align-items:flex-end;
        font-size:19px;color:#868989;position:relative;z-index:1}
  .foot .dom{color:#5CC2C4;font-weight:500}
</style></head><body>
  <div class="top">${icon}<span class="word">SummerScope</span></div>
  <h1>Every summer program worth <em>applying to</em></h1>
  <div class="stats">
    <div class="s"><b>${live.length}</b><span>Programs</span></div>
    <div class="s"><b>${free}</b><span>Free or full aid</span></div>
    <div class="s"><b>${events.length}</b><span>Competitions</span></div>
    <div class="s"><b>${meta.cycle}</b><span>Cycle</span></div>
  </div>
  <div class="foot"><span>Deadlines, real costs, direct apply links</span><span class="dom">summerscope.vercel.app</span></div>
</body></html>`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
// Webfonts or nothing: a fallback serif would ship a different card each build.
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
writeFileSync(join(ROOT, 'og.png'), await page.screenshot());
await browser.close();
console.log(`  og.png  1200x630 — ${live.length} programs, ${free} free, ${events.length} events, cycle ${meta.cycle}`);
