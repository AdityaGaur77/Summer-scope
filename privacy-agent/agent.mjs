#!/usr/bin/env node
/**
 * privacy-agent -- find where you are exposed online, then get it taken down.
 *
 * Built on Agent Reach (https://github.com/Panniantong/agent-reach) for internet
 * access: it routes each channel to whichever backend is live (Jina Reader, Exa,
 * gh, twitter-cli, opencli) and this agent asks it what is available rather than
 * hard-coding one scraper.
 *
 * Read-only, self-scan only, and it never sends a removal request for you --
 * it drafts them and you send them.
 *
 *   node privacy-agent/agent.mjs help
 */

import { parseArgs } from 'node:util';
import { copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { IdentityError, loadIdentity, selectorsOf } from './lib/identity.mjs';
import { Reach } from './lib/reach.mjs';
import { runScan } from './lib/scan.mjs';
import { renderReport } from './lib/report.mjs';
import { SEVERITY, SEVERITY_NAME } from './lib/extract.mjs';
import {
  listFindings,
  loadLedger,
  markGone,
  saveLedger,
  setStatus,
  STATUS,
  summarize,
} from './lib/ledger.mjs';
import { brokerEntries, loadRegistry, playbookFor, REGISTRY_PATH, writeRemovalDoc } from './lib/removal.mjs';
import { log, nowIso, setLogLevel, writeJson, writeText } from './lib/util.mjs';
import { scoreDocument } from './lib/match.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULTS = {
  identity: join(HERE, 'identity.json'),
  out: join(HERE, 'out'),
};

const USAGE = `privacy-agent -- self-scan for exposed personal data, then remove it

  node privacy-agent/agent.mjs <command> [options]

Commands
  init                 Create identity.json from the example
  doctor               Show which Agent Reach channels and backends are live
  scan                 Search the internet for your identity and record findings
  report               Write a prioritised markdown report from the ledger
  letters              Draft opt-out checklists and deletion requests into out/outbox
  mark <id> <status>   Set a finding's status (triaged|requested|removed|ignored)
  verify               Re-check known pages: confirm removals, catch reappearances
  registry [--verify]  List the broker registry, optionally probing every opt-out URL
  status               One-screen summary of the ledger

Options
  --identity <path>    Identity file (default privacy-agent/identity.json)
  --registry <path>    Broker registry (default privacy-agent/data/brokers.json)
  --out <dir>          Output directory (default privacy-agent/out)
  --channels <list>    Comma-separated: web,brokers,github,twitter,reddit
  --max-pages <n>      Page budget for this run
  --min-confidence <f> 0..1 threshold for "this is me" (default 0.45)
  --min-severity <n>   1=low 2=medium 3=high 4=critical (letters; default 2)
  --jurisdiction <j>   US, US-CA, EU, UK, ... (overrides identity.json)
  --dry-run            Print the query plan without touching the network
  --all                Include low-confidence findings in the report
  --write              Persist results (registry --verify)
  -v, --verbose        Show every query and fetch
  -q, --quiet          Errors only
`;

const OPTIONS = {
  identity: { type: 'string' },
  registry: { type: 'string' },
  out: { type: 'string' },
  channels: { type: 'string' },
  'max-pages': { type: 'string' },
  'min-confidence': { type: 'string' },
  'min-severity': { type: 'string' },
  jurisdiction: { type: 'string' },
  'dry-run': { type: 'boolean' },
  all: { type: 'boolean' },
  write: { type: 'boolean' },
  verify: { type: 'boolean' },
  verbose: { type: 'boolean', short: 'v' },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
};

const paths = (values) => {
  const out = resolve(values.out || DEFAULTS.out);
  return {
    identity: resolve(values.identity || DEFAULTS.identity),
    registry: resolve(values.registry || REGISTRY_PATH),
    out,
    ledger: join(out, 'findings.json'),
    report: join(out, 'report.md'),
    outbox: join(out, 'outbox'),
  };
};

