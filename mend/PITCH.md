# Mend

**A self-healing intelligence factory for the long tail of biotech.**

---

## The problem

Drug-program data for neglected diseases and small biotechs lives on web pages, not APIs. Pages
change, scrapers break, and the information quietly goes stale. Claude Science pulls from 60+
structured databases; none of them see this long tail.

Nobody maintains these scrapers because the diseases aren't profitable enough to justify a human
babysitting them. **The information is neglected because the diseases are.**

## The insight

Everyone's break-and-heal demo fails loudly — 12 rows become 0.

Real pipelines don't fail like that. They return 200 OK with the right row count and quietly
wrong data. A phase field that used to say "Phase 2" now says nothing, and the row is still
there.

**We detect the silent failure. Rows flat, conformance falling.** That contrast on the dashboard
is the pitch.

## The factory

Every run emits `schema_conformance`, `field_null_rate`, `rows_returned`,
`unmapped_fields_seen`, `failure_class`. SigNoz alerts on conformance, not on errors. The alert
opens a change request in Port. **Nobody files the ticket — the telemetry does.**

Two paths, routed by the agent from the trace:

**REPAIR** — conformance drops. The agent diagnoses ("phase null in 95% of rows, rows_returned
unchanged at 20, so the page still lists programs and the selector moved"), heals via `bdata`,
re-runs, re-validates.

**EVOLVE** — an unmapped field appears. Not a break, a requirement change. The factory extends
the schema, updates the scraper, adds the UI column, generates a test, opens a PR.

A third path exists and matters: when conformance drops *and* a new field appears at the same
time, a moved field and a replaced field are indistinguishable from the signals alone. That
routes to **ESCALATE**, not to a guess. Guessing there is how a self-healing system quietly
corrupts data.

### Safeties

- Degraded data is blocked from release while the source is unhealthy.
- Port scorecard as interlock — ✓ schema ✓ scraper ✓ tests ✗ human approval.
- **Never trust "repair succeeded"; measure it.** And measure it against the pre-break baseline,
  not against the alert threshold — a repair that clears the alert and is still wrong is the
  specific failure this system exists to prevent, so we built one into the demo deliberately.

## Sources — five, not eleven

| Source | Role |
|---|---|
| **Meridian Therapeutics** (ours) | Controlled biotech pipeline page. v1 baseline, v2 moves the phase field, v3 adds a target column. Deterministic break |
| **DNDi** | The real long-tail source. Canonical neglected-disease portfolio, HTML only. Verify before leaving |
| **One small biotech** | Redesigned every funding round — where the heal loop earns its keep |
| **ChEMBL** | One lookup: scraped compound has no entry → flag as `long-tail-only` |
| **Open Targets** | Optional. "Is anyone targeting this disease at all?" |

### Why those two, specifically

**Open Targets** — disease → gene target associations. Works for Chagas, leishmaniasis, COPD,
allergic asthma. Good for "is anyone targeting this?"

**ChEMBL** — compound and bioactivity data. Lets us cross-check scraped compound names (e.g.
DNDI-6148) against known chemistry.

### Future sources

BoltzAPI · Owkin · LatchBio · bioRxiv · InductiveBio · PubMed · BioSkepsis · Synapse.org

These go in the README under future sources. **They have APIs, which undercuts the thesis if we
scrape them.** The sources that actually matter aren't on that list — DNDi, MMV, GARDP, and two
or three small biotech pipeline pages. Those are the messy, no-API, redesigned-quarterly targets
where Bright Data earns its place and the heal loop has real work. That's a five-line list, and
it's the only one the rubric touches.

## Sponsors

- **SigNoz** — sensor, trigger, verifier. Kill it and nothing starts.
- **Port** — brief, catalog, change requests, approval gate, audit trail.
- **Bright Data** — terminal-only `bdata`, config in `CLAUDE.md`, heal as actuator.

## The demo

1. Tracker working against Meridian.
2. Push v2 — phase moves. **Say nothing.**
3. Dashboard: rows flat at 20, conformance falling.
4. Agent diagnoses and proposes. **Human rejects it.** The factory escalates instead of shipping
   bad data.
5. Second proposal. Approve. Data returns. MTTR on screen.
6. ChEMBL beat — scraped compound, no entry, flagged.
7. **"Run it again"** — point the factory at DNDi live, unrehearsed, no code written. Say so on
   camera: *"that was our page so the failure is reproducible; this is DNDi's, live, and I
   haven't run it today."*

The rejection in step 4 is not theatre. Meridian leaves one archived row rendering through the
old markup, so the obvious repair reaches 0.95 conformance — above the alert threshold, dashboard
green, one row in twenty still wrong. There is a real reason to turn it down.

Step 2 is a real deploy. Bright Data scrapes from its own infrastructure, so Meridian has to be
publicly reachable — the break ships as a git push and a ~30s redeploy, not as a flag flip. The
canonical `/pipeline` URL never changes and the scraper config never learns that versions exist.

## Disclosure

Meridian is ours and we say so — in the README, in the Port catalogue
(`controlled: true`), and in the span attributes (`source.controlled = true`). The disclosure
travels with the data, not just the docs. Every page is `noindex`, `robots.txt` disallows
everything, and every footer states that the company is fictional.

This is a strength, not a liability. A controlled page proves the loop **works**; it cannot prove
the loop **matters**, because we chose what broke and when. Being explicit about that is what
makes the live DNDi run in step 7 mean something — and it is why that run is required scope
rather than a stretch goal.

## Execution

**Contracts frozen in the first 30 minutes** — span attribute names, ChangeRequest payload shape,
JSON Schema of record. Written into `CLAUDE.md`. *(Done: see [`CONTRACTS.md`](CONTRACTS.md).)*

**Integrate at 13:00, not 16:00.** Ugly end-to-end pass with stubs. If the seam holds, four hours
to make each piece good.

**Split four ways:**
- telemetry spine + dashboards
- Port modeling + workflows
- Bright Data scrapers + the three-version page
- app + EVOLVE PR path

Commit as you go. Commit real run artifacts. README with an honest failure-modes section that
discloses the controlled page.
