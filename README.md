# SummerScope 🎓

The complete database of summer programs, hackathons, and competitions for high school students (grades 9–12), plus a private analytics dashboard.

**Live site:** https://summerscope.vercel.app

---

## Project structure

```
summerscope/
├── index.html                 ← the page: markup and <head> only
├── styles.css                 ← the stylesheet (dark by default, mobile-first)
├── app.js                     ← filters, rendering, routing, theme
├── summerscope.js             ← status model, derived facets, data loader
├── dashboard.html             ← private analytics dashboard
├── ss-insights.js             ← client-side visit tracker
├── data.json                  ← all program and event data
├── favicon.svg                ← the icon; the PNGs and .ico are built from it
├── favicon.ico                ← 16/32/48, for the bare /favicon.ico request
├── apple-touch-icon.png       ← 180, iOS home screen
├── icon-192.png · icon-512.png · icon-maskable.png
├── site.webmanifest           ← name, theme colours, install icons
├── api/
│   ├── track.js               ← POST endpoint: browser → Supabase (served at /api/collect)
│   ├── analytics.js           ← GET endpoint: aggregated stats + lifetime totals
│   └── _supabase.js           ← shared PostgREST helpers
├── supabase/
│   └── schema.sql             ← durable lifetime storage (run once — see below)
├── scripts/
│   ├── roll-cycle.mjs         ← rolls the database to a new application cycle
│   ├── build-icons.mjs        ← regenerates the icon set from favicon.svg
│   └── cycle-2027-updates.json← curated facts for the 2027 cycle
└── vercel.json
```

There is **one page**. `landing.html` used to be a second copy of it and drifted
badly — by August 2026 it was still saying "Verified March 2026" with a
hardcoded event count. It is gone; `vercel.json` rewrites `/landing.html` to
`/index.html` so old links still work, and the tracker still labels those visits
`landing` so the two entry points stay distinguishable in the dashboard.

### Where things live

| Concern | File | Why there |
|---|---|---|
| What a program's status *is* | `summerscope.js` (`statusOf`) | one definition for the whole site — but note `roll-cycle.mjs` keeps its own `deriveStatus` because it runs in Node with no DOM; the two must agree |
| What the filters *are* | `app.js` (`GROUPS`) | one table drives the panel markup, the URL keys, the chips and the match test |
| How anything *looks* | `styles.css` | so a mobile fix lands on every page at once |
| Markup and `<head>` | `index.html` | first paint, SEO, and the pre-paint theme stamp |

## Dark mode

Dark is the default for everyone, on the site and the dashboard. The tokens on
bare `:root` are the dark palette and `:root[data-theme="light"]` overrides them;
`prefers-color-scheme` is deliberately not consulted, so the site opens the same
way for every visitor and the nav toggle is the only thing that changes it.

The choice is stored under `_ss_theme` and applied by a small inline script in
`<head>` **before first paint** — anything later shows dark-mode readers a flash
of white page. Both pages share the key, so the choice carries between them.

### Why the palette looks the way it does

It took three attempts, and the first two failed for the same underlying
reason: **the greyscale was carrying the brand hue.**

| Attempt | Greys | Accent | Why it failed |
|---|---|---|---|
| 1 | hue 257°, chroma up to 0.051 | blue | A navy scale wearing grey's name. Read as a stock AI dashboard, and body text at 16.3:1 haloed against the ground. |
| 2 | hue 70°, chroma 0.006 | terracotta | Warm beige under terracotta is a recognisable existing product's palette, not this one's. |
| 3 | hue 197°, chroma 0.004 | deep teal | Current. |

Two things carry over from the first fix and still hold. Body text sits
9–13:1 on dark and 13–17:1 on light: past roughly 13:1 on a dark ground the
extra contrast stops buying legibility and light text starts to halo, which is
the glow that aches after a few minutes. And a "neutral" that is really a tinted
scale is most of what makes a palette look machine-made.

What is new in the third attempt is that the neutrals no longer try to say
anything. At chroma 0.004 there is no visible cast in either direction, so the
whole identity rests on one accent — deep teal at 197°, far from both of the
hues that failed, and far enough from the semantic green at 155° that "this is
interactive" and "this program is free" never read as the same colour.

