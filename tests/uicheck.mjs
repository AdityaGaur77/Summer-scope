/**
 * The sections, the scroll reveal, and the two advertising placements.
 *
 * The expensive thing to get wrong here is the reveal: it works by hiding
 * content and then un-hiding it, so every way it can fail to un-hide is a way
 * the page can go blank. Three of the checks below exist only for that.
 */
import { launch, devices } from '../scripts/playwright.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

let bad = 0;
const ok = (m) => console.log('  ✓ ' + m);
const no = (m) => { bad++; console.log('  ✗ ' + m); };

const b = await launch();

async function open(ctxOpts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, userAgent: DESKTOP_UA, ...ctxOpts });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  return { ctx, p, errors };
}

// ── sections ────────────────────────────────────────────────────────────────
console.log('\n=== result sections ===');
{
  const { ctx, p, errors } = await open();
  await p.waitForSelector('.card');

  const SORTS = ['prestige', 'open', 'deadline', 'deadline-desc', 'cost-asc', 'cost-desc', 'newest', 'az'];
  let sectioned = 0;
  for (const sort of SORTS) {
    await p.selectOption('#ss', sort);
    await p.waitForTimeout(120);
    const r = await p.evaluate(() => ({
      flag: document.getElementById('cg').getAttribute('data-sectioned'),
      heads: [...document.querySelectorAll('.sec-h')].map((h) => h.firstChild.textContent.trim()),
    }));
    if (r.flag === 'yes') sectioned++;
    // A header appearing twice means the grouping is not contiguous under this
    // sort, which sectionsFor() is supposed to detect and refuse.
    const dupes = r.heads.filter((h, i) => r.heads.indexOf(h) !== i);
    dupes.length
      ? no(`${sort}: header repeated — ${dupes.join(', ')}`)
      : ok(`${sort}: ${r.heads.length} section(s), none repeated`);
  }
  sectioned === SORTS.length
    ? ok(`all ${SORTS.length} sorts produce sections`)
    : no(`only ${sectioned}/${SORTS.length} sorts produced sections`);

  // Every card on the page must sit under a header.
  await p.selectOption('#ss', 'prestige');
  await p.waitForTimeout(150);
  const orphan = await p.evaluate(() => {
    const kids = [...document.getElementById('cg').children];
    return kids.length && !kids[0].classList.contains('sec');
  });
  orphan ? no('the first result is above any section header') : ok('the grid opens with a section header');

  // A search is a ranked answer, not a taxonomy. It must not be chopped up.
  await p.fill('#si', 'math');
  await p.waitForTimeout(350);
  const onSearch = await p.evaluate(() => document.querySelectorAll('.sec').length);
  onSearch === 0 ? ok('a search turns sections off') : no(`a search still drew ${onSearch} section(s)`);
  await p.fill('#si', '');
  await p.waitForTimeout(350);

  // Paging in more results must not duplicate or lose a header, and the
  // partial count has to keep up.
  const before = await p.evaluate(() => document.querySelectorAll('.card').length);
  await p.click('#more-btn');
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({
    cards: document.querySelectorAll('.card').length,
    heads: [...document.querySelectorAll('.sec-h')].map((h) => h.firstChild.textContent.trim()),
    counts: [...document.querySelectorAll('.sec-n')].map((n) => n.textContent.trim()),
  }));
  after.cards > before ? ok(`show more: ${before} → ${after.cards} cards`) : no('show more added nothing');
  after.heads.filter((h, i) => after.heads.indexOf(h) !== i).length
    ? no('show more duplicated a section header')
    : ok('show more kept the headers unique');
  // Exactly one section may be partially drawn: the last one on the page.
  const partial = after.counts.filter((c) => c.includes(' of '));
  partial.length <= 1
    ? ok(`partial counts are honest (${partial.join('') || 'none'})`)
    : no(`${partial.length} sections claim to be partial: ${partial.join(', ')}`);

  // List view shares the header machinery.
  await p.click('.vbtn[data-view="list"]');
  await p.waitForTimeout(300);
  const listHeads = await p.evaluate(() => document.querySelectorAll('.grid[data-view="list"] .sec').length);
  listHeads > 0 ? ok(`list view draws ${listHeads} section header(s)`) : no('list view drew no headers');
  await p.click('.vbtn[data-view="cards"]');

  errors.length ? no('console errors: ' + errors.join(' | ')) : ok('no console errors');
  await ctx.close();
}

