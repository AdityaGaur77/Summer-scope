// v1 — baseline pipeline table.
//
// Every field a scraper wants is reachable. Note what `phase` is and is not:
// it is a <td class="phase"> text node with NO data-phase attribute, because on
// this site phase was only ever a display concern. Every other column carries a
// data-* attribute, because the site's own filter JS reads them. That asymmetry
// is what v2's redesign turns into a silent failure.

import { page, esc, humanDate } from '../layout.mjs';

export function pipeline(data, version) {
  const { company, programs } = data;

  const rows = programs
    .map(
      (p) => `          <tr class="program" data-program="${esc(p.program)}">
            <td class="program-code"><a href="./${esc(p.slug)}/">${esc(p.program)}</a></td>
            <td class="compound" data-compound="${esc(p.compound)}">${esc(p.compound)}</td>
            <td class="indication" data-indication="${esc(p.indication)}">${esc(p.indication)}</td>
            <td class="modality" data-modality="${esc(p.modality)}">${esc(p.modality)}</td>
            <td class="phase">${esc(p.phase)}</td>
            <td class="status" data-status="${esc(p.status)}">${esc(p.status)}</td>
            <td class="partner" data-partner="${esc(p.partner)}">${esc(p.partner)}</td>
            <td class="updated"><time datetime="${esc(p.updated)}" data-updated="${esc(
        p.updated
      )}">${esc(humanDate(p.updated))}</time></td>
          </tr>`
    )
    .join('\n');

  const body = `    <section class="pipeline-intro">
      <h1>Pipeline</h1>
      <p>${programs.length} programmes across neglected tropical disease, tuberculosis, and respiratory
      medicine. Reviewed ${esc(humanDate(company.pipelineUpdated))}.</p>
    </section>

    <section class="pipeline-section">
      <table id="pipeline" class="pipeline">
        <caption class="visually-hidden">Meridian Therapeutics development pipeline</caption>
        <thead>
          <tr>
            <th scope="col">Programme</th>
            <th scope="col">Compound</th>
            <th scope="col">Indication</th>
            <th scope="col">Modality</th>
            <th scope="col">Phase</th>
            <th scope="col">Status</th>
            <th scope="col">Partner</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </section>`;

  return page({
    version,
    title: 'Pipeline',
    description: `Meridian Therapeutics development pipeline — ${programs.length} programmes.`,
    body,
    depth: 1,
    bodyClass: 'page-pipeline',
  });
}
