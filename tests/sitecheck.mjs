/**
 * Core site behaviour, rebuilt after the container that held the original
 * suite was reclaimed. Phone and desktop.
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL || BASE;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
let bad = 0;
const ok = m => console.log('  ✓ ' + m);
const no = m => { bad++; console.log('  ✗ ' + m); };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// ── phone ───────────────────────────────────────────────────────────────────
{
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await p.waitForSelector('.card');
  console.log('\n=== iPhone 13 ===');

  (await p.getAttribute('html','data-theme')) === 'dark' ? ok('opens in dark mode') : no('not dark');
  const [sw,vw] = await p.evaluate(()=>[document.documentElement.scrollWidth, innerWidth]);
  sw<=vw ? ok(`no horizontal scroll (${sw} ≤ ${vw})`) : no(`overflow ${sw}>${vw}`);
  (await p.evaluate(()=>getComputedStyle(document.querySelector('#si')).fontSize)) === '16px'
    ? ok('search input 16px (no iOS zoom)') : no('search font would zoom iOS');
  (await p.locator('.mobnav').isVisible()) ? ok('bottom bar shown') : no('bottom bar hidden');

  // filter sheet via the bottom bar (the duplicate .rbar button is gone)
  await p.click('#mn-filter'); await p.waitForTimeout(350);
  (await p.locator('#sidebar.open').count()) ? ok('bottom-bar Filters opens the sheet') : no('sheet did not open');
  (await p.evaluate(()=>document.body.classList.contains('no-scroll'))) ? ok('scroll locked behind the sheet') : no('scroll not locked');
  const applyText = (await p.textContent('#sb-apply')).trim();
  await p.click('#sb-close'); await p.waitForTimeout(300);
  /^Show \d+ programs?$/.test(applyText) ? ok(`apply button: "${applyText}"`) : no('apply button: ' + applyText);

  // a quick chip filters and syncs the URL
  await p.click('.qchip:has-text("Free")'); await p.waitForTimeout(350);
  /cost=Free/.test(p.url()) ? ok('quick chip syncs to the URL') : no('URL: ' + p.url());
  const freeAll = await p.evaluate(()=>[...document.querySelectorAll('.cv')].every(e=>/Free/.test(e.textContent)));
  freeAll ? ok('every result on the page is free') : no('a non-free program slipped through');
  await p.click('.qchip:has-text("Free")'); await p.waitForTimeout(350);

  // detail sheet + Back
  await p.locator('.card').first().click(); await p.waitForTimeout(450);
  (await p.locator('#modal.open').count()) ? ok('detail sheet opens') : no('modal did not open');
  await p.goBack(); await p.waitForTimeout(400);
  const stillHere = p.url().startsWith(BASE);
  const closed = !(await p.locator('#modal.open').count());
  stillHere && closed ? ok('Back closes the sheet without leaving the site') : no('Back behaved wrong');

  // Both the (hidden) desktop tab row and the bottom bar carry data-page,
  // so scope to the one a phone can actually touch.
  await p.click('.mobnav [data-page="events"]'); await p.waitForTimeout(500);
  const ec = await p.locator('.ecard').count();
  ec === 20 ? ok('events tab: 20 cards') : no('events: ' + ec);
  await p.click('.mobnav [data-page="programs"]'); await p.waitForTimeout(300);

  await p.click('#theme-btn'); await p.waitForTimeout(300);
  (await p.getAttribute('html','data-theme')) === 'light' ? ok('theme toggles to light') : no('toggle failed');
  await p.reload({ waitUntil:'networkidle' });
  (await p.getAttribute('html','data-theme')) === 'light' ? ok('theme persists across reload') : no('theme not persisted');

  const real = errs.filter(e=>!/ERR_CERT|fonts\.(googleapis|gstatic)/.test(e));
  real.length ? no('console errors: ' + real.join(' | ')) : ok('no console errors');
  await ctx.close();
}

// ── desktop ─────────────────────────────────────────────────────────────────
{
  const ctx = await b.newContext({ viewport:{width:1280,height:900}, userAgent: UA });
  const p = await ctx.newPage();
  const errs = []; p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await p.goto(BASE + '/index.html?cost=Free&sort=az', { waitUntil:'networkidle' });
  await p.waitForSelector('.card');
  console.log('\n=== Desktop 1280 ===');

  (await p.locator('#sidebar').isVisible()) ? ok('filters docked') : no('sidebar hidden');
  (await p.locator('.mobnav').isVisible()) ? no('bottom bar still shown') : ok('bottom bar retired');
  const cols = await p.evaluate(()=>getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length);
  cols === 3 ? ok('3 card columns') : no('columns: ' + cols);

  const first = (await p.locator('.ctitle').first().textContent()).trim();
  const checked = await p.isChecked('input[name="cost"][value="Free"]');
  checked ? ok(`deep link restored the filter (A–Z from "${first}")`) : no('deep link lost the filter');
  (await p.inputValue('#ss')) === 'az' ? ok('deep link restored the sort') : no('sort not restored');

  // Clear the deep-linked filter first: "astronomy" AND free is genuinely
  // zero results, which would look like a broken search.
  await p.uncheck('input[name="cost"][value="Free"]'); await p.waitForTimeout(350);
  await p.fill('#si','astronomy'); await p.waitForTimeout(400);
  const n = await p.locator('.card').count();
  n > 0 && /q=astronomy/.test(p.url()) ? ok(`search works (${n} hit${n===1?'':'s'}, URL synced)`) : no('search broken');
  await p.fill('#si',''); await p.waitForTimeout(350);

  await p.keyboard.press('/');
  (await p.evaluate(()=>document.activeElement.id)) === 'si' ? ok('"/" focuses search') : no('/ shortcut broken');

  const [sw,vw] = await p.evaluate(()=>[document.documentElement.scrollWidth, innerWidth]);
  sw<=vw ? ok(`no horizontal scroll (${sw} ≤ ${vw})`) : no(`overflow ${sw}>${vw}`);
  const real = errs.filter(e=>!/ERR_CERT|fonts\.(googleapis|gstatic)/.test(e));
  real.length ? no('console errors: ' + real.join(' | ')) : ok('no console errors');
  await ctx.close();
}
await b.close();
console.log(bad ? `\n✗ ${bad} problem(s)` : '\n✓ site checks passed');
process.exit(bad ? 1 : 0);
