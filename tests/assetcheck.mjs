/** Icons, the manifest, and the hero's "also built by us" panel. */
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL || BASE;
let bad = 0;
const ok = m => console.log('  ✓ ' + m);
const no = m => { bad++; console.log('  ✗ ' + m); };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

console.log('\n=== icons + manifest ===');
{
  const p = await (await b.newContext()).newPage();
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  const links = await p.evaluate(() => [...document.querySelectorAll('link[rel*="icon"],link[rel=manifest]')]
    .map(l => l.getAttribute('href')));
  links.length >= 4 ? ok('icon + manifest links declared: ' + links.join(', ')) : no('only ' + links.length);
  for (const f of [...links, '/og.png']) {
    const r = await p.evaluate(src => new Promise(res => {
      if (/webmanifest$/.test(src)) return fetch(src).then(x => res({ ok: x.ok, w: 'json' })).catch(() => res({ ok: false }));
      const i = new Image(); i.onload = () => res({ ok: true, w: i.naturalWidth + '×' + i.naturalHeight });
      i.onerror = () => res({ ok: false }); i.src = src;
    }), f);
    r.ok ? ok(`${f} decodes (${r.w})`) : no(`${f} failed to load`);
  }
  const r = await p.request.get(BASE + '/favicon.ico');
  r.status() === 200 ? ok('bare /favicon.ico → 200') : no('bare /favicon.ico → ' + r.status());
}

console.log('\n=== "also built by us" panel ===');
/* ss-insights.js bails on a HeadlessChrome user-agent, which is correct and is
   what the "headless automation sends nothing" rule is for. The iPhone profile
   brings a Safari UA of its own; a bare viewport context does not, so the
   desktop run needs one or the tracker ignores the page entirely. */
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
for (const [vp, label] of [
  [devices['iPhone 13'], 'phone'],
  [{ viewport: { width: 1280, height: 900 }, userAgent: DESKTOP_UA }, 'desktop'],
]) {
  const ctx = await b.newContext({ ...vp });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true }));
  await ctx.addInitScript(() => {
    window.__sent = [];
    const read = d => { try { return JSON.parse(typeof d === 'string' ? d : '{}'); } catch (_) { return null; } };
    const sb = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (u, blob) {
      if (blob && blob.text) blob.text().then(t => { const j = read(t); if (j) window.__sent.push(j); });
      return sb ? sb(u, blob) : true;
    };
    const of = window.fetch;
    window.fetch = function (u, o) {
      if (String(u).includes('/api/') && o && o.body) { const j = read(o.body); if (j) window.__sent.push(j); }
      return of.apply(this, arguments);
    };
  });
  const p = await ctx.newPage();
  await p.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await p.route('**peer-2-peer.vercel.app/**', r => r.fulfill({ status: 200, body: 'stub' }));
  await p.route('**shuttle.website/**', r => r.fulfill({ status: 200, body: 'stub' }));
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await p.waitForSelector('.card');
  const items = p.locator('.hpromo-item');
  (await items.count()) === 2 ? ok(`${label}: both links present`) : no(label + ': ' + await items.count() + ' links');
  for (let i = 0; i < 2; i++) {
    const a = items.nth(i);
    const box = await a.boundingBox();
    const vis = await a.evaluate(el => {
      const r = el.getBoundingClientRect(), q = el.closest('.hpromo-list').getBoundingClientRect();
      return r.left >= q.left - 1 && r.right <= q.right + 1;
    });
    box.height >= 32 && vis && (await a.getAttribute('rel')).includes('noopener')
      ? ok(`${label}: link ${i + 1} is ${Math.round(box.height)}px, fully visible, rel=noopener`)
      : no(`${label}: link ${i + 1} fails tap/visibility/rel`);
  }
  await p.evaluate(() => { window.__sent.length = 0; });
  const popupP = ctx.waitForEvent('page').catch(() => null);
  await items.nth(0).click();
  const popup = await popupP; if (popup) await popup.close().catch(() => {});
  await p.waitForFunction(() => window.__sent.some(e => e && e.element === 'partner_link'), null, { timeout: 5000 }).catch(() => {});
  const hits = (await p.evaluate(() => window.__sent)).filter(e => e && e.element === 'partner_link');
  hits.length === 1 ? ok(`${label}: one partner_link event ("${hits[0].element_label}")`) : no(`${label}: ${hits.length} partner_link events`);
  await ctx.close();
}
await b.close();
console.log(bad ? `\n✗ ${bad} problem(s)` : '\n✓ asset checks passed');
process.exit(bad ? 1 : 0);
