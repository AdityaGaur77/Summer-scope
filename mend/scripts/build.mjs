#!/usr/bin/env node
// Renders data/programs.json + templates/ into versions/v1, versions/v2, versions/v3.
//
// Output is committed. The rendered HTML *is* the artefact — the v1→v2 diff is what
// a redesign looks like in git, and that diff is part of the demo. Rendering is
// deterministic (no timestamps, no build ids) so a rebuild on unchanged input
// produces no diff, which is what makes `git status` a useful check.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VERSIONS } from '../templates/layout.mjs';
import { home, detail } from '../templates/shared.mjs';
import { pipeline as pipelineV1 } from '../templates/v1/pipeline.mjs';
import { pipeline as pipelineV2 } from '../templates/v2/pipeline.mjs';
import { pipeline as pipelineV3 } from '../templates/v3/pipeline.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const PIPELINES = { v1: pipelineV1, v2: pipelineV2, v3: pipelineV3 };

// v3 is v2's stylesheet with an appendix — the refresh shipped once, targets came later.
const STYLESHEETS = {
  v1: () => read('templates/assets/v1.css'),
  v2: () => read('templates/assets/v2.css'),
  v3: () => read('templates/assets/v2.css') + read('templates/assets/v3-extra.css'),
};

const ROBOTS = `# Meridian Therapeutics is a fictional company used to test data pipelines.
# Nothing here should be indexed, cached, or treated as a real drug pipeline.
User-agent: *
Disallow: /
`;

function write(versionDir, relPath, contents) {
  const full = join(root, 'versions', versionDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

function buildVersion(version, data) {
  rmSync(join(root, 'versions', version), { recursive: true, force: true });

  write(version, 'index.html', home(data, version));
  write(version, 'pipeline/index.html', PIPELINES[version](data, version));
  for (const program of data.programs) {
    write(version, `pipeline/${program.slug}/index.html`, detail(program, data, version));
  }
  write(version, 'assets/site.css', STYLESHEETS[version]());
  write(version, 'robots.txt', ROBOTS);

  return 2 + data.programs.length; // home + pipeline + one page per programme
}

const data = JSON.parse(read('data/programs.json'));
for (const version of Object.keys(VERSIONS)) {
  const pages = buildVersion(version, data);
  console.log(`built ${version.padEnd(3)} ${String(pages).padStart(2)} pages  (${VERSIONS[version].generator})`);
}
console.log(`\n${data.programs.length} programmes · versions/ rebuilt · run "npm run site:activate v1" to publish`);