The light theme is the same construction from the other end: the same neutral
scale, the same teal at the lightness that clears 4.5:1 on white. Its nav and
hero band used to be a near-black navy slab — the loudest thing on the page, and
a leftover from a palette that no longer exists. It is now a soft teal panel two
lightness steps off the page. Because that band is no longer dark in both modes,
the tokens that colour it are `--band-*`, not `--on-dark-*`, and the modal's
status pill uses the themed tag classes rather than the hardcoded light-on-dark
hexes it used to carry.

Both modes are generated perceptually in OKLCH and every pair is checked: body
and secondary text, accent and status colours on both grounds, ink on the accent
fill, each tag chip against its own label *and* against the card beneath it, and
a real lightness step between every two surfaces that share an edge. **Change one
value and re-check the set** — the numbers hold each other up. The full token
block with its reasoning is at the top of `styles.css`; `dashboard.html` carries
the same scale plus its own chart palette, which is validated separately against
the surface it sits on.

## Phone layout

Everything outside a media query targets a phone; 480, 700, 900 and 1100px add
to it. The rule the layout is tuned against is simple: **a visitor on a phone
should reach an actual program without scrolling past a page about programs.**

The first build did not. The hero, a three-line notice and three stacked control
rows put the first card 629px down a 664px viewport, so the opening screen held
no results at all. What comes off on a phone, and comes back at 480 or 700px:

| | Phone | Wider |
|---|---|---|
| Hero eyebrow | hidden | shown from 480px |
| Subtitle | clamped to 2 lines | full from 480px |
| Hero stats | 2 of 4 (the other two are quick chips) | all 4 from 480px |
| Expected-date notice | one short sentence | the full wording from 700px |
| Card description | clamped to 2 lines | 3 lines from 700px |
| Card meta cells | Deadline + Dates | all four from 700px |

Three cuts apply at every width, because they were not density problems but
duplication: the card's subject chips cap at two plus a `+N` (the full list is
in the modal), the per-grade chips are gone entirely (the Grades cell sits
directly beneath them), and the selectivity rating shows only its filled stars
instead of five glyphs of which some carry no information.

Together that is 629px → 416px before the first card, and 399px → 298px per
card. Nothing is removed from the site — everything trimmed here is either one
tap away or in the detail modal.

## Icons

`favicon.svg` is both the icon browsers get and the source every other size is
built from:

- **`npm run build-icons`** re-renders `favicon.ico` (16/32/48),
  `apple-touch-icon.png` (180), and the 192/512/maskable PNGs.
- Playwright is **not** in `package.json` — the mark changes about once a year
  and the outputs are committed, so nobody running the site should have to pull
  a browser. The npm script fetches it with `npx`; set `CHROMIUM_PATH` if you
  already have a binary.
- Rounded corners for browser tabs and the manifest's `any` slot; square and
  full-bleed where the platform applies its own mask (iOS home screen, Android
  maskable), which would otherwise round the corners twice.

The mark is an aperture: the ring is the accent token, the centre is accent-2 —
the same pair a button and its hover use — and the centre dot is the one in the
wordmark. It stays geometric because the smallest place it is ever seen is a
16px browser tab.

> One trap worth knowing, because it cost a round here: **`--` is illegal inside
> an XML comment.** Writing a CSS custom property name in a comment in
> `favicon.svg` makes the file invalid XML, so browsers refuse to render it as
> an image — while every PNG built from it still comes out perfect, because
> Chromium parses those through lenient HTML. `build-icons.mjs` now fails the
> build on it rather than letting it ship silently.

## Filters

Every facet is derived from fields `data.json` already carries. None of them is
a stored column: a stored `region` or `hasAid` boolean would go stale the way the
old `closed` flag did, and would need hand-maintaining for 125 programs at every
cycle roll.

| Facet | Derived from |
|---|---|
| Status | `statusOf()` — dates vs. the live clock |
| Deadline window | days from today to `dlt`, only while it is still ahead |
| Subject | `cat[]` |
| Where | `regionsOf()` — US region read out of the free-text `loc` |
| Format | `fmt` |
| Cost | `costB` |
| Grade | `grades[]` |
| Details | `scholarship`, `acceptsInternational`, `programType`, `verification`, `isNew` |
| Selectivity | `prestige` |

