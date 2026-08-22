// Shared page shell for every Meridian version.
//
// Two things in here are load-bearing for the demo and must never be dropped:
//   1. the noindex meta — a fictional clinical pipeline must not be indexed
//   2. the disclosure footer — every page says the company is not real
// test/versions.test.mjs asserts both on every rendered page.

export const VERSIONS = {
  v1: { generator: 'Meridian Web 2.3.1', released: '2026-05-02' },
  v2: { generator: 'Meridian Web 2.4.0', released: '2026-08-19' },
  v3: { generator: 'Meridian Web 2.4.3', released: '2026-08-21' },
};

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "2026-06-14" -> "14 Jun 2026". Display only; the machine-readable value stays in data-updated. */
export function humanDate(iso) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, d] = String(iso).split('-');
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

function nav(depth) {
  const up = '../'.repeat(depth) || './';
  return `<nav class="nav" aria-label="Primary">
        <a class="nav__brand" href="${up}">Meridian<span class="nav__brand-mark">Therapeutics</span></a>
        <ul class="nav__links">
          <li><a href="${up}">Home</a></li>
          <li><a href="${up}pipeline/" class="nav__link--current">Pipeline</a></li>
        </ul>
      </nav>`;
}

export function page({ version, title, description, body, depth = 0, bodyClass = '' }) {
  const meta = VERSIONS[version];
  if (!meta) throw new Error(`unknown version: ${version}`);
  const up = '../'.repeat(depth) || './';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="generator" content="${esc(meta.generator)}">
  <meta name="description" content="${esc(description)}">
  <title>${esc(title)} — Meridian Therapeutics</title>
  <link rel="stylesheet" href="${up}assets/site.css">
</head>
<body class="${esc(bodyClass)}">
  <header class="masthead">
    <div class="wrap">
      ${nav(depth)}
    </div>
  </header>
  <main class="wrap">
${body}
  </main>
  <footer class="site-footer">
    <div class="wrap">
      <p class="disclosure"><strong>Meridian Therapeutics is a fictional company created to test data pipelines.</strong>
      No program, compound, trial, or result on this site is real. It exists so that a scraper can be broken
      on purpose and repaired under observation.</p>
      <p class="colophon">Basel, Switzerland · Site built with ${esc(meta.generator)}</p>
    </div>
  </footer>
</body>
</html>
`;
}
