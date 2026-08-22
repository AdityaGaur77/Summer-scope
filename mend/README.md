# Meridian Therapeutics — the controlled break surface

> **Meridian Therapeutics is a fictional company.** It does not exist. No programme,
> compound, trial, phase, or result on this site is real. It was built to be broken on
> purpose so that a data pipeline can be observed failing and repairing. Every page carries
> `noindex, nofollow`, `robots.txt` disallows everything, and every page footer says the same
> thing. The Port catalogue entry sets `controlled: true` and the scrape span sets
> `source.controlled = true`, so the disclosure travels with the data rather than living only
> in this file.
>
> One real substance appears: **miltefosine**, listed as an in-licensed access programme. It
> is real, it is genuinely used for visceral leishmaniasis, and it is in ChEMBL — which is the
> point, because it gives the ChEMBL lookup something to hit next to twenty fictional codes
> that miss. No clinical claim is invented about it; the only fiction is that Meridian
> distributes it.

## What this is for

Mend watches drug-programme data for neglected diseases, which lives on HTML pages rather than
in APIs. When one of those pages is redesigned, a scraper does not usually crash. It returns
**200 OK with the right number of rows and quietly wrong data**. That is the failure worth
detecting, and it is hard to demo against someone else's website because you cannot make them
redesign it on cue.

So this is our website, in three versions.

| | What changed | `rows_returned` | `schema_conformance` | Route |
|---|---|---|---|---|
| **v1** | baseline | 20 | 1.00 | — |
| **v2** | Phase and Status merged into status pills; Partner moved ahead of Indication; new stylesheet | **20** | **0.05** | REPAIR |
| **v3** | Target column added | 20 | 1.00¹ | EVOLVE |