Two rules make the counts trustworthy:

- **Each option's count is computed with its own group's filter dropped.** A
  number beside a checkbox has to answer "how many would I get if I ticked
  this". Counting with the group still applied shows `0` next to every unticked
  box as soon as one in that group is ticked.
- **An empty derived value means "not published", never "no".** A program that
  says nothing about financial aid has not been ruled out, so a Details filter
  reports how many programs it is hiding for lack of data instead of letting the
  reader assume they failed the test.

---

## The program data model

### Status is computed, never stored

Each program's state is **derived from its dates at render time**, by
`statusOf()` in `summerscope.js`. It is deliberately not a stored boolean.

The old schema had `"closed": true|false` baked into `data.json`. That value was
correct on the day it was written and wrong forever after — by August 2026 the
site was still advertising programs as "Open" whose deadlines had passed in
May. Deriving the status against the live clock means a stale `data.json` can
show an out-of-date *deadline*, but it can no longer show a wrong *status*.

| Status | Meaning |
|---|---|
| `open` | Applications are open now. |
| `upcoming` | Confirmed for this cycle; applications have not opened yet. |
| `rolling` | Rolling admissions or multiple cohorts — no single fixed deadline. |
| `closed` | This cycle's deadline has passed. |
| `uncertain` | Ran previously, next cycle not confirmed. |
| `discontinued` | No longer operating. **Kept on file**, never deleted. |

### Verified vs projected dates

Every program carries a `verification` field:

- **`verified`** — checked against the program's own materials on `lastVerified`.
- **`projected`** — the date was carried forward from the previous cycle. The UI
  renders these with a dashed underline and the modal says so explicitly. Treat
  them as "expected", not "confirmed".

### Nothing is ever deleted

Each program has an append-only `history[]` array holding a snapshot of every
previous cycle — deadline, dates, cost, status. Programs that shut down are
marked `discontinued` and stay in the file with their history intact, so a
student who searches for them gets an answer instead of silence.

### Program shape

```json
{
  "id": 1,
  "name": "Research Science Institute (RSI)",
  "host": "MIT / Center for Excellence in Education",
  "logo": "RSI", "color": "#1E3A5F",
  "cat": ["Research", "STEM"],
  "fmt": "In-Person",
  "loc": "Cambridge, MA",
  "grades": [11],
  "cost": "Free", "costN": 0, "costB": "Free",
  "dates": "Late June – early August 2027",
  "dl": "Dec 9, 2026", "dlt": "2026-12-09",
  "opensOn": "2026-10-01",
  "cycle": 2027,
  "verification": "verified",
  "lastVerified": "2026-08-12",
  "prestige": 5,
  "isNew": false,
  "desc": "…", "link": "https://…", "note": "…",
  "history": [
    { "cycle": 2026, "dl": "Dec 10, 2025", "dlt": "2025-12-10", "dates": "…", "closed": true }
  ]
}
```

`costB` ∈ `Free` · `Under3k` · `3kTo8k` · `Over8k` · `Varies`  ·  `fmt` ∈ `In-Person` · `Online` · `Hybrid`

**`costB` is the authority on price, not `costN`.** `costN` is only a sort key.
Fifteen `Varies` programs carried `costN: 0`, and because the card printed
"Free / Full Aid" from `costN === 0`, commercial programs costing thousands were
advertised to students as free and inflated the "free programs" headline from 45
to 60. A cost that is not a single number is now `costN: null` — unknown, which
sorts last in both directions rather than leading a low-to-high list at an
implied $0.

`closed` is still written for backwards compatibility but **is not read by the
site** — `statusOf()` is the only source of truth.

For the same reason `meta` no longer carries `statusCounts` or
`activeProgramCount`. They froze a value that changes with the clock: the file
said "0 open, 107 upcoming", which stopped being true on 1 September 2026 when
two programs opened. The site counts what it renders. The counts that do not
depend on today's date — `programCount`, `eventCount` — stay.

---

## Rolling the database to a new cycle

Once a year, when the summer is over and the next cycle's applications start
opening:

