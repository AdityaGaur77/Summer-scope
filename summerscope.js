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
 * How to describe when applications open.
 * Several programs publish only a month ("the 2027 application launches in
 * January"). Those are stored as the 1st of that month so the date maths
 * works, with `opensOnText` carrying the real precision — rendering
 * "January 1, 2027" for them would invent a deadline-grade date.
 */
function opensLabel(p) {
  if (p.opensOnText) return p.opensOnText;
  if (!p.opensOn) return '';
  return p.opensOn.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/* ═══════════════════════════════════════════════════════════════════════════
   DERIVED FACETS
   Every filter below is computed from the fields data.json already carries.
   None of them is a new stored column: a stored `region` or `hasAid` boolean
   would go stale exactly the way the old `closed` flag did, and would have to
   be hand-maintained for 125 programs on every cycle roll.

   Each helper returns an ARRAY (possibly empty). An empty array means "the
   program does not publish this detail" — not "no". The UI counts those and
   says so, so a filter never quietly hides programs as if they had been
   ruled out.
   ═══════════════════════════════════════════════════════════════════════════ */

const SS_REGION_OF_STATE = {
  CT: 'Northeast', ME: 'Northeast', MA: 'Northeast', NH: 'Northeast', RI: 'Northeast',
  VT: 'Northeast', NJ: 'Northeast', NY: 'Northeast', PA: 'Northeast',
  IL: 'Midwest', IN: 'Midwest', MI: 'Midwest', OH: 'Midwest', WI: 'Midwest', IA: 'Midwest',
  KS: 'Midwest', MN: 'Midwest', MO: 'Midwest', NE: 'Midwest', ND: 'Midwest', SD: 'Midwest',
  DE: 'South', FL: 'South', GA: 'South', MD: 'South', NC: 'South', SC: 'South', VA: 'South',
  DC: 'South', WV: 'South', AL: 'South', KY: 'South', MS: 'South', TN: 'South', AR: 'South',
  LA: 'South', OK: 'South', TX: 'South',
  AZ: 'West', CO: 'West', ID: 'West', MT: 'West', NV: 'West', NM: 'West', UT: 'West',
  WY: 'West', AK: 'West', CA: 'West', HI: 'West', OR: 'West', WA: 'West',
};

const SS_STATE_NAMES = {
  Connecticut: 'CT', Maine: 'ME', Massachusetts: 'MA', 'New Hampshire': 'NH',
  'Rhode Island': 'RI', Vermont: 'VT', 'New Jersey': 'NJ', 'New York': 'NY',
  Pennsylvania: 'PA', Illinois: 'IL', Indiana: 'IN', Michigan: 'MI', Ohio: 'OH',
  Wisconsin: 'WI', Iowa: 'IA', Kansas: 'KS', Minnesota: 'MN', Missouri: 'MO',
  Nebraska: 'NE', 'North Dakota': 'ND', 'South Dakota': 'SD', Delaware: 'DE',
  Florida: 'FL', Georgia: 'GA', Maryland: 'MD', 'North Carolina': 'NC',
  'South Carolina': 'SC', Virginia: 'VA', 'West Virginia': 'WV', Alabama: 'AL',
  Kentucky: 'KY', Mississippi: 'MS', Tennessee: 'TN', Arkansas: 'AR', Louisiana: 'LA',
  Oklahoma: 'OK', Texas: 'TX', Arizona: 'AZ', Colorado: 'CO', Idaho: 'ID', Montana: 'MT',
  Nevada: 'NV', 'New Mexico': 'NM', Utah: 'UT', Wyoming: 'WY', Alaska: 'AK',
  California: 'CA', Hawaii: 'HI', Oregon: 'OR', Washington: 'WA',
};

const SS_RX = {
  dc:        /\bd\.?\s?c\.?\b|washington\s*,?\s*d/i,
  nonUS:     /\b(spain|england|scotland|wales|united kingdom|u\.?k\.?|france|germany|italy|switzerland|netherlands|ireland|canada|ontario|quebec|british columbia|australia|japan|china|singapore|india|kenya|ghana|south africa|brazil|mexico|costa rica|iceland|greece|portugal|abroad|global|international)\b/i,
  remote:    /\b(online|virtual|remote)\b/i,
  multi:     /\b(various|multiple|nationwide|selected sites|several|across the us)\b/i,
  california:/\b(uc|university of california|silicon valley|bay area)\b/i,
  noHousing: /\bno housing\b/i,
  aidNo:     /\bno\s+(financial\s+aid|scholarships?|tuition)|information not specified|^unknown$|^n\/a/i,
  aidYes:    /scholarship|financial aid|financial assistance|tuition assistance|tuition waiver|fee waiver|aid available|stipend|^yes|assistance available/i,
};

/* State names are matched with word boundaries, so the patterns are built once
   here rather than 48 times per program per call — regionsOf() runs inside the
   per-option facet counts, which is thousands of calls per keystroke. */
const SS_STATE_RX = Object.keys(SS_STATE_NAMES).map(function (name) {
  return { rx: new RegExp('\\b' + name + '\\b', 'i'), code: SS_STATE_NAMES[name] };
});

const SS_REGION_CACHE = new Map();

/** Which US region(s) a program sits in, read out of its free-text location. */
function regionsOf(p) {
  const key = String(p.loc || '') + '|' + String(p.fmt || '');
  const hit = SS_REGION_CACHE.get(key);
  if (hit) return hit;

  const s = String(p.loc || '');
  const out = new Set();
  const isDC = SS_RX.dc.test(s);

  if (isDC) out.add('South');

  for (const st of SS_STATE_RX) {
    if (!st.rx.test(s)) continue;
    // "Washington, D.C." must not read as Washington State.
    if (st.code === 'WA' && isDC) continue;
    out.add(SS_REGION_OF_STATE[st.code]);
  }
  for (const m of s.matchAll(/\b([A-Z]{2})\b/g)) {
    if (SS_REGION_OF_STATE[m[1]]) out.add(SS_REGION_OF_STATE[m[1]]);
  }
  if (SS_RX.california.test(s)) out.add('West');
  if (SS_RX.remote.test(s) || p.fmt === 'Online') out.add('Online');
  if (SS_RX.nonUS.test(s)) out.add('International');
  if (!out.size && SS_RX.multi.test(s)) out.add('Multiple');

  const list = [...out];
  SS_REGION_CACHE.set(key, list);
  return list;
}

/**
 * Residential / commuter / virtual, from `programType` when it is published
 * and from `fmt` when it is not. An in-person program with no `programType`
 * yields [] — we genuinely do not know whether it houses students.
 */
function residencyOf(p) {
  const t = String(p.programType || '');
  const out = new Set();
  if (t) {
    if (/residential|residence|dorm/i.test(t) || (/housing/i.test(t) && !SS_RX.noHousing.test(t))) out.add('Residential');
    if (/commuter|day program/i.test(t)) out.add('Commuter');
    if (/virtual|online|remote/i.test(t)) out.add('Virtual');
  }
  if (p.fmt === 'Online') out.add('Virtual');
  if (p.fmt === 'Hybrid' && !out.size) out.add('Virtual');
  return [...out];
}

/** True when the program itself says money help exists. */
function hasAid(p) {
  const s = String(p.scholarship || '');
  if (!s) return false;
  if (SS_RX.aidNo.test(s)) return false;
  return SS_RX.aidYes.test(s);
}

/** Whole days from `now` until the deadline. Negative once it has passed. */
function daysUntil(dlt, now) {
  if (!dlt) return null;
  return Math.ceil((dlt - now) / 864e5);
}

/**
 * Deadline-window bucket. Only meaningful while a deadline is still ahead —
 * a closed or rolling program belongs to no window.
 */
const DEADLINE_WINDOWS = [
  { value: 'd30',  label: 'Within 30 days',  max: 30 },
  { value: 'd60',  label: 'Within 60 days',  max: 60 },
  { value: 'd90',  label: 'Within 90 days',  max: 90 },
  { value: 'd90p', label: 'More than 90 days away', max: Infinity },
];

function deadlineWindowsOf(p, now) {
  const st = statusOf(p, now);
  if (st !== 'open' && st !== 'upcoming') return [];
  const d = daysUntil(p.dlt, now);
  if (d == null || d < 0) return [];
  return DEADLINE_WINDOWS.filter(w => (w.value === 'd90p' ? d > 90 : d <= w.max)).map(w => w.value);
}

/**
 * The "feature" facet — a mixed bag of one-off qualities that each need only a
 * single checkbox. `unknown: true` marks a feature whose absence means "not
 * published" rather than "no", so the UI can report how many programs a filter
 * is hiding for lack of data.
 */
const FEATURES = [
  { value: 'aid',      label: 'Financial aid offered',      unknown: true,  test: hasAid,
    known: p => !!p.scholarship },
  { value: 'intl',     label: 'Accepts international',      unknown: true,  test: p => p.acceptsInternational === true,
    known: p => p.acceptsInternational != null },
  { value: 'resid',    label: 'Residential (housing)',      unknown: true,  test: p => residencyOf(p).includes('Residential'),
    known: p => !!p.programType || p.fmt !== 'In-Person' },
  { value: 'commuter', label: 'Commuter / day program',     unknown: true,  test: p => residencyOf(p).includes('Commuter'),
    known: p => !!p.programType || p.fmt !== 'In-Person' },
  { value: 'confirmed',label: 'Confirmed dates only',       unknown: false, test: p => p.verification === 'verified' },
  { value: 'new',      label: 'New this cycle',             unknown: false, test: p => p.isNew === true },
];

const FEATURE_BY_VALUE = FEATURES.reduce(function (m, f) { m[f.value] = f; return m; }, {});

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