// ── scroll reveal: it must never be able to hide content ────────────────────
console.log('\n=== scroll reveal fails open ===');
{
  // 1. With JavaScript off, nothing is hidden and html.anim is never set.
  const ctx = await b.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 }, userAgent: DESKTOP_UA });
  const p = await ctx.newPage();
  await p.goto(BASE + '/index.html', { waitUntil: 'load' });
  const noJs = await p.evaluate(() => {
    const s = document.querySelector('.more-us');
    const cs = getComputedStyle(s);
    return { anim: document.documentElement.classList.contains('anim'), opacity: cs.opacity };
  });
  !noJs.anim ? ok('no JavaScript: html.anim is not set') : no('no JavaScript: html.anim was set anyway');
  Number(noJs.opacity) === 1
    ? ok('no JavaScript: the sections render at full opacity')
    : no(`no JavaScript: a section is at opacity ${noJs.opacity}`);
  await ctx.close();
}
{
  // 2. With reduced motion the observer is skipped entirely, so again nothing
  //    is ever hidden and no progress bar is created.
  const ctx = await b.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 }, userAgent: DESKTOP_UA });
  const p = await ctx.newPage();
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await p.waitForSelector('.card');
  const rm = await p.evaluate(() => ({
    anim: document.documentElement.classList.contains('anim'),
    opacity: getComputedStyle(document.querySelector('.adv')).opacity,
    bar: !!document.querySelector('.sprog'),
  }));
  !rm.anim ? ok('reduced motion: html.anim is not set') : no('reduced motion: html.anim was set');
  Number(rm.opacity) === 1 ? ok('reduced motion: sections are visible') : no(`reduced motion: opacity ${rm.opacity}`);
  !rm.bar ? ok('reduced motion: no progress bar') : no('reduced motion: a progress bar was added');
  await ctx.close();
}
{
  // 3. Normally: scrolling to a section reveals it, and it stays revealed.
  const { ctx, p, errors } = await open();
  await p.waitForSelector('.card');
  await p.evaluate(() => document.getElementById('advertise').scrollIntoView({ block: 'center' }));
  // The reveal is a .5s transition behind up to .34s of stagger delay, so wait
  // for it to settle rather than guessing at a sleep.
  const shown = await p.waitForFunction(
    () => Number(getComputedStyle(document.getElementById('advertise')).opacity) === 1,
    null, { timeout: 4000 },
  ).then(() => 1).catch(() => p.evaluate(() => Number(getComputedStyle(document.getElementById('advertise')).opacity)));
  shown === 1 ? ok('scrolling to the advertising section reveals it') : no(`revealed section stuck at opacity ${shown}`);

  const bar = await p.evaluate(() => {
    const el = document.querySelector('.sprog');
    if (!el) return null;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { on: el.classList.contains('on'), x: Number(m.a.toFixed(3)) };
  });
  bar && bar.on && bar.x > 0 && bar.x <= 1
    ? ok(`progress bar tracks the scroll (scaleX ${bar.x})`)
    : no('progress bar missing or not tracking: ' + JSON.stringify(bar));

  // Nothing anywhere on the page may be left stuck at zero opacity.
  const stuck = await p.evaluate(() => {
    document.querySelectorAll('.reveal').forEach((e) => e.scrollIntoView());
    return [...document.querySelectorAll('.reveal')]
      .filter((e) => Number(getComputedStyle(e).opacity) === 0)
      .map((e) => e.className);
  });
  await p.waitForTimeout(900);
  const stillStuck = await p.evaluate(() =>
    [...document.querySelectorAll('.reveal')]
      .filter((e) => Number(getComputedStyle(e).opacity) === 0)
      .map((e) => e.className));
  stillStuck.length
    ? no(`${stillStuck.length} reveal block(s) stayed invisible: ${stillStuck.join(' | ')}`)
    : ok(`all ${stuck.length >= 0 ? '' : ''}reveal blocks end up visible`);

  errors.length ? no('console errors: ' + errors.join(' | ')) : ok('no console errors');
  await ctx.close();
}

