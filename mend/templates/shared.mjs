// Home and program-detail pages.
//
// These are deliberately stable across v1/v2/v3 in structure — the redesign in v2
// ships as a new stylesheet here, not new markup. Only the pipeline table changes
// shape, because the pipeline table is the scrape target and a demo is easier to
// read when exactly one thing moved. v3 is the exception: it starts publishing the
// molecular target, on the detail page as well as in the table.

import { page, esc, humanDate } from './layout.mjs';

const showsTarget = (version) => version === 'v3';

export function home(data, version) {
  const { company, programs } = data;
  const clinical = programs.filter((p) => p.phase.startsWith('Phase'));
  const late = programs.filter((p) => p.phase === 'Phase 2' || p.phase === 'Phase 3');
  const partners = [...new Set(programs.map((p) => p.partner).filter((x) => x !== '—'))];

  const body = `    <section class="hero">
      <h1>${esc(company.tagline)}</h1>
      <p class="hero__lede">Meridian is a clinical-stage company working on kinetoplastid and helminth
      infections — diseases with millions of patients and almost no commercial pull. We run
      ${clinical.length} clinical-stage programmes and ${programs.length - clinical.length} earlier ones.</p>
      <p><a class="button" href="./pipeline/">See the pipeline</a></p>
    </section>

    <section class="panel">
      <h2>Where the work is</h2>
      <ul class="stat-row">
        <li class="stat"><span class="stat__num">${programs.length}</span><span class="stat__label">Programmes</span></li>
        <li class="stat"><span class="stat__num">${late.length}</span><span class="stat__label">Phase 2 or later</span></li>
        <li class="stat"><span class="stat__num">${partners.length}</span><span class="stat__label">Product-development partners</span></li>
        <li class="stat"><span class="stat__num">${company.founded}</span><span class="stat__label">Founded</span></li>
      </ul>
      <p class="panel__note">Partners: ${esc(partners.join(', '))}. Portfolio last reviewed
      ${esc(humanDate(company.pipelineUpdated))}.</p>
    </section>

    <section class="panel">
      <h2>Late-stage programmes</h2>
      <ul class="teaser-list">
${late
  .map(
    (p) => `        <li><a href="./pipeline/${esc(p.slug)}/"><strong>${esc(p.program)}</strong>
          <span>${esc(p.indication)}</span> <em>${esc(p.phase)}</em></a></li>`
  )
  .join('\n')}
      </ul>
    </section>`;

  return page({
    version,
    title: 'Home',
    description: company.tagline,
    body,
    depth: 0,
    bodyClass: 'page-home',
  });
}

export function detail(program, data, version) {
  const p = program;
  const rows = [
    ['Compound', 'compound', 'data-compound', p.compound],
    ['Indication', 'indication', 'data-indication', p.indication],
    ['Modality', 'modality', 'data-modality', p.modality],
    ['Phase', 'phase', null, p.phase],
    ['Status', 'status', 'data-status', p.status],
    ['Partner', 'partner', 'data-partner', p.partner],
  ];
  if (showsTarget(version)) rows.push(['Molecular target', 'target', 'data-target', p.target]);

  const facts = rows
    .map(([label, cls, attr, value]) => {
      const a = attr ? ` ${attr}="${esc(value)}"` : '';
      return `        <dt>${esc(label)}</dt>
        <dd class="${cls}"${a}>${esc(value)}</dd>`;
    })
    .join('\n');

  const body = `    <article class="program-detail" data-program="${esc(p.program)}">
      <p class="crumb"><a href="../">Pipeline</a> / ${esc(p.program)}</p>
      <h1>${esc(p.program)}</h1>
      <p class="program-detail__lede">${esc(p.summary)}</p>
      <dl class="facts">
${facts}
        <dt>Last updated</dt>
        <dd class="updated"><time datetime="${esc(p.updated)}" data-updated="${esc(p.updated)}">${esc(
    humanDate(p.updated)
  )}</time></dd>
      </dl>
      <p class="back"><a href="../">← All programmes</a></p>
    </article>`;

  return page({
    version,
    title: `${p.program} — ${p.indication}`,
    description: p.summary,
    body,
    depth: 2,
    bodyClass: 'page-detail',
  });
}
