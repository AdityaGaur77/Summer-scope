# Mend — frozen contracts

Paste this file into `CLAUDE.md` when `mend/` is dropped into the Zero Downtime repo. Everything
downstream builds against these names. They were frozen before any of it was written, which is
what lets the telemetry, Port, scraper and app tracks run in parallel and integrate at 13:00
rather than 16:00.

Four things are frozen:

| What | Where | Why it matters |
|---|---|---|
| Normalized record | [`contracts/record.schema.json`](contracts/record.schema.json) | Conformance is measured against it |
| Span attributes + metrics | [`contracts/telemetry.md`](contracts/telemetry.md) | Dashboards and alerts key off these exact names |
| `failure_class` → route | [`contracts/telemetry.md`](contracts/telemetry.md#failure_class--route) | The agent routes from this table, not from judgement |
| ChangeRequest payload | [`contracts/change-request.schema.json`](contracts/change-request.schema.json) | SigNoz writes it, Port stores it, the agent reads it |

## The record

Top-level shape is exactly `normalizeWebRecords()`'s output, so `src/records.mjs` consumes
Meridian records with no change:

```json
{
  "id": "9f2c1ab77e40d3b5",
  "label": "MRD-4471",
  "sourceUrl": "https://<host>/pipeline/mrd-4471/",
  "attributes": {
    "compound": "tarvanidazole",
    "indication": "Visceral leishmaniasis",
    "modality": "Small molecule",
    "phase": "Phase 2",
    "status": "Recruiting",
    "partner": "DNDi",
    "updated": "2026-06-14"
  }
}
```

`id` is `sha256(sourceUrl + "\0" + label)` truncated to 16 hex chars, per the scaffold.

Two rules that carry the whole demo:

1. **A missed extraction emits `null`.** Never omit the key, never emit `""`. `null` fails the
   schema cleanly and is countable; the other two hide the failure.
2. **Unknown attribute keys are not conformance failures.** `additionalProperties` is `true` on
   purpose. A new field is a requirement change, reported via `unmapped_fields_seen` and routed
   to EVOLVE — it must not look like a break.

## The one-screen version of the telemetry

```
run.id  source.id  source.url  source.controlled  source.generator
scraper.id  scraper.config_version  schema.id  schema.version
rows_returned  rows_expected_min  schema_conformance  unmapped_fields_seen
failure_class  mend.route

mend.rows_returned · mend.schema_conformance · mend.field_null_rate{field}
mend.unmapped_fields{field} · mend.run_duration_ms · mend.mttr_seconds
```

`rows_returned` counts rows **matched**, not rows **valid**. That distinction is the demo:
during a silent failure the first stays flat while the second collapses.

Alert on `schema_conformance`, never on error rate. A broken run here returns 200 OK.

## Source registry

| id | Controlled | Has API | Role |
|---|---|---|---|
| `meridian` | **yes** | no | Our page. Deterministic break. v1 baseline, v2 moves phase, v3 adds target |
| `dndi` | no | no | The real long-tail source. Canonical neglected-disease portfolio, HTML only |
| `<small biotech>` | no | no | Redesigned every funding round — where the heal loop earns its keep |
| `chembl` | no | **yes** | One lookup: scraped compound has no entry → flag `long-tail-only` |
| `opentargets` | no | **yes** | Optional. "Is anyone targeting this disease at all?" |

`controlled: true` travels in the span attributes and in the Port entity, not only in the README.
The disclosure is part of the data.
