# Telemetry contract

Frozen. Everything downstream — the tracker, the SigNoz dashboard, the alert rules, the
agent's diagnosis prompt, the Port change requests — reads these names. Changing one is a
breaking change to four components at once, so change it now or not at all.

`run.id` propagates across API → workflow → source/scrape → retry → logs → metrics, per the
scaffold's existing convention in `CODEX.md`.

## Span attributes

Set on the scrape span (`mend.scrape`), one span per source per run.

| Attribute | Type | Notes |
|---|---|---|
| `run.id` | string | Shared across every signal in the run. |
| `source.id` | string | `meridian`, `dndi`, … |
| `source.url` | string | Canonical page URL. Never version-qualified. |
| `source.controlled` | bool | `true` for Meridian. We broke it ourselves and the telemetry says so. |
| `source.generator` | string | The page's `<meta name="generator">`, when it publishes one. |
| `scraper.id` | string | Bright Data collector id. |
| `scraper.config_version` | string | Bumped on every heal. `2026-08-22.1`. |
| `schema.id` | string | `meridian.program`. |
| `schema.version` | int | `1`. Bumped by EVOLVE, never by REPAIR. |
| `rows_returned` | int | Row elements **matched**, before validation. |
| `rows_expected_min` | int | Floor from the last N healthy runs. |
| `schema_conformance` | double | 0–1. |
| `unmapped_fields_seen` | string[] | Observed attribute keys not declared in the schema. |
| `failure_class` | enum | See below. |
| `mend.route` | enum | `none` \| `repair` \| `evolve` \| `escalate`. |

`field_null_rate` is **not** a span attribute — it is per-field and would explode the
attribute set. It ships as a metric with a `field` label.

## Metrics

| Metric | Kind | Labels |
|---|---|---|
| `mend.rows_returned` | gauge | `source.id` |
| `mend.schema_conformance` | gauge | `source.id`, `schema.id` |
| `mend.field_null_rate` | gauge | `source.id`, `field` |
| `mend.unmapped_fields` | gauge | `source.id`, `field` |
| `mend.run_duration_ms` | histogram | `source.id` |
| `mend.mttr_seconds` | gauge | `source.id` — set once a repair verifies |

## How the numbers are computed

```
rows_returned      = count of row elements matched by the row selector
                     (matched, NOT valid — this is what stays flat during a silent failure)

schema_conformance = records passing contracts/record.schema.json / rows_returned

field_null_rate[f] = records where attributes[f] is null / rows_returned

unmapped_fields_seen = union(observed attribute keys) − declared schema property keys
```

**The extractor must emit `null`, never omit the key and never emit `""`.** A missing key
looks like a schema change; an empty string can pass a lazy validator. `null` fails
`record.schema.json` cleanly and is countable. This one rule is what makes the silent
failure visible.

## failure_class → route

| Class | Signal | Route |
|---|---|---|
| `none` | conformance 1.0, no new fields | — |
| `selector_drift` | rows flat, conformance down, no new fields | REPAIR |
| `schema_extension` | rows flat, conformance fine, new fields present | EVOLVE |
| `row_count_collapse` | `0 < rows < rows_expected_min` | REPAIR |
| `empty_result` | `rows == 0` | REPAIR — the loud failure, present as a guard, not the demo |
| `fetch_error` | non-2xx, timeout, blocked | RETRY, then ESCALATE |
| `upstream_shape_change` | conformance down **and** new fields | **ESCALATE** |

`upstream_shape_change` is deliberately not auto-repairable. When the page both broke a field
and grew a new one, there is no way to tell a moved field from a replaced one without a human
looking. Guessing there is how a self-healing system quietly corrupts data.

## Alerts

1. `schema_conformance < 0.85` for 2 consecutive runs → open a `REPAIR` ChangeRequest.
2. `unmapped_fields > 0` → open an `EVOLVE` ChangeRequest.
3. `rows_returned == 0` → page immediately. Present as a guard; not the demo path.

Note what is **not** in this list: error rate, HTTP status, exception count. A run that
returns 200 OK with 20 rows and no phase field trips none of them, which is the entire
argument.

## Reference numbers from the controlled source

With the baseline scraper config against Meridian:

| | v1 | v2 | v3 |
|---|---|---|---|
| `rows_returned` | 20 | 20 | 20 |
| `schema_conformance` | 1.00 | 0.05 | 0.05 |
| `field_null_rate{phase}` | 0.00 | 0.95 | 0.95 |
| `unmapped_fields_seen` | — | — | `["target"]` |
| `failure_class` | `none` | `selector_drift` | `upstream_shape_change`¹ |

¹ Only if v3 is reached without healing first. In the intended demo order the scraper is
healed during v2, so by v3 conformance is back to 1.00 and the class is `schema_extension`.
That ordering dependency is real and worth rehearsing.

### The heal has two rounds by construction

One archived row (`MRD-2210`) still renders through the pre-refresh partial and emits
`<span class="phase">`. So:

- baseline selector `.phase` → 1/20 → conformance 0.05
- naive heal `.pill--stage` → 19/20 → conformance **0.95**, not 1.00
- correct heal `.pill--stage, .phase` → 20/20 → conformance 1.00

A repair that stops at 0.95 looks fixed on a coarse dashboard and is not. Verification is
supposed to catch it, and the rejection beat in the demo has a real reason behind it.

### What "verified" has to mean

The naive heal scores 0.95, which is **above the 0.85 alert threshold**. The alert clears. The
dashboard goes green. One row in twenty is still wrong.

So a repair is not verified by the alert going quiet:

```
verification.verified  ⟺  conformance_after >= conformance_before_the_break
                          AND field_null_rate_after[f] <= field_null_rate_before[f] for every f
```

Not `conformance_after > threshold`. Not `alert.state == inactive`. The pre-break run is the bar,
and it is stored on the source as `last_conformance` while the source is healthy precisely so
there is something to compare against later.

An alert threshold is a detector. It is not an acceptance test, and wiring one up as the other is
how a self-healing system convinces itself it fixed something.
