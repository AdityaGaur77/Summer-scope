import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL || BASE;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
const ok = m => console.log('  ✓ ' + m);
const no = m => { bad++; console.log('  ✗ ' + m); };

for (const [vp, label] of [[devices['iPhone 13'],'iPhone 13'], [{viewport:{width:1280,height:900}},'Desktop 1280']]) {
  const ctx = await b.newContext({ ...vp });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await p.waitForSelector('.card');
  console.log(`\n=== ${label} ===`);

  // Read the total from the page rather than pinning it: the database grows.
  const TOTAL = Number((await p.textContent('#more-note')).match(/of (\d+)/)[1]);
  let n = await p.locator('.card').count();
  n === 24 ? ok(`first page is 24 cards, not all ${TOTAL}`) : no('first page = ' + n);
  let note = (await p.textContent('#more-note')).trim();
  note === `Showing 24 of ${TOTAL}` ? ok(`note: "${note}"`) : no(`note: "${note}"`);
  (await p.textContent('#more-btn')).trim() === 'Show 24 more' ? ok('button offers the next 24') : no('button says ' + await p.textContent('#more-btn'));

  await p.click('#more-btn');
  await p.waitForTimeout(200);
  n = await p.locator('.card').count();
  n === 48 ? ok('show more → 48') : no('after one click = ' + n);

  // page all the way out
  for (let i = 0; i < 12; i++) { if (await p.locator('#more-btn').isVisible()) { await p.click('#more-btn'); await p.waitForTimeout(80); } }
  n = await p.locator('.card').count();
  n === TOTAL ? ok(`pages out to all ${TOTAL}`) : no('ended at ' + n);
  (await p.locator('#more-btn').isVisible()) ? no('button still shown at the end') : ok('button retires at the end');
  new RegExp('all ' + TOTAL).test(await p.textContent('#more-note')) ? ok('end note: "' + (await p.textContent('#more-note')).trim() + '"') : no('no end note');

  // a filter resets paging
  await p.click('.qchip:has-text("Free")');
  await p.waitForTimeout(250);
  n = await p.locator('.card').count();
  n <= 24 ? ok(`filtering restarts paging (${n} shown)`) : no('still showing ' + n + ' after filtering');
  await p.click('.qchip:has-text("Free")');
  await p.waitForTimeout(250);

  // list view
  await p.click('.vbtn[data-view="list"]');
  await p.waitForTimeout(250);
  const rows = await p.locator('.row').count();
  rows === Math.min(50, TOTAL) ? ok('list view pages 50 rows at a time') : no('list page = ' + rows);
  (await p.getAttribute('#cg', 'data-view')) === 'list' ? ok('grid marked as list') : no('grid data-view wrong');
  const rh = await p.locator('.row').first().boundingBox();
  rh.height <= 64 ? ok(`a row is ${Math.round(rh.height)}px (card was ~${label.startsWith('i') ? 283 : 417}px)`) : no('row is ' + Math.round(rh.height) + 'px');
  const tap = rh.height >= 32;
  tap ? ok('row clears a 32px tap target') : no('row too short to tap');

  // a row opens the same modal
  await p.locator('.row').first().click();
  await p.waitForTimeout(400);
  (await p.locator('#modal.open').count()) ? ok('a row opens the detail sheet') : no('row click did nothing');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);

  // the choice sticks
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('.row');
  (await p.getAttribute('#cg','data-view')) === 'list' ? ok('layout choice survives reload') : no('layout not persisted');
  await p.click('.vbtn[data-view="cards"]');
  await p.waitForTimeout(200);

  const [sw, vw] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  sw <= vw ? ok(`no horizontal scroll (${sw} ≤ ${vw})`) : no(`horizontal scroll ${sw} > ${vw}`);
  const same = errs.filter(e => !/ERR_CERT|fonts.googleapis|fonts.gstatic/.test(e));
  same.length ? no('console errors: ' + same.join(' | ')) : ok('no console errors');
  await ctx.close();
}
await b.close();
console.log(bad ? `\n✗ ${bad} problem(s)` : '\n✓ view checks passed');
process.exit(bad ? 1 : 0);
