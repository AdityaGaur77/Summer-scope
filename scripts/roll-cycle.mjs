#!/usr/bin/env node
/**
 * roll-cycle.mjs — roll SummerScope's program data forward to a new application cycle.
 *
 *   node scripts/roll-cycle.mjs --cycle 2027
 *   node scripts/roll-cycle.mjs --cycle 2027 --dry-run
 *
 * What it does, in order:
 *
 *   1. Snapshots every program's current cycle into its `history[]` array.
 *      Nothing is ever overwritten without first being recorded there, and
 *      nothing is ever deleted — programs that stop running are marked
 *      `status: "discontinued"` and stay in the file.
 *
 *   2. Rolls each deadline forward by one year and marks it
 *      `verification: "projected"`, so the site can honestly say
 *      "expected date — confirm on the official site".
 *
 *   3. Applies the curated overrides in scripts/cycle-<year>-updates.json:
 *      confirmed dates (`verified`), programs that have stopped
 *      (`discontinued`), programs whose future is in doubt (`uncertain`),
 *      plus any `newPrograms` and `newEvents`.
 *
 *   4. Recomputes `closed` from the dates so the site can never again show a
 *      program as "Open" after its deadline has passed.
 *
 * The script is idempotent for a given cycle: re-running it will not stack
 * duplicate history entries or re-add the same new programs.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA = join(ROOT, 'data.json');

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const CYCLE = parseInt(argOf('--cycle', ''), 10);
const DRY = args.includes('--dry-run');
const TODAY = argOf('--today', new Date().toISOString().slice(0, 10));

if (!CYCLE || Number.isNaN(CYCLE)) {
  console.error('usage: node scripts/roll-cycle.mjs --cycle <year> [--dry-run] [--today YYYY-MM-DD]');
  process.exit(1);
}

const UPDATES_PATH = join(HERE, `cycle-${CYCLE}-updates.json`);

// ── helpers ─────────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Programs that admit on a rolling basis. Orthogonal to whether a hard date exists. */
const ROLLING_RE = /rolling|varies|multiple|unspecified|year-round|until (sessions |we |they )?fill|cohorts?\b/i;

/**
 * `dlt` values that were only ever placeholders — a year-end stub standing in
 * for "we don't have a real date". Rolling these forward as if they were
 * deadlines would invent a December deadline that no program actually has.
 */
const PLACEHOLDER_DLT = /-(12-31|12-20)$/;

const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';

/**
 * Pull a real deadline out of free text like
 * "Applications open Dec 2025; final deadline May 1 2026".
 * Returns the LAST date found — deadline text puts the final date last.
 */
function extractDeadline(text) {
  if (typeof text !== 'string') return null;
  const re = new RegExp(`${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})`, 'gi');
  let m, last = null;
  while ((m = re.exec(text)) !== null) last = m;
  if (!last) return null;
  const mi = MONTHS.findIndex((x) => x.toLowerCase() === last[1].slice(0, 3).toLowerCase());
  if (mi === -1) return null;
  return `${last[3]}-${String(mi + 1).padStart(2, '0')}-${String(Number(last[2])).padStart(2, '0')}`;
}