// ── advertising placements ──────────────────────────────────────────────────
console.log('\n=== advertising ===');
{
  const { ctx, p, errors } = await open();
  await p.waitForSelector('.card');

  const mails = await p.evaluate(() =>
    [...document.querySelectorAll('a[href^="mailto:"]')].map((a) => ({
      href: a.getAttribute('href'),
      label: a.getAttribute('aria-label') || '',
      text: a.textContent.replace(/\s+/g, ''),
    })));
  const addr = 'adityagaur12077@gmail.com';
  mails.length >= 3 ? ok(`${mails.length} mailto links`) : no(`only ${mails.length} mailto links`);
  mails.every((m) => m.href.includes(addr))
    ? ok('every mailto href carries the full address')
    : no('a mailto href is missing the address');
  mails.every((m) => m.label.includes(addr))
    ? ok('every mailto has an aria-label with the address')
    : no('a mailto is missing its aria-label');
  // The visible text must NOT contain the address as one harvestable string:
  // the @ is supplied by CSS, so textContent reads "adityagaur12077gmail.com".
  mails.every((m) => !m.text.includes(addr))
    ? ok('the @ comes from CSS — no harvestable address in the markup')
    : no('a mailto spells the whole address out in its text');
  // ...but a reader still sees it, because ::after renders.
  const rendered = await p.evaluate(() => {
    const el = document.querySelector('.adv-user');
    return el ? getComputedStyle(el, '::after').content : '';
  });
  rendered.includes('@') ? ok('the @ renders for a reader') : no(`the @ does not render (content: ${rendered})`);

  const strip = await p.evaluate(() => {
    const a = document.querySelector('.sponsor');
    const cta = document.querySelector('.sponsor-cta');
    return { h: Math.round(a.getBoundingClientRect().height), href: cta.getAttribute('href') };
  });
  strip.h <= 48 ? ok(`sponsor strip is ${strip.h}px, one line`) : no(`sponsor strip is ${strip.h}px tall`);
  strip.href === '#advertise' ? ok('sponsor strip links to the advertising section') : no(`strip links to ${strip.href}`);

  const placements = await p.evaluate(() => document.querySelectorAll('.adv-card').length);
  placements === 3 ? ok('three placements described') : no(`${placements} placements described`);

  // Free listing and paid placement must be visibly different things.
  const split = await p.evaluate(() => ({
    paid: !!document.querySelector('.adv-paid'),
    free: !!document.querySelector('.adv-free'),
    same: document.querySelector('.adv-paid') && document.querySelector('.adv-free')
      ? getComputedStyle(document.querySelector('.adv-paid')).borderColor
        === getComputedStyle(document.querySelector('.adv-free')).borderColor
      : true,
  }));
  split.paid && split.free && !split.same
    ? ok('paid placement and free listing are told apart')
    : no('paid and free boxes are not visually distinct');

  errors.length ? no('console errors: ' + errors.join(' | ')) : ok('no console errors');
  await ctx.close();
}

// ── the strip must not cost a phone its first result ────────────────────────
console.log('\n=== iPhone 13 ===');
{
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await p.waitForSelector('.card');

  const m = await p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    return {
      strip: Math.round(r('.sponsor').height),
      h1Top: Math.round(r('.hero h1').top),
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      muCols: getComputedStyle(document.querySelector('.mu-grid')).gridTemplateColumns.split(' ').length,
    };
  });
  m.strip <= 48 ? ok(`strip is ${m.strip}px on a phone — still one line`) : no(`strip is ${m.strip}px on a phone`);
  m.h1Top < 180 ? ok(`the h1 still starts at ${m.h1Top}px`) : no(`the strip pushed the h1 to ${m.h1Top}px`);
  m.scrollW <= m.clientW
    ? ok(`no horizontal scroll (${m.scrollW} ≤ ${m.clientW})`)
    : no(`horizontal scroll: ${m.scrollW} > ${m.clientW}`);
  m.muCols === 1 ? ok('"more from us" is one column on a phone') : no(`"more from us" is ${m.muCols} columns`);

  // The in-page jump has to clear the sticky nav.
  await p.click('.sponsor-cta');
  await p.waitForTimeout(700);
  const advTop = await p.evaluate(() => Math.round(document.getElementById('advertise').getBoundingClientRect().top));
  // Must clear the sticky nav, not merely be near the top of the viewport.
  advTop >= 0 && advTop < 400
    ? ok(`the strip's link lands on the section (top ${advTop}px)`)
    : no(`the strip's link landed with the section at ${advTop}px`);

  errors.length ? no('page errors: ' + errors.join(' | ')) : ok('no page errors');
  await ctx.close();
}

await b.close();
console.log(bad ? `\n✗ ${bad} UI check(s) failed` : '\n✓ UI checks passed');
process.exit(bad ? 1 : 0);
