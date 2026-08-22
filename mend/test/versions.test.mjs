// Invariants of the three page versions.
//
// The break has to be exactly what the pitch says it is. If someone edits a template
// and the row count moves, or the archived row stops emitting class="phase", or a page
// loses its noindex tag, that has to fail here — in CI, in advance — and not on stage.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VERSIONS } from '../templates/layout.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'data/programs.json'), 'utf8'));
const PROGRAMS = data.programs.length;

const read = (version, rel) => readFileSync(join(root, 'versions', version, rel), 'utf8');
const pipelineOf = (version) => read(version, 'pipeline/index.html');
const count = (haystack, re) => (haystack.match(re) || []).length;

const ROWS = /<tr\b[^>]*\bdata-program="/g;
const PHASE_CLASS = /class="phase"/g;
const STAGE_PILL = /pill--stage/g;
const TARGET = /data-target="/g;

function everyPage(version) {
  const dir = join(root, 'versions', version);
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) out.push([full.slice(dir.length + 1), readFileSync(full, 'utf8')]);
    }
  };
  walk(dir);
  return out;
}

describe('build output', () => {
  for (const version of Object.keys(VERSIONS)) {
    test(`${version} renders home, pipeline and one page per programme`, () => {
      assert.ok(existsSync(join(root, 'versions', version, 'index.html')));
      assert.ok(existsSync(join(root, 'versions', version, 'pipeline/index.html')));
      for (const p of data.programs) {
        assert.ok(
          existsSync(join(root, 'versions', version, 'pipeline', p.slug, 'index.html')),
          `${version} missing detail page for ${p.slug}`
        );
      }
      assert.equal(everyPage(version).length, PROGRAMS + 2);
    });
  }
});

describe('rows stay flat — this is the whole pitch', () => {
  for (const version of Object.keys(VERSIONS)) {
    test(`${version} returns ${PROGRAMS} rows`, () => {
      assert.equal(count(pipelineOf(version), ROWS), PROGRAMS);
    });
  }
});

describe('the phase field', () => {
  test('v1 publishes phase on every row', () => {
    assert.equal(count(pipelineOf('v1'), PHASE_CLASS), PROGRAMS);
    assert.equal(count(pipelineOf('v1'), STAGE_PILL), 0);
  });

  test('v2 leaves phase readable on exactly one archived row', () => {
    // 19/20 null = 0.95. The one row that survives is MRD-2210, which is discontinued —
    // so the only phase value a stale scraper can still read belongs to a dead programme.
    assert.equal(count(pipelineOf('v2'), PHASE_CLASS), 1);
    assert.equal(count(pipelineOf('v2'), STAGE_PILL), PROGRAMS - 1);
    const legacyRow = pipelineOf('v2').match(/<tr[^>]*data-program="MRD-2210"[\s\S]*?<\/tr>/)[0];
    assert.match(legacyRow, /class="phase"/);
  });

  test('v3 keeps the redesign — phase is still only reachable via the pill', () => {
    // v3 builds on v2. A scraper healed during v2 reads phase fine here; an unhealed one
    // still sees 0.95 null. The demo depends on healing before v3 ships.
    assert.equal(count(pipelineOf('v3'), PHASE_CLASS), 1);
    assert.equal(count(pipelineOf('v3'), STAGE_PILL), PROGRAMS - 1);
  });

  test('the healed union selector reads every row in every version', () => {
    for (const version of Object.keys(VERSIONS)) {
      const html = pipelineOf(version);
      assert.equal(
        count(html, PHASE_CLASS) + count(html, STAGE_PILL),
        PROGRAMS,
        `${version}: .pill--stage, .phase must cover all rows`
      );
    }
  });
});

describe('the target field — EVOLVE', () => {
  test('v1 and v2 do not publish targets', () => {
    assert.equal(count(pipelineOf('v1'), TARGET), 0);
    assert.equal(count(pipelineOf('v2'), TARGET), 0);
  });

  test('v3 publishes a target on every row, including the archived one', () => {
    assert.equal(count(pipelineOf('v3'), TARGET), PROGRAMS);
  });

  test('target reaches the detail pages only in v3', () => {
    assert.equal(count(read('v1', 'pipeline/mrd-4471/index.html'), /class="target"/g), 0);
    assert.equal(count(read('v3', 'pipeline/mrd-4471/index.html'), /class="target"/g), 1);
  });
});

describe('mapped fields survive the redesign', () => {
  // Real redesigns preserve the data attributes their own JS depends on. That is why
  // rows keep parsing and the failure is silent rather than loud.
  for (const attr of ['data-compound', 'data-indication', 'data-modality', 'data-status', 'data-partner', 'data-updated']) {
    test(`${attr} is present on every row in every version`, () => {
      for (const version of Object.keys(VERSIONS)) {
        assert.equal(count(pipelineOf(version), new RegExp(attr + '="', 'g')), PROGRAMS, `${version}/${attr}`);
      }
    });
  }
});

describe('the redesign is a redesign, not just a deleted column', () => {
  test('v2 moves Partner ahead of Indication', () => {
    const heads = [...pipelineOf('v2').matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1]);
    assert.ok(heads.indexOf('Partner') < heads.indexOf('Indication'), heads.join(' | '));
    // v1 had them the other way round — index-based extraction breaks, selector-based does not.
    const v1Heads = [...pipelineOf('v1').matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1]);
    assert.ok(v1Heads.indexOf('Indication') < v1Heads.indexOf('Partner'));
  });

  test('v2 merges Phase and Status into one column', () => {
    const heads = [...pipelineOf('v2').matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1]);
    assert.ok(!heads.includes('Phase'));
    assert.ok(heads.includes('Development status'));
  });

  test('each version advertises a different generator', () => {
    const seen = Object.keys(VERSIONS).map((v) => pipelineOf(v).match(/name="generator" content="([^"]*)"/)[1]);
    assert.equal(new Set(seen).size, 3, seen.join(', '));
  });
});

describe('disclosure — non-negotiable', () => {
  for (const version of Object.keys(VERSIONS)) {
    test(`${version}: every page carries noindex and says the company is fictional`, () => {
      for (const [rel, html] of everyPage(version)) {
        assert.match(html, /name="robots" content="noindex, nofollow"/, `${version}/${rel} missing noindex`);
        assert.match(html, /fictional company created to test data pipelines/, `${version}/${rel} missing disclosure`);
      }
    });

    test(`${version}: robots.txt disallows everything`, () => {
      assert.match(read(version, 'robots.txt'), /User-agent: \*\nDisallow: \/$/m);
    });
  }
});