async function context(values, { needIdentity = true } = {}) {
  const p = paths(values);
  const registry = await loadRegistry(p.registry);
  const ledger = await loadLedger(p.ledger);
  const reach = new Reach({ minGapMs: 1500 });
  if (!needIdentity) return { p, registry, ledger, reach, identity: null, selectors: [] };
  const identity = await loadIdentity(p.identity);
  return { p, registry, ledger, reach, identity, selectors: selectorsOf(identity) };
}

// ------------------------------------------------------------------ commands

async function cmdInit(values) {
  const p = paths(values);
  try {
    await copyFile(join(HERE, 'identity.example.json'), p.identity, /* COPYFILE_EXCL */ 1);
    console.log(`Created ${p.identity}`);
  } catch (err) {
    if (err.code === 'EEXIST') {
      console.log(`${p.identity} already exists -- leaving it alone.`);
    } else throw err;
  }
  console.log(`
Next: fill in the identity you want scanned, and set

  "consent": { "selfScan": true, "subjectIsMe": true, "acknowledgedAt": "${nowIso().slice(0, 10)}" }

The file is gitignored. Start with your name, city, main email and handles --
you can add phone and address later once you trust the matching.`);
}

async function cmdDoctor(values) {
  const { reach } = await context(values, { needIdentity: false });
  const caps = await reach.capabilities();
  console.log(`Agent Reach installed: ${caps.agentReach ? 'yes' : 'no'}`);
  if (!caps.agentReach) {
    console.log('  Install it for the login-gated channels:');
    console.log('  https://github.com/Panniantong/agent-reach  (pip install agent-reach)');
  }
  console.log(`Web search:  ${caps.webSearch}`);
  console.log(`Page reads:  ${caps.webRead}`);
  console.log('Backends:');
  for (const [name, present] of Object.entries(caps.backends)) {
    console.log(`  ${present ? '+' : '-'} ${name}`);
  }
  const channels = Object.entries(caps.channels || {});
  if (channels.length) {
    console.log('Agent Reach channels:');
    for (const [key, row] of channels) {
      console.log(`  ${row.status === 'ok' ? '+' : '-'} ${key}: ${row.status}${row.active_backend ? ` via ${row.active_backend}` : ''}`);
    }
  }
}

async function cmdScan(values) {
  const { p, identity, selectors, reach, registry, ledger } = await context(values);
  const options = {
    channels: values.channels ? values.channels.split(',').map((s) => s.trim()) : undefined,
    maxPages: values['max-pages'] ? Number(values['max-pages']) : undefined,
    minConfidence: values['min-confidence'] ? Number(values['min-confidence']) : undefined,
    dryRun: Boolean(values['dry-run']),
  };

  log.step(`Scanning for ${selectors.length} selectors across ${(options.channels || identity.scan.channels).join(', ')}`);

  const result = await runScan({ identity, selectors, reach, registry, ledger, options });

  if (result.dryRun) {
    console.log(`\nQuery plan (${result.plan.length} tasks, nothing fetched):\n`);
    for (const t of result.plan) {
      console.log(`  [p${t.priority}] ${t.channel.padEnd(8)} ${t.query || t.url}`);
      console.log(`            ${t.purpose}`);
    }
    return;
  }

  await saveLedger(p.ledger, ledger);
  const s = result.stats;
  console.log(`
  queries run     ${s.queriesRun}
  pages read      ${s.pagesRead} (${s.pagesFailed} unreadable${result.skipped ? `, ${result.skipped} over budget` : ''})
  matched you     ${s.matched}
  new findings    ${s.newFindings}
  reappeared      ${s.reappeared}

Ledger: ${p.ledger}
Next:   node privacy-agent/agent.mjs report`);
}

