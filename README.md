# SummerScope 🎓

The complete database of summer programs, hackathons, and competitions for high school students (grades 9–12), plus a private analytics dashboard.

**Live site:** https://summerscope.vercel.app

---

## Project structure

```
summerscope/
├── index.html                 ← the site (fetches data.json at load)
├── landing.html               ← alternate landing page (same data.json)
├── summerscope.js             ← shared status model + data loader for both pages
├── dashboard.html             ← private analytics dashboard
├── analytics.bundle.js        ← client-side event tracker
├── data.json                  ← all program and event data
├── api/
│   ├── track.js               ← POST endpoint: browser → Supabase
│   ├── analytics.js           ← GET endpoint: aggregated stats + lifetime totals
│   └── _supabase.js           ← shared PostgREST helpers
├── supabase/
│   └── schema.sql             ← durable lifetime storage (run once — see below)
├── scripts/
│   ├── roll-cycle.mjs         ← rolls the database to a new application cycle
│   └── cycle-2027-updates.json← curated facts for the 2027 cycle
└── vercel.json
```

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

`costB` ∈ `Free` · `Under3k` · `3kTo8k` · `Over8k`  ·  `fmt` ∈ `In-Person` · `Online` · `Hybrid`

`closed` is still written for backwards compatibility but **is not read by the
site** — `statusOf()` is the only source of truth.

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

---

## Analytics

### How it fits together

```
browser (analytics.bundle.js)
   └─ POST /api/track      → Supabase `events` table
                                    │
dashboard.html ── GET /api/analytics ┘
```

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
locally.

---

## Deploy

Push to `main`; Vercel builds automatically. No build step — it's a static site
plus two serverless functions.

---

*Not affiliated with any program listed. Deadlines marked as expected are
carried forward from the previous cycle — always verify on the official site
before applying.*
