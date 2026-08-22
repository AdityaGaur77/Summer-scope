#!/usr/bin/env node
// Publishes one version: versions/<v> -> public/
//
// This is how the break ships. The canonical URL /pipeline never changes and the
// scraper config never learns that versions exist — activating v2 simply replaces
// the bytes served at the same address, exactly as a real redesign would.
//
//   npm run site:activate v2 && git commit -am "redesign: merge phase into status" && git push
//
// Reverting is the same command with v1.

import { cpSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VERSIONS } from '../templates/layout.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!version || !VERSIONS[version]) {
  console.error(`usage: npm run site:activate -- <${Object.keys(VERSIONS).join('|')}>`);
  process.exit(1);
}

const source = join(root, 'versions', version);
if (!existsSync(source)) {
  console.error(`versions/${version} does not exist — run "npm run site:build" first.`);
  process.exit(1);
}

const target = join(root, 'public');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });

// Deterministic on purpose: no timestamp, so re-activating the same version is a no-op in git.
writeFileSync(join(target, 'VERSION'), `${version}\n${VERSIONS[version].generator}\n`);

console.log(`public/ now serves ${version} (${VERSIONS[version].generator})`);
console.log('commit and push to deploy — the canonical /pipeline URL is unchanged');