/** Shift an ISO date by whole years, clamping Feb 29 to Feb 28. */
function addYears(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  let day = d;
  if (m === 2 && d === 29) day = 28;
  return `${y + n}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Bump every 4-digit year in a free-text string by n. */
function bumpYearsInText(text, n) {
  if (typeof text !== 'string') return text;
  return text.replace(/\b(20\d{2})\b/g, (m) => String(Number(m) + n));
}

/** Case/punctuation-insensitive match used by the overrides file. */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function findByMatch(programs, needle) {
  const n = norm(needle);
  return programs.filter((p) => norm(p.name) === n || norm(p.name).startsWith(n) || norm(p.name).includes(n));
}

/**
 * The single source of truth for a program's state. The frontend runs the
 * same logic against the live clock, so a stale data.json degrades to
 * "deadline passed" rather than to a wrong "Open" badge.
 */
function deriveStatus(p, today) {
  if (p.status === 'discontinued') return 'discontinued';
  if (p.status === 'uncertain') return 'uncertain';
  if (p.status === 'rolling') return 'rolling';
  if (p.dlt && today > p.dlt) return 'closed';
  if (p.opensOn) return today < p.opensOn ? 'upcoming' : 'open';
  // No confirmed opening date. A projected deadline is not evidence that the
  // application is live, so say "upcoming" rather than claim it is open.
  if (p.verification === 'projected') return 'upcoming';
  return 'open';
}

// ── load ────────────────────────────────────────────────────────────────────
const data = JSON.parse(readFileSync(DATA, 'utf8'));
const updates = existsSync(UPDATES_PATH) ? JSON.parse(readFileSync(UPDATES_PATH, 'utf8')) : {};

const fromCycle = data.meta?.cycle ?? CYCLE - 1;
const alreadyRolled = data.meta?.cycle === CYCLE;

if (alreadyRolled) {
  console.log(`data.json is already on cycle ${CYCLE} — re-applying overrides only, not re-rolling dates.`);
}

const stats = {
  rolled: 0, verified: 0, discontinued: 0, uncertain: 0,
  rolling: 0, added: 0, eventsAdded: 0, eventsRolled: 0,
  openings: 0, notes: 0,
};

// ── 1 + 2. snapshot history, roll dates forward ─────────────────────────────
for (const p of data.programs) {
  p.history ??= [];

  if (!alreadyRolled) {
    // Record the cycle we are leaving, exactly as it was.
    const already = p.history.some((h) => h.cycle === fromCycle);
    if (!already) {
      p.history.push({
        cycle: fromCycle,
        dl: p.dl,
        dlt: p.dlt,
        dates: p.dates,
        cost: p.cost,
        closed: p.closed,
        status: p.status ?? (p.closed ? 'closed' : 'open'),
        note: p.note,
        recordedOn: TODAY,
      });
    }

    // Rolling admissions and "has a hard deadline" are independent facts.
    // Brown's "Rolling until May 8" is both: it admits on a rolling basis AND
    // stops on a fixed date. Only programs with no date at all become
    // open-ended.
    if (ROLLING_RE.test(String(p.dl))) p.admissions = 'rolling';

    // Recover a real deadline hiding in the text behind a placeholder dlt,
    // e.g. Smith's "final deadline May 1 2026" stubbed as 2026-12-20.
    const base = PLACEHOLDER_DLT.test(p.dlt) ? extractDeadline(p.dl) : p.dlt;

    if (!base) {
      // Genuinely no fixed deadline — multiple cohorts, "varies", rolling.
      p.status = 'rolling';
      p.dlt = `${CYCLE}-12-31`;
      p.dl = bumpYearsInText(p.dl, 1);
      p.admissions = 'rolling';
      stats.rolling++;
    } else {
      p.dlt = addYears(base, 1);
      p.dl = bumpYearsInText(p.dl, 1);
      // A deadline string with no year in it can't be bumped — rebuild it.
      if (!/\d{4}/.test(p.dl)) p.dl = prettyDate(p.dlt);
      delete p.status;
      stats.rolled++;
    }

    p.dates = bumpYearsInText(p.dates, 1);
    p.desc = bumpYearsInText(p.desc, 1);
    if (p.note) p.note = bumpYearsInText(p.note, 1);
    if (p.startDate) p.startDate = bumpYearsInText(p.startDate, 1);

    p.verification = 'projected';
    p.isNew = false; // "New" means new to the database, not new to this cycle.
  }

  p.cycle = CYCLE;
  p.lastVerified ??= data.meta?.lastUpdated ?? TODAY;
}

// ── 3. curated overrides ────────────────────────────────────────────────────
for (const d of updates.discontinued ?? []) {
  for (const p of findByMatch(data.programs, d.match)) {
    p.status = 'discontinued';
    p.verification = 'verified';
    p.lastVerified = TODAY;
    p.discontinuedOn = d.discontinuedOn ?? TODAY;
    p.discontinuedReason = d.reason;
    if (d.successor) p.successor = d.successor;
    p.note = d.reason + (d.successor ? ` ${d.successor}` : '');
    // Don't advertise a deadline for a program that no longer runs. The last
    // real cycle stays in history[].
    p.dl = 'No longer offered';
    p.dlt = p.history.at(-1)?.dlt ?? p.dlt;
    p.dates = '—';
    stats.discontinued++;
  }
}

for (const u of updates.uncertain ?? []) {
  for (const p of findByMatch(data.programs, u.match)) {
    p.status = 'uncertain';
    p.verification = 'verified';
    p.lastVerified = TODAY;
    p.uncertainReason = u.reason;
    if (u.source) p.uncertainSource = u.source;
    p.note = u.reason;
    // The next cycle isn't confirmed, so a rolled-forward date would be a
    // fabrication. Keep the previous cycle's date in history and say so here.
    p.dl = `Not announced for ${CYCLE}`;
    p.dlt = p.history.at(-1)?.dlt ?? p.dlt;
    p.dates = `Not announced for ${CYCLE}`;
    stats.uncertain++;
  }
}

// Programs that have published WHEN the application opens but not yet the
// deadline. That is the common state in August: "the 2027 application launches
// in January." Worth recording — it tells a student when to start watching —
// but it does not make the projected deadline a confirmed one, so
// `verification` deliberately stays as it is.
for (const o of updates.openings ?? []) {
  const hits = findByMatch(data.programs, o.match);
  if (!hits.length) console.warn(`  ! opening override matched nothing: "${o.match}"`);
  for (const p of hits) {
    p.opensOn = o.opensOn;
    if (o.opensOnText) p.opensOnText = o.opensOnText;
    if (o.note) p.note = o.note;
    p.lastVerified = TODAY;
    stats.openings++;
  }
}

// Notes with no date claim attached — an expected window, a caveat, a conflict
// between sources. Never touches dates or verification.
for (const n of updates.notes ?? []) {
  const hits = findByMatch(data.programs, n.match);
  if (!hits.length) console.warn(`  ! note override matched nothing: "${n.match}"`);
  for (const p of hits) {
    p.note = n.note;
    p.lastVerified = TODAY;
    stats.notes++;
  }
}

for (const v of updates.verified ?? []) {
  const hits = findByMatch(data.programs, v.match);
  if (!hits.length) console.warn(`  ! verified override matched nothing: "${v.match}"`);
  for (const p of hits) {
    if (v.dl) p.dl = v.dl;
    if (v.dlt) p.dlt = v.dlt;
    if (v.dates) p.dates = v.dates;
    if (v.opensOn) p.opensOn = v.opensOn;
    if (v.opensOnText) p.opensOnText = v.opensOnText;
    if (v.note) p.note = v.note;
    if (v.cost) { p.cost = v.cost; p.costN = v.costN ?? p.costN; p.costB = v.costB ?? p.costB; }
    p.verification = 'verified';
    p.lastVerified = TODAY;
    delete p.status; // let the dates decide
    stats.verified++;
  }
}

// ── new programs ────────────────────────────────────────────────────────────
let nextId = Math.max(0, ...data.programs.map((p) => p.id)) + 1;
for (const np of updates.newPrograms ?? []) {
  if (findByMatch(data.programs, np.name).length) continue; // idempotent
  const entry = {
    id: nextId++,
    ...np,
    closed: false,
    isNew: true,
    cycle: CYCLE,
    verification: np.verification ?? 'projected',
    lastVerified: TODAY,
    addedOn: TODAY,
    history: [],
  };
  if (ROLLING_RE.test(String(np.dl))) entry.admissions = 'rolling';
  data.programs.push(entry);
  stats.added++;
}

// ── 4. recompute closed/status from the dates ───────────────────────────────
for (const p of data.programs) {
  if (p.status === undefined) delete p.status;
  const s = deriveStatus(p, TODAY);
  p.closed = s === 'closed' || s === 'discontinued';
  if (s === 'discontinued' || s === 'uncertain' || s === 'rolling') p.status = s;
}

// ── events ──────────────────────────────────────────────────────────────────
data.events ??= [];
for (const e of data.events) {
  // Roll any event whose deadline year is now in the past.
  const years = String(e.dl ?? '').match(/\b20\d{2}\b/g) ?? [];
  const newest = years.length ? Math.max(...years.map(Number)) : null;
  if (newest && newest < Number(TODAY.slice(0, 4))) {
    e.dates = bumpYearsInText(e.dates, 1);
    e.dl = bumpYearsInText(e.dl, 1);
    e.desc = bumpYearsInText(e.desc, 1);
    stats.eventsRolled++;
  }
}
for (const ne of updates.newEvents ?? []) {
  if (data.events.some((e) => norm(e.name) === norm(ne.name))) continue;
  data.events.push({ ...ne, addedOn: TODAY });
  stats.eventsAdded++;
}

// ── meta ────────────────────────────────────────────────────────────────────
const live = data.programs.filter((p) => p.status !== 'discontinued');
const counts = {};
for (const p of data.programs) counts[deriveStatus(p, TODAY)] = (counts[deriveStatus(p, TODAY)] ?? 0) + 1;

data.meta = {
  ...data.meta,
  lastUpdated: TODAY,
  version: '3.0.0',
  cycle: CYCLE,
  programCount: data.programs.length,
  activeProgramCount: live.length,
  eventCount: data.events.length,
  statusCounts: counts,
  statusLegend: {
    open: 'Accepting applications now.',
    upcoming: 'Confirmed for this cycle; applications have not opened yet.',
    closed: 'This cycle\'s deadline has passed.',
    rolling: 'Rolling admissions or multiple cohorts — no single fixed deadline.',
    uncertain: 'Program ran previously but its next cycle has not been confirmed.',
    discontinued: 'No longer operating. Kept on file for reference.',
  },
  verificationLegend: {
    verified: `Checked against the program's own materials on ${TODAY}.`,
    projected: 'Date carried forward from the previous cycle — expected, not confirmed. Verify on the official site.',
  },
  // Describes the STATE of the data, not the last run — the script is meant to
  // be re-run to apply new overrides, and a run-local tally would report
  // "0 deadlines rolled" on the second pass and read as though nothing is here.
  changelog: (() => {
    const n = (f) => data.programs.filter(f).length;
    const verified = n((p) => p.verification === 'verified');
    const addedThisCycle = n((p) => p.addedOn && p.cycle === CYCLE && p.isNew);
    const newEventCount = data.events.filter((e) => e.addedOn).length;
    return `v3.0.0 (${TODAY}): database is on the ${CYCLE} cycle. ` +
      `${data.programs.length} programs — ${counts.upcoming ?? 0} upcoming, ${counts.open ?? 0} open, ` +
      `${counts.rolling ?? 0} rolling, ${counts.closed ?? 0} closed, ` +
      `${counts.discontinued ?? 0} discontinued, ${counts.uncertain ?? 0} unconfirmed. ` +
      `${verified} deadlines confirmed against source; the rest are carried forward from ${CYCLE - 1} ` +
      `and flagged as expected. ${n((p) => p.opensOn)} have a confirmed application-opening date. ` +
      `${addedThisCycle} programs and ${newEventCount} events added this cycle. ` +
      `Every prior cycle is preserved in each program's history[] array; no records were deleted.`;
  })(),
};

// ── write ───────────────────────────────────────────────────────────────────
const out = JSON.stringify(data, null, 2) + '\n';
if (DRY) {
  console.log('--dry-run: not writing.');
} else {
  writeFileSync(DATA, out);
}

console.log(`cycle ${fromCycle} → ${CYCLE}`);
console.table(stats);
console.log('status breakdown:', counts);
console.log(`programs: ${data.programs.length} (${live.length} live) · events: ${data.events.length}`);