async function cmdReport(values) {
  const { p, identity, reach, registry, ledger } = await context(values);
  const capabilities = await reach.capabilities();
  const md = renderReport({ identity, ledger, registry, capabilities, includeLow: Boolean(values.all) });
  await writeText(p.report, md);
  console.log(md);
  console.log(`\nWritten to ${p.report}`);
}

async function cmdLetters(values) {
  const { p, identity, registry, ledger } = await context(values);
  const minSeverity = Number(values['min-severity'] || SEVERITY.medium);
  const targets = listFindings(ledger, {
    status: [STATUS.NEW, STATUS.TRIAGED, STATUS.REAPPEARED],
    minSeverity,
  });
  if (targets.length === 0) {
    console.log(`Nothing open at severity >= ${SEVERITY_NAME[minSeverity]}.`);
    return;
  }
  const jurisdiction = values.jurisdiction || identity.jurisdiction;
  for (const finding of targets) {
    const playbook = playbookFor(finding.host, registry);
    const file = await writeRemovalDoc(p.outbox, finding, { ...identity, jurisdiction }, playbook);
    setStatus(ledger, finding.id, STATUS.TRIAGED, { letterPath: file, note: 'removal doc drafted' });
    console.log(`  ${SEVERITY_NAME[finding.severity].padEnd(8)} ${finding.host} -> ${file}`);
  }
  await saveLedger(p.ledger, ledger);
  console.log(`
${targets.length} drafts in ${p.outbox}.
Read them, edit them, send them yourself. Nothing was sent.
Then: node privacy-agent/agent.mjs mark <id> requested`);
}

async function cmdMark(values, positionals) {
  const [id, status] = positionals;
  const valid = Object.values(STATUS);
  if (!id || !valid.includes(status)) {
    console.error(`Usage: mark <finding-id> <${valid.join('|')}>`);
    process.exitCode = 1;
    return;
  }
  const { p, ledger } = await context(values, { needIdentity: false });
  const patch = status === STATUS.REQUESTED ? { requestedAt: nowIso() } : {};
  const finding = setStatus(ledger, id, status, patch);
  if (!finding) {
    console.error(`No finding with id ${id}`);
    process.exitCode = 1;
    return;
  }
  await saveLedger(p.ledger, ledger);
  console.log(`${finding.host} -> ${status}`);
}

/**
 * Re-read every page we know about. Absence of your selectors is what "removed"
 * means here -- and a page that was removed and now matches again is recorded as
 * a reappearance rather than quietly flipping back.
 */
async function cmdVerify(values) {
  const { p, identity, selectors, reach, ledger } = await context(values);
  const minConfidence = Number(values['min-confidence'] || identity.scan.minConfidence);
  const targets = listFindings(ledger, {
    status: [STATUS.REQUESTED, STATUS.REMOVED, STATUS.TRIAGED, STATUS.NEW, STATUS.REAPPEARED],
  });
  if (!targets.length) {
    console.log('Nothing to verify yet -- run a scan first.');
    return;
  }
  let gone = 0;
  let still = 0;
  let back = 0;
  let unreadable = 0;

  for (const finding of targets) {
    const page = await reach.read(finding.url);
    if (!page.ok) {
      // Only the site saying "not here" counts as removal. A timeout, a block or
      // a 500 leaves the finding exactly as it was.
      if ([404, 410].includes(page.status) && finding.status !== STATUS.REMOVED) {
        markGone(ledger, finding.id);
        gone++;
        console.log(`  gone       ${finding.host} (HTTP ${page.status}) ${finding.url}`);
      } else {
        unreadable++;
        log.detail(`unreadable, leaving as-is: ${finding.url} (${page.error})`);
      }
      continue;
    }
    const { confidence } = scoreDocument(page.text, selectors);
    if (confidence < minConfidence) {
      if (finding.status !== STATUS.REMOVED) {
        markGone(ledger, finding.id);
        gone++;
        console.log(`  gone       ${finding.host} ${finding.url}`);
      }
      continue;
    }
    if (finding.status === STATUS.REMOVED) {
      setStatus(ledger, finding.id, STATUS.REAPPEARED, { reappearedAt: nowIso(), note: 're-listed' });
      back++;
      console.log(`  REAPPEARED ${finding.host} ${finding.url}`);
      continue;
    }
    still++;
    finding.lastSeen = nowIso();
    if (finding.status === STATUS.REQUESTED && finding.removal?.requestedAt) {
      const days = Math.floor((Date.now() - Date.parse(finding.removal.requestedAt)) / 86_400_000);
      if (days > 45) console.log(`  overdue    ${finding.host} -- requested ${days} days ago, still listed`);
    }
  }
  await saveLedger(p.ledger, ledger);
  console.log(`
  confirmed gone   ${gone}
  still listed     ${still}
  reappeared       ${back}
  unreadable       ${unreadable}`);
}

