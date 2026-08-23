/**
 * The report. Ordered by what you should do first, not by what was found first.
 *
 * Evidence snippets were redacted on the way into the ledger, so a report is safe
 * to hand to someone helping you -- it names pages and categories, not values.
 */

import { SEVERITY, SEVERITY_NAME } from './extract.mjs';
import { listFindings, STATUS, summarize } from './ledger.mjs';
import { playbookFor } from './removal.mjs';
import { primaryName } from './identity.mjs';
import { nowIso } from './util.mjs';

const BADGE = { 4: 'CRITICAL', 3: 'HIGH', 2: 'MEDIUM', 1: 'LOW', 0: '-' };

function findingBlock(f, registry) {
  const playbook = playbookFor(f.host, registry);
  const lines = [];
  lines.push(`### ${BADGE[f.severity]} - ${f.host || 'unknown host'}`);
  lines.push('');
  lines.push(`- **Page:** ${f.url}`);
  if (f.title) lines.push(`- **Title:** ${f.title}`);
  lines.push(`- **Confidence it is you:** ${Math.round(f.confidence * 100)}%`);
  lines.push(`- **Matched on:** ${[...new Set(f.hits.map((h) => h.type))].join(', ') || 'n/a'}`);
  if (f.pii?.length) lines.push(`- **Exposes:** ${f.pii.map((p) => p.label).join(', ')}`);
  lines.push(`- **Status:** ${f.status} (first seen ${f.firstSeen.slice(0, 10)}, last seen ${f.lastSeen.slice(0, 10)})`);
  if (playbook?.optOut?.url) {
    lines.push(`- **Removal:** ${playbook.optOut.method} - ${playbook.optOut.url}`);
    if (playbook.optOut.notes) lines.push(`  - ${playbook.optOut.notes}`);
  } else {
    lines.push('- **Removal:** no self-serve opt-out on file - `letters` will draft a written request');
  }
  const ctx = f.hits.find((h) => h.context)?.context;
  if (ctx) lines.push(`- **Evidence (redacted):** ...${ctx}...`);
  lines.push('');
  return lines.join('\n');
}

export function renderReport({ identity, ledger, registry, capabilities, includeLow = false }) {
  const s = summarize(ledger);
  const lastRun = ledger.runs[ledger.runs.length - 1];
  const open = [STATUS.NEW, STATUS.TRIAGED, STATUS.REAPPEARED];

  const urgent = listFindings(ledger, { status: open, minSeverity: SEVERITY.high });
  const rest = listFindings(ledger, { status: open }).filter((f) => f.severity < SEVERITY.high);
  const requested = listFindings(ledger, { status: STATUS.REQUESTED });
  const removed = listFindings(ledger, { status: STATUS.REMOVED });

  const out = [];
  out.push(`# Exposure report - ${primaryName(identity)}`);
  out.push('');
  out.push(`Generated ${nowIso()} by privacy-agent (Agent Reach backend).`);
  out.push('');
  out.push(
    `**${s.total} ${s.total === 1 ? 'page' : 'pages'} on file** - ${urgent.length} needing action now, ` +
      `${requested.length} requested, ${removed.length} confirmed removed.`,
  );
  out.push('');

  if (lastRun) {
    out.push(
      `Last run: ${lastRun.startedAt?.slice(0, 16).replace('T', ' ')} - ${lastRun.queriesRun ?? 0} queries, ` +
        `${lastRun.pagesRead ?? 0} pages read, ${lastRun.newFindings ?? 0} new, ${lastRun.reappeared ?? 0} reappeared.`,
    );
    out.push('');
  }

  out.push('## Do these first');
  out.push('');
  if (urgent.length === 0) {
    out.push('Nothing at high or critical severity is open. ');
  } else {
    out.push('These publish data that is hard to change once it is out -- address, phone, relatives, records.');
    out.push('');
    for (const f of urgent) out.push(findingBlock(f, registry));
  }
  out.push('');

  out.push('## Everything else open');
  out.push('');
  if (rest.length === 0) out.push('_None._');
  for (const f of rest) {
    if (!includeLow && f.severity <= SEVERITY.low && f.confidence < 0.6) continue;
    out.push(findingBlock(f, registry));
  }
  out.push('');

  if (requested.length) {
    out.push('## Requested - waiting on the site');
    out.push('');
    for (const f of requested) {
      const at = f.removal?.requestedAt?.slice(0, 10) || 'unknown date';
      out.push(`- ${f.host} - requested ${at} - ${f.url}`);
    }
    out.push('');
  }

  if (removed.length) {
    out.push('## Confirmed removed');
    out.push('');
    for (const f of removed) out.push(`- ${f.host} - removed ${f.removal?.removedAt?.slice(0, 10) || ''} - ${f.url}`);
    out.push('');
    out.push('_Brokers re-import from upstream feeds. Keep running `verify` -- a reappearance is recorded as its own event._');
    out.push('');
  }

  out.push('## Counts');
  out.push('');
  out.push('| Severity | Pages |');
  out.push('| --- | --- |');
  for (const name of ['critical', 'high', 'medium', 'low']) {
    out.push(`| ${name} | ${s.bySeverity[name] || 0} |`);
  }
  out.push('');
  out.push('| Status | Pages |');
  out.push('| --- | --- |');
  for (const [k, v] of Object.entries(s.byStatus)) out.push(`| ${k} | ${v} |`);
  out.push('');

  if (capabilities) {
    out.push('## What this run could reach');
    out.push('');
    out.push(`- Agent Reach installed: ${capabilities.agentReach ? 'yes' : 'no (using built-in fallbacks)'}`);
    out.push(`- Web search: ${capabilities.webSearch}`);
    out.push(`- Page reads: ${capabilities.webRead}`);
    const backends = Object.entries(capabilities.backends)
      .map(([k, v]) => `${k}${v ? '' : ' (missing)'}`)
      .join(', ');
    out.push(`- Backends: ${backends}`);
    out.push('');
    out.push(
      '_Channels needing a login (Twitter/X, Reddit, Instagram, Facebook) only work once Agent Reach is configured for them; without that they silently degrade to a site-scoped web search, which sees less._',
    );
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push(
    '_Evidence snippets are redacted at write time. Removing a search result is not the same as removing the page: do the source first, the search index second._',
  );
  out.push('');
  return out.join('\n');
}

export const severityLabel = (n) => SEVERITY_NAME[n] || String(n);
