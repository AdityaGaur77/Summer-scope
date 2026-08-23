/**
 * The scan loop: plan -> search -> read -> score -> classify -> record.
 *
 * Two budgets keep a run bounded and polite: `maxPagesPerRun` caps how many
 * pages get read at all, and the plan is sorted by priority so that cap is spent
 * on uniquely-identifying selectors before broad name sweeps.
 */

import { buildQueryPlan } from './plan.mjs';
import { scoreDocument } from './match.mjs';
import { extractPii } from './extract.mjs';
import { finishRun, findingId, startRun, upsertFinding } from './ledger.mjs';
import { brokerEntries, playbookFor } from './removal.mjs';
import { hostOf, limiter, log, truncate } from './util.mjs';

/** Search plumbing and aggregator shells -- never the exposure itself. */
const SKIP_HOSTS = new Set([
  'google.com',
  'bing.com',
  'duckduckgo.com',
  'html.duckduckgo.com',
  'r.jina.ai',
  's.jina.ai',
  'webcache.googleusercontent.com',
  'translate.google.com',
]);

const skippable = (url) => {
  const host = hostOf(url);
  return !host || SKIP_HOSTS.has(host) || !/^https?:\/\//i.test(url);
};

export async function runScan({ identity, selectors, reach, registry, ledger, options = {} }) {
  const {
    channels = identity.scan.channels,
    maxPages = identity.scan.maxPagesPerRun,
    maxResultsPerQuery = identity.scan.maxResultsPerQuery,
    minConfidence = identity.scan.minConfidence,
    dryRun = false,
  } = options;

  const plan = buildQueryPlan(identity, selectors, { channels, brokers: brokerEntries(registry) });
  if (dryRun) return { plan, dryRun: true };

  const run = startRun(ledger, { channels, maxPages, minConfidence, plannedTasks: plan.length });
  const stats = {
    queriesRun: 0,
    candidates: 0,
    pagesRead: 0,
    pagesFailed: 0,
    matched: 0,
    newFindings: 0,
    reappeared: 0,
  };

  // Phase 1 -- collect candidate pages, highest-signal queries first.
  const queue = [];
  const queued = new Set();
  const enqueue = (url, task, title) => {
    if (skippable(url)) return;
    const id = findingId(url);
    if (queued.has(id)) return;
    queued.add(id);
    queue.push({ url, task, title: title || '' });
  };

  for (const task of plan) {
    if (queue.length >= maxPages * 3) break; // plenty of candidates; stop spending searches
    if (task.kind === 'fetch') {
      enqueue(task.url, task, task.purpose);
      continue;
    }
    log.detail(`search[${task.channel}] ${task.query}`);
    const results = await reach.search(task.channel, task.query, { limit: maxResultsPerQuery });
    stats.queriesRun++;
    stats.candidates += results.length;
    for (const r of results) enqueue(r.url, task, r.title);
  }

  log.step(`  ${stats.queriesRun} queries -> ${queue.length} candidate pages`);

  // Phase 2 -- read and score, up to the page budget.
  const gate = limiter(identity.scan.concurrency || 2);
  const targets = queue.slice(0, maxPages);
  await Promise.all(
    targets.map((item) =>
      gate(async () => {
        const page = await reach.read(item.url);
        if (!page.ok) {
          stats.pagesFailed++;
          log.detail(`unreadable: ${item.url} (${page.error})`);
          return;
        }
        stats.pagesRead++;

        const { confidence, hits } = scoreDocument(page.text, selectors);
        if (confidence < minConfidence) return;
        stats.matched++;

        const playbook = playbookFor(hostOf(item.url), registry);
        const pii = extractPii(page.text, { isBroker: playbook?.type === 'broker' });
        const { isNew, reappeared } = upsertFinding(
          ledger,
          {
            url: item.url,
            channel: item.task.channel,
            broker: playbook?.id || null,
            title: truncate(item.title || page.text.split('\n').find(Boolean) || '', 140),
            confidence,
            hits,
            severity: pii.severity,
            severityName: pii.severityName,
            pii: pii.categories,
            removal: playbook
              ? { method: playbook.optOut?.method, optOutUrl: playbook.optOut?.url, email: playbook.optOut?.email }
              : null,
          },
          { runId: run.id },
        );
        if (isNew) stats.newFindings++;
        if (reappeared) stats.reappeared++;
      }),
    ),
  );

  finishRun(run, stats);
  return { run, stats, plan, skipped: Math.max(0, queue.length - targets.length) };
}
