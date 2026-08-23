/**
 * The findings ledger -- the part that makes this an agent rather than a search.
 *
 * A one-shot scan tells you what is out there today. Removal is a loop: find,
 * request, wait, verify, and catch the listing when the broker quietly re-adds
 * you from the same upstream feed six weeks later. The ledger is what carries
 * state across runs so `verify` can tell "removed" from "never seen again" and
 * flag a reappearance as its own event.
 */

import { hostOf, nowIso, readJson, redact, shortHash, writeJson } from './util.mjs';

export const STATUS = {
  NEW: 'new',
  TRIAGED: 'triaged',
  REQUESTED: 'requested',
  REMOVED: 'removed',
  REAPPEARED: 'reappeared',
  IGNORED: 'ignored',
};

/**
 * Built fresh each call on purpose: a shared constant spread into `{...EMPTY}`
 * hands every ledger the same `runs` array and `findings` object, so two ledgers
 * in one process quietly accumulate each other's findings.
 */
const emptyLedger = () => ({ version: 1, createdAt: nowIso(), runs: [], findings: {} });

export async function loadLedger(path) {
  const data = await readJson(path, null);
  if (!data) return emptyLedger();
  return { ...emptyLedger(), ...data, runs: data.runs || [], findings: data.findings || {} };
}

export const saveLedger = (path, ledger) => writeJson(path, ledger);

export function findingId(url) {
  return shortHash('finding', String(url).replace(/[#?].*$/, '').toLowerCase());
}

export function startRun(ledger, meta = {}) {
  const run = { id: shortHash('run', nowIso(), Math.random()), startedAt: nowIso(), ...meta };
  ledger.runs.push(run);
  return run;
}

export function finishRun(run, stats) {
  Object.assign(run, stats, { finishedAt: nowIso() });
  return run;
}

function note(finding, event, text) {
  finding.history.push({ at: nowIso(), event, note: text });
  // Keep the tail bounded; the interesting events are always the recent ones.
  if (finding.history.length > 50) finding.history = finding.history.slice(-50);
}

/**
 * Insert or refresh a finding. Returns what changed so the scan can report
 * "3 new, 1 reappeared" instead of a flat count.
 */
export function upsertFinding(ledger, candidate, { runId } = {}) {
  const id = findingId(candidate.url);
  const existing = ledger.findings[id];
  const safeHits = (candidate.hits || []).map((h) => ({
    type: h.type,
    value: h.type === 'name' ? h.value : redact(h.value),
    count: h.count,
    context: redact(h.context || ''),
  }));

  if (!existing) {
    const finding = {
      id,
      url: candidate.url,
      host: hostOf(candidate.url),
      channel: candidate.channel,
      broker: candidate.broker || null,
      title: candidate.title || '',
      firstSeen: nowIso(),
      lastSeen: nowIso(),
      lastRun: runId || null,
      confidence: candidate.confidence,
      severity: candidate.severity,
      severityName: candidate.severityName,
      pii: candidate.pii || [],
      hits: safeHits,
      status: STATUS.NEW,
      removal: candidate.removal || null,
      history: [],
    };
    note(finding, 'discovered', `found via ${candidate.channel}`);
    ledger.findings[id] = finding;
    return { finding, isNew: true, reappeared: false };
  }

  const wasGone = existing.status === STATUS.REMOVED;
  existing.lastSeen = nowIso();
  existing.lastRun = runId || existing.lastRun;
  existing.confidence = Math.max(existing.confidence, candidate.confidence);
  existing.severity = Math.max(existing.severity, candidate.severity);
  existing.severityName = candidate.severityName;
  existing.pii = candidate.pii?.length ? candidate.pii : existing.pii;
  existing.hits = safeHits.length ? safeHits : existing.hits;
  if (candidate.removal && !existing.removal) existing.removal = candidate.removal;

  if (wasGone) {
    existing.status = STATUS.REAPPEARED;
    existing.removal = { ...(existing.removal || {}), reappearedAt: nowIso() };
    note(existing, 'reappeared', 'listing is back after being confirmed removed');
    return { finding: existing, isNew: false, reappeared: true };
  }
  note(existing, 'seen', 'still present');
  return { finding: existing, isNew: false, reappeared: false };
}

export function setStatus(ledger, id, status, patch = {}) {
  const finding = ledger.findings[id];
  if (!finding) return null;
  finding.status = status;
  finding.removal = { ...(finding.removal || {}), ...patch };
  note(finding, status, patch.note || '');
  return finding;
}

/** Called by `verify` when a page no longer contains any of your selectors. */
export function markGone(ledger, id) {
  const finding = ledger.findings[id];
  if (!finding) return null;
  finding.status = STATUS.REMOVED;
  finding.removal = { ...(finding.removal || {}), removedAt: nowIso() };
  note(finding, 'removed', 'selectors no longer present on the page');
  return finding;
}

export function listFindings(ledger, { status, minSeverity = 0, minConfidence = 0, host } = {}) {
  return Object.values(ledger.findings)
    .filter((f) => (status ? (Array.isArray(status) ? status.includes(f.status) : f.status === status) : true))
    .filter((f) => f.severity >= minSeverity && f.confidence >= minConfidence)
    .filter((f) => (host ? f.host === host : true))
    .sort((a, b) => b.severity - a.severity || b.confidence - a.confidence);
}

export function summarize(ledger) {
  const all = Object.values(ledger.findings);
  const byStatus = {};
  const bySeverity = {};
  for (const f of all) {
    byStatus[f.status] = (byStatus[f.status] || 0) + 1;
    bySeverity[f.severityName] = (bySeverity[f.severityName] || 0) + 1;
  }
  return { total: all.length, byStatus, bySeverity, runs: ledger.runs.length };
}
