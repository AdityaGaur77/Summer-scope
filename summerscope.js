/**
 * summerscope.js — the shared program-status model.
 *
 * index.html and landing.html both render program cards. They used to carry
 * their own copies of the data and their own copies of the status logic, and
 * they drifted: landing.html was still serving 25 programs from a March 2026
 * snapshot while index.html served the full database. One definition, loaded
 * by both pages, is what stops that happening again.
 *
 * Plain script, not a module — both pages use inline classic scripts and need
 * these symbols on the global scope.
 */
/* eslint-disable no-unused-vars */

const SS_DATA_URL = './data.json';

/**
 * Status is DERIVED from dates at render time, never read from a stored
 * boolean. The old `closed` flag was baked into data.json and went stale the
 * moment a deadline passed, so the site advertised programs as "Open" months
 * after they had shut. Computing against the live clock means a stale
 * data.json can show an old deadline but never a wrong status.
 */
const STATUS = {
  open:         { label: 'Open',         tag: 'tf',  bar: 'cbar-open',     blurb: 'Accepting applications now' },
  upcoming:     { label: 'Opens later',  tag: 'tup', bar: 'cbar-upcoming', blurb: 'Applications have not opened yet' },
  rolling:      { label: 'Rolling',      tag: 'trl', bar: 'cbar-rolling',  blurb: 'Rolling admissions — no single deadline' },
  closed:       { label: 'Closed',       tag: 'tcl', bar: 'cbar-closed',   blurb: 'This cycle’s deadline has passed' },
  discontinued: { label: 'Discontinued', tag: 'tdc', bar: 'cbar-inactive', blurb: 'No longer offered' },
  uncertain:    { label: 'Unconfirmed',  tag: 'tun', bar: 'cbar-inactive', blurb: 'Next cycle not yet announced' },
};

function statusOf(p, now) {
  if (p.status === 'discontinued') return 'discontinued';
  if (p.status === 'uncertain')    return 'uncertain';
  if (p.status === 'rolling')      return 'rolling';
  if (p.dlt && now > p.dlt)        return 'closed';
  if (p.opensOn)                   return now < p.opensOn ? 'upcoming' : 'open';
  // A projected deadline is not evidence that the application is live.
  if (p.verification === 'projected') return 'upcoming';
  return 'open';
}

/** The two "not running" states share one filter checkbox. */
function inFilterBucket(s, v) {
  return v === 'inactive' ? (s === 'discontinued' || s === 'uncertain') : s === v;
}

/** Status pill for the dark modal header — needs light-on-dark colors. */
const MSTATUS_TAG = {
  open:         '<span class="mtag" style="background:rgba(52,211,153,.2);color:#6EE7B7">Accepting now</span>',
  upcoming:     '<span class="mtag" style="background:rgba(251,191,36,.2);color:#FCD34D">Opens later</span>',
  rolling:      '<span class="mtag" style="background:rgba(56,189,248,.2);color:#7DD3FC">Rolling admissions</span>',
  closed:       '<span class="mtag" style="background:rgba(239,68,68,.2);color:#FCA5A5">Deadline passed</span>',
  discontinued: '<span class="mtag" style="background:rgba(156,163,175,.25);color:#D1D5DB">Discontinued</span>',
  uncertain:    '<span class="mtag" style="background:rgba(249,115,22,.2);color:#FDBA74">Unconfirmed</span>',
};

/** Rank used when sorting "still open first". */
const STATUS_RANK = { open: 0, rolling: 1, upcoming: 2, closed: 3, uncertain: 4, discontinued: 5 };

/**
 * Fetch data.json and hydrate its date strings.
 * Resolves to { programs, events, meta, counts }.
 */
async function loadProgramData() {
  const res = await fetch(SS_DATA_URL + '?v=' + Date.now());
  if (!res.ok) throw new Error('Failed to fetch data.json');
  const data = await res.json();

  const programs = data.programs.map(function (p) {
    return Object.assign({}, p, {
      dlt: new Date(p.dlt + 'T00:00:00'),
      opensOn: p.opensOn ? new Date(p.opensOn + 'T00:00:00') : null,
    });
  });

  const now = new Date();
  const counts = {};
  programs.forEach(function (p) {
    const s = statusOf(p, now);
    counts[s] = (counts[s] || 0) + 1;
  });
  counts.inactive = (counts.discontinued || 0) + (counts.uncertain || 0);
  counts.takingApps = (counts.open || 0) + (counts.rolling || 0);

  return { programs: programs, events: data.events || [], meta: data.meta || {}, counts: counts };
}