async function cmdRegistry(values) {
  const { p, reach, registry } = await context(values, { needIdentity: false });
  if (!values.verify) {
    for (const e of registry.entries) {
      console.log(`  ${e.id.padEnd(26)} ${e.type.padEnd(16)} ${e.optOut?.url || e.optOut?.email || '-'}`);
    }
    console.log(`\n${registry.entries.length} entries (${brokerEntries(registry).length} people-search brokers).`);
    console.log('Re-probe them with: node privacy-agent/agent.mjs registry --verify [--write]');
    return;
  }
  console.log('Probing opt-out routes (this is the only honest way to keep the registry current)\n');
  for (const e of registry.entries) {
    if (!e.optOut?.url) continue;
    const probe = await reach.probe(e.optOut.url);
    e.probe = { status: probe.status, ok: probe.ok, checkedAt: nowIso(), error: probe.error || undefined };
    console.log(`  ${probe.ok ? 'ok  ' : 'FAIL'} ${String(probe.status).padEnd(4)} ${e.id} ${e.optOut.url}`);
  }
  if (values.write) {
    registry.probedAt = nowIso();
    await writeJson(p.registry, registry);
    console.log(`\nWrote probe results to ${p.registry}`);
  } else {
    console.log('\n(not saved -- pass --write to record these results in data/brokers.json)');
  }
}

async function cmdStatus(values) {
  const { p, ledger } = await context(values, { needIdentity: false });
  const s = summarize(ledger);
  console.log(`Ledger: ${p.ledger}`);
  console.log(`  findings ${s.total} across ${s.runs} run(s)`);
  console.log(`  severity ${JSON.stringify(s.bySeverity)}`);
  console.log(`  status   ${JSON.stringify(s.byStatus)}`);
  const urgent = listFindings(ledger, { status: [STATUS.NEW, STATUS.REAPPEARED], minSeverity: SEVERITY.high });
  for (const f of urgent.slice(0, 10)) {
    console.log(`  ! ${SEVERITY_NAME[f.severity].padEnd(8)} ${f.id} ${f.host}`);
  }
}

// --------------------------------------------------------------------- entry

const COMMANDS = {
  init: cmdInit,
  doctor: cmdDoctor,
  scan: cmdScan,
  report: cmdReport,
  letters: cmdLetters,
  mark: cmdMark,
  verify: cmdVerify,
  registry: cmdRegistry,
  status: cmdStatus,
};

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: OPTIONS,
    allowPositionals: true,
  });
  const [command, ...rest] = positionals;
  if (!command || values.help || command === 'help') {
    console.log(USAGE);
    return;
  }
  const fn = COMMANDS[command];
  if (!fn) {
    console.error(`Unknown command: ${command}\n`);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }
  setLogLevel(values.quiet ? 'quiet' : values.verbose ? 'verbose' : 'normal');
  await fn(values, rest);
}

main().catch((err) => {
  if (err instanceof IdentityError) {
    console.error(`\n${err.message}\n`);
    process.exitCode = 2;
    return;
  }
  console.error(err);
  process.exitCode = 1;
});