¹ with a healed scraper. See [the ordering note](#the-order-matters).

The row count does not move. That is the entire point.

## The exact diff between versions

Nothing here is hidden — a demo that depends on the audience not knowing what we changed is a
worse demo.

**v1 → v2.** The pipeline table was redesigned:

```html
<!-- v1 -->
<td class="phase">Phase 2</td>
<td class="status" data-status="Recruiting">Recruiting</td>

<!-- v2 -->
<td class="status-cell" data-status="Recruiting">
  <span class="pill pill--stage" data-stage="phase-2">Phase 2</span>
  <span class="pill pill--enroll">Recruiting</span>
</td>
```

Alongside that: a new stylesheet, a rounded scroll shell, restyled header cells, reworded
column labels (`Updated` → `Last update`), the Partner column moved ahead of Indication, and
`<meta name="generator">` bumped from `Meridian Web 2.3.1` to `2.4.0`.

Every row keeps its `data-program`, `data-compound`, `data-indication`, `data-modality`,
`data-status`, `data-partner` and `data-updated` attributes, because real redesigns preserve
the data attributes their own JavaScript depends on. So every field except `phase` keeps
resolving, rows keep parsing, and nothing throws.

`phase` was the one field that only ever existed as display text. That asymmetry is what turns
a routine redesign into a silent failure — and it is the ordinary case, not a contrived one.

**One row is left behind.** `MRD-2210` is discontinued, and its status cell still renders
through the pre-refresh partial, so it still emits `<span class="phase">`. The null rate is
therefore **19/20 = 0.95**, not 1.00. The single phase value a stale scraper can still read
belongs to a programme that was killed in Q1 2026 — data that is worse than missing.

**v2 → v3.** A `Target` column, on the pipeline table and on each programme page. Nothing
else. `unmapped_fields_seen: ["target"]`, conformance untouched.

## Running it

```sh
npm test                       # 47 assertions: the break is what we say it is
npm run site:build             # data/ + templates/ -> versions/v1, v2, v3
npm run site:activate v1       # versions/v1 -> public/
npm run site:serve             # http://localhost:4173
```

No dependencies. Node 18+, nothing to install.

### Shipping the break

```sh
npm run site:activate v2
git commit -am "redesign: merge phase into development status"
git push                       # Vercel redeploys in ~30s
```

The canonical URL `/pipeline` never changes and the scraper config never learns that versions
exist. Reverting is `npm run site:activate v1` and another push.

`versions/` and `public/` are **committed on purpose**. The rendered HTML is the artefact — the
v1→v2 diff in git is what a redesign actually looks like, and that diff is part of the demo.
Rendering is deterministic (no timestamps, no build ids), so a rebuild on unchanged input
produces no diff and `git status` stays a useful check.

### Checking the break by hand

```sh
npm run site:activate v2 && npm run site:serve

curl -s localhost:4173/pipeline/ | grep -c '<tr[^>]*data-program='   # 20  <- flat
curl -s localhost:4173/pipeline/ | grep -c 'class="phase"'           # 1   <- the break
curl -s localhost:4173/pipeline/ | grep -c 'noindex'                 # 1
```

## The numbers, verified

`src/extract.mjs` is a reference extractor — **not** the production scraper, which is Bright
Data's job. It exists so the numbers in [`contracts/telemetry.md`](contracts/telemetry.md) can
be checked by anyone, offline, in a second, and so the agent track has an oracle to test a
proposed heal against before spending a collector run on it.

```
v1 baseline     rows=20 conf=1.00 phaseNull=0.00 unmapped=[]       selector_drift? no    -> none
v2 baseline     rows=20 conf=0.05 phaseNull=0.95 unmapped=[]       selector_drift        -> repair
v2 healed_naive rows=20 conf=0.95 phaseNull=0.05 unmapped=[]       none                  -> none
v2 healed       rows=20 conf=1.00 phaseNull=0.00 unmapped=[]       none                  -> none
v3 healed       rows=20 conf=1.00 phaseNull=0.00 unmapped=[target] schema_extension      -> evolve
v3 baseline     rows=20 conf=0.05 phaseNull=0.95 unmapped=[target] upstream_shape_change -> escalate
```

`test/signals.test.mjs` asserts every one of those numbers, so the telemetry contract is not a
claim about the pages — it is a test of them.

### The heal has two rounds by construction

Because of the leftover archived row:

| selector | phase read | conformance |
|---|---|---|
| baseline `.phase` | 1/20 | 0.05 |
| naive heal `.pill--stage` | 19/20 | **0.95** |
| correct heal `.pill--stage, .phase` | 20/20 | 1.00 |

The naive heal scores **above the 0.85 alert threshold**. The alert clears, the dashboard goes
green, one row in twenty is still wrong. So a repair is not verified by the alert going quiet:

```
verified  ⟺  conformance_after >= conformance_before_the_break
```

An alert threshold is a detector, not an acceptance test. Wiring one up as the other is how a
self-healing system convinces itself it fixed something. This is also why the rejection beat in
the demo has a real reason behind it, rather than being theatre.

### The order matters

v3 builds on v2's redesign. A scraper healed during v2 reads v3 cleanly and reports
`schema_extension` → EVOLVE. An **unhealed** scraper hitting v3 sees a broken field *and* a new
field at once, which is genuinely ambiguous — a moved field and a replaced field look identical
from the signals alone — and routes to `upstream_shape_change` → ESCALATE rather than guessing.

Both behaviours are correct. Only the first is the demo. Rehearse the order.

## Fixture modes

The scaffold's `normal | fail | recover` modes map onto the versions:

| mode | HTML | scraper config |
|---|---|---|
| `normal` | `versions/v1` | `baseline` |
| `fail` | `versions/v2` | `baseline` |
| `recover` | `versions/v2` | `healed` |

`recover` serves **the same bytes** as `fail`. What changed is the scraper, not the page. Worth
saying out loud in the demo — it is the difference between healing and papering over. There are
no separate fixture copies to drift out of sync, because the fixtures *are* `versions/`.

## What is here

```
data/programs.json          20 programmes — the single source of truth
templates/                  layout, shared home + detail, three pipeline renderers, three stylesheets
scripts/                    build.mjs, activate.mjs, serve.mjs — no dependencies
versions/v1 v2 v3           committed rendered HTML, 22 pages each
public/                     committed, deploys, currently v1
src/extract.mjs             reference extractor + signal calculator (the oracle)
src/validate.mjs            ~60-line JSON Schema subset validator, zero deps
contracts/                  record schema, ChangeRequest schema, telemetry contract
port/                       5 blueprints + the release-readiness scorecard
observability/signoz/       dashboard + 3 alert rules
test/                       47 assertions
CONTRACTS.md                the frozen contract — paste into CLAUDE.md at port-over
PITCH.md                    what Mend is and why
```

## Deploying

`vercel.json` is ready: `outputDirectory: "public"`, `cleanUrls`, and an `X-Robots-Tag:
noindex, nofollow` header on everything.

**Deploy this as its own Vercel project.** Bright Data scrapes from its own infrastructure, so
the page has to be publicly reachable — it cannot be served from localhost. That is also why
"push v2" is a real deploy rather than a flag flip, which makes the demo beat more honest, not
less.

## Honest failure modes

- **We authored the break.** Meridian proves the loop works. It cannot prove the loop matters,
  because we chose what broke and when. The live run against DNDi is what carries that claim,
  and it is not optional.
- **`phase` was made breakable.** Every other field carries a data attribute; `phase` does not.
  That is a real pattern — display-only fields are exactly the ones that move in a redesign —
  but we did choose it. Stated here rather than discovered by a judge.
- **The reference extractor is regex-based.** Fine against HTML we generate ourselves; it is
  not what should ever run against DNDi. Bright Data does the real extraction.
- **`src/validate.mjs` implements a subset of JSON Schema** — type, required, properties,
  additionalProperties, minLength, pattern, minimum/maximum, enum, items. No `$ref`, no
  `allOf`/`anyOf`/`oneOf`, `format` is advisory. It covers `record.schema.json` completely and
  would need replacing with ajv for anything richer.
- **The SigNoz dashboard and alert JSON are hand-authored** against the v4 dashboard and
  threshold-rule shapes. They have not been round-tripped through a running SigNoz instance, so
  expect to fix field names on first import.
- **The Port scorecard's `human_approved` rule** expresses "a verified change request is
  related to this source". Port's query DSL for cross-blueprint conditions varies by version;
  treat that rule as intent to be adjusted against the live API rather than as working config.
- **`route` in `data/programs.json` is unused.** It is a spare field, held back for a second
  EVOLVE beat if one is wanted.

## Not in this task

The tracker, the Bright Data collector (still pointed at `example.com`), the agent diagnosis
loop, the Port workflow automation, the SigNoz deployment, and the DNDi and ChEMBL integrations.
All of them build against [`CONTRACTS.md`](CONTRACTS.md), which is frozen here so those four
tracks can run in parallel and integrate early rather than late.
