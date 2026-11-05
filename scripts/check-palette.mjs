// Verifies the palette in styles.css as a SET.
//
// Every number below is a constraint the palette has to satisfy at the same
// time as all the others. Changing one colour to fix one row routinely breaks
// another, which is exactly why this is a script and not a comment.
//
//   npm run check-palette
//
import { readFileSync } from 'node:fs';
import { cr, okL } from './oklch.mjs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

/** Pull one `:root…{ }` block's custom properties out of the stylesheet. */
function tokens(selector) {
  const at = css.indexOf(selector + '{');
  if (at < 0) throw new Error('no such block: ' + selector);
  const body = css.slice(at, css.indexOf('\n}', at));
  const out = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})/g)) out[m[1]] = m[2].toUpperCase();
  return out;
}

const MODES = { dark: tokens(':root'), light: tokens(':root[data-theme="light"]') };
// Light inherits anything it does not override.
MODES.light = { ...MODES.dark, ...MODES.light };

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('  FAIL ' + msg); } }
function atLeast(mode, label, fg, bg, min) {
  const v = cr(fg, bg);
  ok(v >= min, `${mode} ${label}: ${fg} on ${bg} = ${v}:1, need ${min}:1`);
  return v;
}

const TAGS = ['indigo', 'emerald', 'blue', 'violet', 'yellow', 'red', 'fuchsia', 'orange', 'slate', 'sky'];
const PANELS = ['notice', 'alert', 'warn', 'good'];

for (const [mode, p] of Object.entries(MODES)) {
  // Every ground a given class of text actually lands on.
  const grounds = [['page', p.bg], ['card', p.card], ['raised', p['card-2']], ['band', p['bg-2']]];

  for (const [name, g] of grounds) {
    atLeast(mode, `text/${name}`, p.text, g, 7);
    atLeast(mode, `muted/${name}`, p.muted, g, 4.5);
    atLeast(mode, `faint/${name}`, p.faint, g, 3);
    atLeast(mode, `accent/${name}`, p.accent, g, 4.5);
    for (const s of ['green', 'amber', 'red']) atLeast(mode, `${s}/${name}`, p[s], g, 4.5);
  }

  atLeast(mode, 'accent-2/page', p['accent-2'], p.bg, 4.5);
  atLeast(mode, 'ink/accent', p['accent-ink'], p.accent, 4.5);
  atLeast(mode, 'ink/accent-2', p['accent-ink'], p['accent-2'], 4.5);

  // Body text above roughly 13.5:1 on a dark ground starts to halo — the
  // complaint that killed the first palette. Light mode has no such ceiling.
  if (mode === 'dark') {
    const v = cr(p.text, p.bg);
    ok(v <= 13.5, `dark text/page ${v}:1 is above the 13.5:1 halation point`);
  }

  // A panel's fill is close to its ground by design; its BORDER is what
  // separates it, so that is what gets checked.
  for (const k of PANELS) {
    atLeast(mode, `${k} label/fill`, p[k + '-fg'], p[k + '-bg'], 4.5);
    atLeast(mode, `${k} border/card`, p[k + '-bd'], p.card, 1.18);
  }

  // Each chip has to be readable against its own label AND visible as a chip.
  for (const k of TAGS) {
    atLeast(mode, `tag ${k} label/chip`, p[`t-${k}-fg`], p[`t-${k}-bg`], 4.5);
    atLeast(mode, `tag ${k} chip/card`, p[`t-${k}-bg`], p.card, 1.07);
  }

  // Only surfaces that actually share an edge somewhere on the page:
  // page/band, page/card, band/notice-bar, card/raised-inside-card.
  for (const [a, b] of [['bg', 'bg-2'], ['bg', 'card'], ['bg-2', 'card'], ['card', 'card-2']]) {
    const d = Math.abs(okL(p[a]) - okL(p[b])) * 100;
    ok(d >= 2.5, `${mode} surfaces ${a}/${b} are ${d.toFixed(1)} ΔL apart, need 2.5`);
  }
}

if (fails) { console.log(`\n${fails} failure(s)`); process.exit(1); }
console.log(`palette ok — ${Object.keys(MODES.dark).length} dark tokens, ${Object.keys(tokens(':root[data-theme="light"]')).length} light overrides, all constraints satisfied`);