```bash
# 1. Write the year's curated facts
cp scripts/cycle-2027-updates.json scripts/cycle-2028-updates.json
#    …edit it: confirmed dates, programs that stopped, new programs to add

# 2. Preview
npm run roll-cycle -- --cycle 2028 --dry-run

# 3. Apply
npm run roll-cycle -- --cycle 2028
```

The script snapshots the outgoing cycle into every program's `history[]`,
rolls each deadline forward a year and flags it `projected`, then applies your
curated overrides on top. It is idempotent — re-running it will not stack
duplicate history entries or re-add the same programs.

The updates file has four sections:

| Section | What it does |
|---|---|
| `verified` | Confirmed dates for this cycle. Sets `verification: "verified"`. |
| `openings` | The application-opening date is published but the deadline isn't — the usual state in late summer. Sets `opensOn`; deliberately leaves the deadline `projected`. |
| `notes` | Context with no date claim: an expected window, a caveat, sources that disagree. Touches neither dates nor verification. |
| `discontinued` | Programs that have stopped. Marked and kept, never deleted. |
| `uncertain` | Ran before, next cycle unannounced. No date is invented. |
| `newPrograms` / `newEvents` | Added with fresh IDs and an `isNew` flag. |

Use `opensOnText` alongside `opensOn` when a program has only announced a month
("the 2027 application launches in January"). The date is stored as the 1st so
the maths works; `opensOnText` carries the real precision, so the UI says
"January 2027" rather than inventing "January 1, 2027".

Re-running with new overrides is safe and order-independent: applying them
incrementally produces byte-identical output to a single clean run.

### Two things the roll gets wrong if you are not careful

**Every free-text field that can carry a year has to be in the bump list.**
`duration` was not, so 13 programs rolled to the 2027 cycle went on describing a
2026 run under "Duration" in the modal — the record half-moved to the new cycle.
If you add a field that can hold a date, add it to the bump list beside `dates`,
`desc`, `note`, `startDate` and `duration`.

**`lastVerified` is the date a fact was checked, not the date the script ran.**
Every override used to stamp `lastVerified = TODAY`, so re-running the script six
months later, with the same updates file and nothing re-checked, moved every
verified program's date to that day — and the modal prints it as "Confirmed
against the program's own materials on <date>". It now takes the entry's own
`lastVerified`, else the updates file's `compiledOn`, and only then today. Set
`compiledOn` to the day you actually gathered the facts.

---

## Analytics

### How it fits together

```
browser (ss-insights.js)
   └─ POST /api/collect  →  api/track.js  →  Supabase `events` table
                                    │
dashboard.html ── GET /api/analytics ┘
```

### Why the file and the endpoint have those names

The tracker used to be `analytics.bundle.js` posting to `/api/track`. Both are
matched by the filter lists that ship with uBlock Origin, Brave and Safari's
content blockers — `analytics*.js` as a filename and `/track` in a request path
are on EasyPrivacy directly. Every reader with a blocker was invisible, and that
does not shrink the visit count evenly: it deletes the more technical part of a
teenage audience specifically. `/api/collect` is a rewrite in `vercel.json`; the
function is still `api/track.js` and still answers on `/api/track`.

### What is counted, and what is not

Each of these was over- or under-counting real visits:

| Was | Now |
|---|---|
| A blocked `localStorage` returned the string `'anon'` as the visitor ID, so every private-window reader shared one ID and the whole group counted as **one** unique visitor | a random per-page ID, so they count once each |
| `sendBeacon` returning `false` (queue over budget) was treated as success and the event dropped | falls back to `keepalive` fetch |
| A prerendered page logged a view nobody saw | held until `prerenderingchange` |
| A back/forward-cache restore logged nothing | logs a pageview with `restored: true` |
| Crawlers, link previewers and uptime monitors counted as visitors | dropped at ingest by user agent, so the events table itself stays clean |
| `Access-Control-Allow-Origin: *` let anyone POST events from any page | cross-origin writes rejected; a missing `Origin` is still accepted, because some browsers omit it on `sendBeacon` |
| Active time stopped at the first tab switch and never resumed | resumes, and `/api/analytics` keeps the **longest** duration per session instead of averaging the partials |
| Visitors were counted from pageview rows alone | counted across every event type — a pageview can be lost while the same visit's clicks and scrolls arrive |

