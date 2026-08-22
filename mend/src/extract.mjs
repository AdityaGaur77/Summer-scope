// Reference extractor and signal calculator.
//
// This is NOT the production scraper — Bright Data runs that. This exists so the
// numbers in contracts/telemetry.md can be verified by anyone, offline, in a second,
// and so the agent track has an oracle to check a proposed heal against before
// spending a collector run on it.
//
// Three configs, which is the whole story:
//
//   baseline      what shipped against v1. Reads phase from .phase
//   healed_naive  what an agent proposes after seeing v2's pills. Reads .pill--stage
//   healed        what actually works. Reads .pill--stage, falling back to .phase
//
// healed_naive gets to 0.95 conformance and looks fixed. That is the trap, and it is
// there on purpose — one archived row on Meridian still renders the old partial.

import { createHash } from 'node:crypto';
import { validate } from './validate.mjs';

const ROW_RE = /<tr\b[^>]*\bdata-program="([^"]*)"[^>]*>([\s\S]*?)<\/tr>/g;

const attr = (name) => (row) => {
  const m = row.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
};

/** Text content of the first element carrying class="<name>". */
const classText = (name) => (row) => {
  const m = row.match(new RegExp(`class="${name}"[^>]*>([^<]*)<`));
  return m ? m[1].trim() || null : null;
};

/** Text of the first .pill--stage span. */
const stagePillText = (row) => {
  const m = row.match(/class="pill pill--stage"[^>]*>([^<]*)</);
  return m ? m[1].trim() || null : null;
};

const firstOf =
  (...readers) =>
  (row) => {
    for (const read of readers) {
      const value = read(row);
      if (value != null) return value;
    }
    return null;
  };

const COMMON = {
  compound: attr('data-compound'),
  indication: attr('data-indication'),
  modality: attr('data-modality'),
  status: attr('data-status'),
  partner: attr('data-partner'),
  updated: attr('data-updated'),
};

export const CONFIGS = {
  baseline: { version: '2026-05-02.1', fields: { ...COMMON, phase: classText('phase') } },
  healed_naive: { version: '2026-08-19.1', fields: { ...COMMON, phase: stagePillText } },
  healed: { version: '2026-08-19.2', fields: { ...COMMON, phase: firstOf(stagePillText, classText('phase')) } },
};

/** Every attribute key the row actually publishes, mapped or not. Drives unmapped_fields_seen. */
function observedKeys(row) {
  const keys = new Set();
  for (const m of row.matchAll(/\bdata-([a-z0-9-]+)="/g)) {
    const key = m[1];
    if (key !== 'program' && key !== 'stage') keys.add(key);
  }
  return keys;
}

export function recordId(sourceUrl, label) {
  return createHash('sha256').update(`${sourceUrl}\0${label}`).digest('hex').slice(0, 16);
}

/**
 * Parse a pipeline page into normalized records.
 * A field the config cannot find is emitted as null — never omitted, never "".
 * That rule is what makes a silent failure countable.
 */
export function extract(html, { config = CONFIGS.baseline, baseUrl } = {}) {
  const records = [];
  const seenKeys = new Set();

  for (const [, label, row] of html.matchAll(ROW_RE)) {
    const href = row.match(/href="([^"]*)"/)?.[1] ?? '';
    const sourceUrl = new URL(href, baseUrl).toString();

    const attributes = {};
    for (const [field, read] of Object.entries(config.fields)) attributes[field] = read(row);
    for (const key of observedKeys(row)) seenKeys.add(key);

    records.push({ id: recordId(sourceUrl, label), label, sourceUrl, attributes });
  }

  return { records, observedKeys: seenKeys };
}

/** Turn an extraction into the numbers contracts/telemetry.md names. */
export function computeSignals({ records, observedKeys }, schema, { rowsExpectedMin = 0, previous = null } = {}) {
  const rows = records.length;
  const declared = new Set(Object.keys(schema.properties.attributes.properties));
  const mapped = Object.keys(records[0]?.attributes ?? {});

  const valid = records.filter((r) => validate(r, schema).length === 0).length;
  const conformance = rows === 0 ? 0 : valid / rows;

  const fieldNullRate = {};
  for (const field of mapped) {
    const nulls = records.filter((r) => r.attributes[field] == null).length;
    fieldNullRate[field] = rows === 0 ? 0 : nulls / rows;
  }

  const unmapped = [...observedKeys].filter((k) => !declared.has(k)).sort();

  return {
    rows_returned: rows,
    schema_conformance: conformance,
    field_null_rate: fieldNullRate,
    unmapped_fields_seen: unmapped,
    failure_class: classify({ rows, conformance, unmapped, rowsExpectedMin, previous }),
  };
}

/** The routing table from contracts/telemetry.md, in code. Order matters. */
export function classify({ rows, conformance, unmapped, rowsExpectedMin = 0, previous = null }) {
  if (rows === 0) return 'empty_result';

  const degraded = conformance < 0.85;
  const grew = unmapped.length > 0;

  // Both at once is genuinely ambiguous — a moved field and a replaced field look
  // identical from here. Escalate rather than guess.
  if (degraded && grew) return 'upstream_shape_change';
  if (degraded) return 'selector_drift';
  if (grew) return 'schema_extension';
  if (rowsExpectedMin && rows < rowsExpectedMin) return 'row_count_collapse';

  void previous;
  return 'none';
}

export const ROUTE = {
  none: 'none',
  selector_drift: 'repair',
  row_count_collapse: 'repair',
  empty_result: 'repair',
  schema_extension: 'evolve',
  fetch_error: 'escalate',
  upstream_shape_change: 'escalate',
};
