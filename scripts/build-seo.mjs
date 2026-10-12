/**
 * Generates everything a crawler needs, from data.json.
 *
 *   npm run build-seo
 *
 * The site renders entirely in the browser, so without this a crawler fetching
 * index.html gets about 1,400 characters of chrome, every count showing "—",
 * and not one program name. Google can run JavaScript, but it is slower at it,
 * does it on a second pass, and nothing else in the ecosystem — Bing, social
 * previews, LLM crawlers — reliably does it at all.
 *
 * Three outputs, all committed so the deploy stays a static upload:
 *
 *   index.html   a <noscript> index of every program, and JSON-LD
 *   sitemap.xml  the handful of URLs that are genuinely distinct pages
 *   robots.txt   points at the sitemap, keeps crawlers off the dashboard
 *
 * The <noscript> block is the honest way to do this: it is exactly what a
 * reader without JavaScript gets, so it is real content rather than text
 * hidden for crawlers. Re-run it whenever data.json changes — roll-cycle.mjs
 * and any data edit should be followed by this.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://summerscope.vercel.app';
const data = JSON.parse(readFileSync(join(ROOT, 'data.json'), 'utf8'));
const { programs, events, meta } = data;

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* Only programs a reader could still act on. A discontinued program in the
   crawlable index is an invitation to rank for something that no longer
   exists. */
const live = programs.filter((p) => p.status !== 'discontinued');

// ── 1. The no-JavaScript index ───────────────────────────────────────────────
const noscript = `<noscript>
  <section class="ns">
    <h2>All ${live.length} programs</h2>
    <p>This list is the plain-text version of the database. Turn on JavaScript
       to filter it by deadline, cost, subject, region, format and grade.</p>
    <ul>
${live.map((p) => `      <li><a href="${esc(p.link)}" rel="nofollow noopener">${esc(p.name)}</a>`
      + ` — ${esc(p.host)}. ${esc(p.cat.join(', '))}, ${esc(p.fmt)}, ${esc(p.loc)}.`
      + ` Grades ${p.grades.join(', ')}. Deadline ${esc(p.dl)}. ${esc(p.cost)}.</li>`).join('\n')}
    </ul>
    <h2>Events and competitions</h2>
    <ul>
${events.map((e) => `      <li><a href="${esc(e.link)}" rel="nofollow noopener">${esc(e.name)}</a>`
      + ` — ${esc(e.org)}. ${esc(e.type)}, ${esc(e.fmt)}. ${esc(e.dates)}. ${esc(e.cost)}.</li>`).join('\n')}
    </ul>
  </section>
</noscript>`;

// ── 2. JSON-LD ───────────────────────────────────────────────────────────────
/* Kept deliberately lean: the prose lives in the noscript block above, and a
   300-byte Course entry times 125 would put 40KB of duplicated description in
   front of the stylesheet. */
const short = (s, n = 180) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
};

const ld = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'SummerScope',
    url: SITE + '/',
    description: 'Summer programs, hackathons and competitions for high school students in grades 9–12.',
    inLanguage: 'en',
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: SITE + '/?q={search_term_string}' },
      'query-input': 'required name=search_term_string',
    },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Summer programs for high school students, ${meta.cycle}`,
    numberOfItems: live.length,
    itemListElement: live.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Course',
        name: p.name,
        description: short(p.desc),
        url: p.link,
        provider: { '@type': 'Organization', name: p.host },
        ...(p.costB === 'Free'
          ? { isAccessibleForFree: true, offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' } }
          : p.costN != null
            ? { offers: { '@type': 'Offer', price: p.costN, priceCurrency: 'USD' } }
            : {}),
      },
    })),
  },
  {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Competitions and hackathons for high school students',
    numberOfItems: events.length,
    itemListElement: events.map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Event',
        name: e.name,
        description: short(e.desc),
        url: e.link,
        eventAttendanceMode: /online|virtual/i.test(e.fmt)
          ? 'https://schema.org/OnlineEventAttendanceMode'
          : 'https://schema.org/MixedEventAttendanceMode',
        organizer: { '@type': 'Organization', name: e.org },
      },
    })),
  },
];

const ldBlock = '<script type="application/ld+json">\n'
  + JSON.stringify(ld).replace(/</g, '\\u003c') + '\n</script>';

// ── 3. Splice both into index.html between markers ───────────────────────────
let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const splice = (name, body) => {
  const open = `<!-- GENERATED:${name} -->`;
  const close = `<!-- /GENERATED:${name} -->`;
  const a = html.indexOf(open);
  const b = html.indexOf(close);
  if (a === -1 || b === -1) {
    console.error(`index.html is missing the ${name} markers; nothing written.`);
    process.exit(1);
  }
  html = html.slice(0, a + open.length) + '\n' + body + '\n' + html.slice(b);
};
splice('jsonld', ldBlock);
splice('noscript', noscript);
writeFileSync(join(ROOT, 'index.html'), html);

// ── 4. sitemap.xml ───────────────────────────────────────────────────────────
/* Only URLs that serve genuinely different content. The filter permutations
   are query strings over one list; submitting them would be asking to be
   indexed for thousands of near-duplicates. */
const urls = [
  { loc: SITE + '/', priority: '1.0', freq: 'weekly' },
  { loc: SITE + '/#events', priority: '0.8', freq: 'weekly' },
];
writeFileSync(join(ROOT, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n`
      + `    <lastmod>${meta.lastUpdated}</lastmod>\n`
      + `    <changefreq>${u.freq}</changefreq>\n`
      + `    <priority>${u.priority}</priority>\n  </url>`).join('\n')
  + '\n</urlset>\n');

// ── 5. robots.txt ────────────────────────────────────────────────────────────
writeFileSync(join(ROOT, 'robots.txt'),
  `User-agent: *\nAllow: /\n\n`
  + `# Password-gated, and nothing on it belongs in an index.\n`
  + `Disallow: /dashboard.html\nDisallow: /api/\n\n`
  + `Sitemap: ${SITE}/sitemap.xml\n`);

console.log(`  index.html   noscript index of ${live.length} programs + ${events.length} events, JSON-LD`);
console.log(`  sitemap.xml  ${urls.length} URLs, lastmod ${meta.lastUpdated}`);
console.log(`  robots.txt   sitemap reference, dashboard and api disallowed`);