`/api/collect` reaches the function through a rewrite, and a rewrite is a single
point of failure for every number on the dashboard: if it is ever missing or
misconfigured the response is a 404, the browser reports nothing, and tracking
stops site-wide with no symptom at all. So the first event of each page goes by
`fetch` rather than `sendBeacon` — a beacon is fire-and-forget and cannot report
a status — and a 404 or 405 switches the session to `/api/track` and re-sends.
Only those two codes trigger it: they mean the event was definitively not
recorded, so the re-send is a recovery. Anything else, a rejected promise
included, is left alone, because a request that may have been recorded must
never be sent twice.

The bot filter is at ingest, not at read time, so the numbers are right
retroactively too — but only for events recorded after it went in. The dashboard
says so under the lifetime totals rather than leaving it implied.

The tracker also declines to run under automation (`navigator.webdriver`), so a
headless browser pointed at the site records nothing.

`/api/analytics` accepts `?days=7|30|90|365|all` and **always** returns a
`lifetime` block with all-time totals alongside the windowed numbers, so
cumulative views and visits are visible on every range.

### Environment variables (Vercel → Settings → Environment Variables)

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_SERVICE_KEY` | yes | Server-side writes and reads. Never exposed to the browser. |
| `DASHBOARD_PASSWORD` | yes | Gates `/api/analytics`. |
| `SUPABASE_URL` | no | Defaults to the project URL hardcoded in `api/_supabase.js`. |

**`DASHBOARD_PASSWORD` is mandatory.** The endpoint used to enforce it only
`if (pw)`, which meant an unset variable published the entire analytics feed to
anyone who guessed the URL. It now fails closed with `503
dashboard_password_not_configured` rather than serving.

### Durable lifetime storage — run this once

```
Supabase Dashboard → SQL Editor → New query → paste supabase/schema.sql → Run
```

This is optional but recommended. It creates three permanent tables —
`analytics_daily`, `analytics_visitors`, `analytics_sessions` — that accumulate
rather than expire, plus the `summerscope_lifetime()` function the API prefers.

Why it matters:

- **Exact lifetime uniques.** PostgREST cannot express `COUNT(DISTINCT …)`, so
  without the migration the API counts distinct visitors from a capped scan and
  honestly reports the result as a floor. With it, the number is exact.
- **Speed that doesn't decay.** Counting distinct visitors from the raw log gets
  slower every week. A visitor ledger grows with your audience, not your traffic.
- **Survives pruning.** Once a day is rolled up its numbers are fixed. You can
  delete raw events from 2026 and the dashboard still shows 2026.

The script is idempotent, backfills all existing history on first run, and
touches nothing in the `events` table. Everything works without it — the
dashboard just labels its lifetime uniques as a minimum and says why.

### Opening the dashboard

Click the logo five times on the site, enter the admin password, and you land on
`/dashboard.html`.

---

## Local development

```bash
npm install
npm run dev          # serves the static site at localhost:3000
```

The `/api/*` routes need the Vercel runtime — use `vercel dev` to exercise them
locally. Under `npm run dev` the tracker's POSTs to `/api/collect` simply fail,
which is by design: nothing on the page depends on them.

Two things worth knowing when testing the site by hand:

- **The tracker will not run in a headless browser.** It drops
  `navigator.webdriver`, so a Playwright or Puppeteer session records nothing.
  Override that property in an init script if you need to inspect the event
  stream, and capture at the transport layer (spy on `navigator.sendBeacon`) —
  network interception does not see beacons reliably.
- **Scroll milestones fire once per session.** Anything that scrolls the page
  first, including a test runner scrolling an element into view to click it,
  consumes them.

---

## Deploy

Push to `main`; Vercel builds automatically. No build step — it's a static site
plus two serverless functions.

`vercel.json` sets short caching on `styles.css`, `app.js`, `summerscope.js` and
`ss-insights.js` (10 minutes, plus a week of `stale-while-revalidate`) and
`must-revalidate` on the HTML. The assets carry no content hash, so a long
`max-age` would pin a reader to an old `app.js` against a new `index.html`.

---

*Not affiliated with any program listed. Deadlines marked as expected are
carried forward from the previous cycle — always verify on the official site
before applying.*
