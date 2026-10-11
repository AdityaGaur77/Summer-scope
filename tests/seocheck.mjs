import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const BASE = process.env.BASE_URL || BASE;
let bad = 0;
const ok = m => console.log('  ✓ ' + m);
const no = m => { bad++; console.log('  ✗ ' + m); };
const R = '/home/user/Summer-scope';
const data = JSON.parse(readFileSync(R + '/data.json', 'utf8'));
const live = data.programs.filter(p => p.status !== 'discontinued');

console.log('\n=== crawlable without JavaScript ===');
const html = readFileSync(R + '/index.html', 'utf8');
const body = html.slice(html.indexOf('<body>'));
const text = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
text.length > 20000 ? ok(`${text.length} chars of text in the HTML (was 1,462)`) : no('only ' + text.length + ' chars');
const missing = live.filter(p => !text.includes(p.name));
missing.length === 0 ? ok(`all ${live.length} program names appear in the source`) : no(missing.length + ' missing, e.g. ' + missing[0].name);
data.events.every(e => text.includes(e.name)) ? ok('all 20 event names appear') : no('an event name is missing');
!/discontinued/i.test(text) && !text.includes('Google CSSI') ? ok('discontinued programs are left out') : no('a discontinued program is in the index');

console.log('\n=== head stays small ===');
const head = html.slice(0, html.indexOf('</head>'));
head.length < 5000 ? ok(`head is ${head.length}b, stylesheet reachable immediately`) : no('head bloated to ' + head.length + 'b');
!/application\/ld\+json/.test(head) ? ok('the 60KB of JSON-LD is not in front of the stylesheet') : no('JSON-LD is in <head>');

console.log('\n=== JSON-LD ===');
const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
let ld = null;
try { ld = JSON.parse(m[1].replace(/\\u003c/g, '<')); ok('parses as JSON'); } catch (e) { no('invalid JSON: ' + e.message); }
if (ld) {
  const types = ld.map(x => x['@type']);
  JSON.stringify(types) === '["WebSite","ItemList","ItemList"]' ? ok('WebSite + 2 ItemLists') : no('types: ' + types);
  ld[0].potentialAction?.['@type'] === 'SearchAction' ? ok('sitelinks SearchAction present') : no('no SearchAction');
  ld[1].itemListElement.length === live.length ? ok(`${live.length} Course entries, matching the data`) : no('course count mismatch');
  const c = ld[1].itemListElement[0].item;
  c.name && c.description && c.provider?.name ? ok('Course has the fields Google requires (name, description, provider)') : no('Course missing a required field');
  ld[1].itemListElement.every((x, i) => x.position === i + 1) ? ok('ListItem positions are 1..n') : no('positions wrong');
  const freeOne = ld[1].itemListElement.find(x => x.item.isAccessibleForFree);
  freeOne ? ok(`free programs marked isAccessibleForFree (${freeOne.item.name})`) : no('no free program flagged');
  ld[2].itemListElement[0].item['@type'] === 'Event' ? ok('events typed as Event') : no('events not typed');
}

console.log('\n=== robots + sitemap ===');
const robots = readFileSync(R + '/robots.txt', 'utf8');
/Sitemap: https:\/\/summerscope\.vercel\.app\/sitemap\.xml/.test(robots) ? ok('robots points at the sitemap') : no('no sitemap line');
/Disallow: \/dashboard\.html/.test(robots) ? ok('private dashboard disallowed') : no('dashboard not disallowed');
const sm = readFileSync(R + '/sitemap.xml', 'utf8');
sm.includes(`<lastmod>${data.meta.lastUpdated}</lastmod>`) ? ok(`sitemap lastmod tracks the data (${data.meta.lastUpdated})`) : no('lastmod stale');

console.log('\n=== served + rendered ===');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
for (const [path, type] of [['/robots.txt','text/plain'],['/sitemap.xml','application/xml'],['/og.png','image/png']]) {
  const r = await p.request.get(BASE + path);
  r.status() === 200 && r.headers()['content-type'].includes(type.split('/')[1])
    ? ok(`${path} → 200 ${r.headers()['content-type']}`) : no(`${path} → ${r.status()}`);
}
await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await p.waitForSelector('.card');
const og = await p.evaluate(() => ({
  image: document.querySelector('meta[property="og:image"]')?.content,
  url: document.querySelector('meta[property="og:url"]')?.content,
  tw: document.querySelector('meta[name="twitter:card"]')?.content,
  canonical: document.querySelector('link[rel=canonical]')?.href,
  h1: document.querySelectorAll('h1').length,
  robots: document.querySelector('meta[name=robots]')?.content,
}));
og.image && og.url && og.tw === 'summary_large_image' ? ok('og:image, og:url and twitter card set') : no('social tags: ' + JSON.stringify(og));
og.h1 === 1 ? ok('exactly one h1') : no(og.h1 + ' h1 elements');
/max-image-preview:large/.test(og.robots || '') ? ok('robots meta allows large previews') : no('robots meta: ' + og.robots);
// with JS on, the noscript index must not be visible to a reader
const nsVisible = await p.evaluate(() => {
  const ns = document.querySelector('.ns');
  return ns ? ns.getBoundingClientRect().height > 0 : false;
});
nsVisible ? no('the noscript index renders for JS readers (duplicate content)') : ok('noscript index stays hidden when JS runs');
await b.close();
console.log(bad ? `\n✗ ${bad} problem(s)` : '\n✓ SEO checks passed');
process.exit(bad ? 1 : 0);
