// Every reference number in contracts/telemetry.md, asserted.
//
// The table in that document is the one the dashboard, the alert thresholds and the
// agent's diagnosis prompt are all built against. If it drifts from what the pages
// actually produce, four components are wrong at once and nobody finds out until the
// demo. So the document does not get to be a claim — it gets to be a test.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extract, computeSignals, classify, recordId, CONFIGS, ROUTE } from '../src/extract.mjs';
import { validate } from '../src/validate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'contracts/record.schema.json'), 'utf8'));
const BASE = 'https://meridian.example/pipeline/';

const signals = (version, config) =>
  computeSignals(
    extract(readFileSync(join(root, 'versions', version, 'pipeline/index.html'), 'utf8'), {
      config,
      baseUrl: BASE,
    }),
    schema
  );

describe('the record contract', () => {
  test('v1 records validate against contracts/record.schema.json', () => {
    const { records } = extract(readFileSync(join(root, 'versions/v1/pipeline/index.html'), 'utf8'), {
      config: CONFIGS.baseline,
      baseUrl: BASE,
    });
    assert.equal(records.length, 20);
    for (const record of records) {
      assert.deepEqual(validate(record, schema), [], `${record.label}: ${validate(record, schema).join('; ')}`);
    }
  });

  test('the top-level shape is what normalizeWebRecords() emits', () => {
    const { records } = extract(readFileSync(join(root, 'versions/v1/pipeline/index.html'), 'utf8'), {
      config: CONFIGS.baseline,
      baseUrl: BASE,
    });
    assert.deepEqual(Object.keys(records[0]).sort(), ['attributes', 'id', 'label', 'sourceUrl']);
    assert.equal(records[0].id, recordId(records[0].sourceUrl, records[0].label));
    assert.match(records[0].id, /^[0-9a-f]{16}$/);
  });

  test('a missed extraction is null, never "" and never absent', () => {
    const { records } = extract(readFileSync(join(root, 'versions/v2/pipeline/index.html'), 'utf8'), {
      config: CONFIGS.baseline,
      baseUrl: BASE,
    });
    const broken = records.filter((r) => r.attributes.phase === null);
    assert.equal(broken.length, 19);
    for (const record of broken) {
      assert.ok('phase' in record.attributes, 'key must be present');
      assert.equal(record.attributes.phase, null, 'value must be null, not ""');
    }
  });
});

describe('reference numbers — baseline scraper', () => {
  test('v1 is healthy', () => {
    const s = signals('v1', CONFIGS.baseline);
    assert.equal(s.rows_returned, 20);
    assert.equal(s.schema_conformance, 1);
    assert.equal(s.field_null_rate.phase, 0);
    assert.deepEqual(s.unmapped_fields_seen, []);
    assert.equal(s.failure_class, 'none');
  });

  test('v2 is the silent failure: rows flat, conformance 0.05, phase null 0.95', () => {
    const s = signals('v2', CONFIGS.baseline);
    assert.equal(s.rows_returned, 20, 'row count must not move — that is the entire point');
    assert.equal(s.schema_conformance, 0.05);
    assert.equal(s.field_null_rate.phase, 0.95);
    assert.deepEqual(s.unmapped_fields_seen, []);
    assert.equal(s.failure_class, 'selector_drift');
    assert.equal(ROUTE[s.failure_class], 'repair');
  });

  test('every field other than phase survives v2 intact', () => {
    const s = signals('v2', CONFIGS.baseline);
    for (const [field, rate] of Object.entries(s.field_null_rate)) {
      if (field !== 'phase') assert.equal(rate, 0, `${field} should not have broken`);
    }
  });

  test('v3 without healing first is ambiguous and escalates', () => {
    const s = signals('v3', CONFIGS.baseline);
    assert.equal(s.rows_returned, 20);
    assert.deepEqual(s.unmapped_fields_seen, ['target']);
    assert.equal(s.failure_class, 'upstream_shape_change');
    assert.equal(ROUTE[s.failure_class], 'escalate');
  });
});

describe('the two-round heal', () => {
  test('the naive heal reaches 0.95 and clears the 0.85 alert while still being wrong', () => {
    const s = signals('v2', CONFIGS.healed_naive);
    assert.equal(s.schema_conformance, 0.95);
    assert.equal(s.field_null_rate.phase, 0.05);
    assert.ok(s.schema_conformance > 0.85, 'the alert would go quiet here — that is the trap');
    assert.equal(s.failure_class, 'none');
  });

  test('the union selector actually fixes it', () => {
    const s = signals('v2', CONFIGS.healed);
    assert.equal(s.schema_conformance, 1);
    assert.equal(s.field_null_rate.phase, 0);
  });

  test('verified means back to the pre-break bar, not above the alert threshold', () => {
    // contracts/telemetry.md: verified <=> conformance_after >= conformance_before_the_break
    const before = signals('v1', CONFIGS.baseline).schema_conformance;
    const naive = signals('v2', CONFIGS.healed_naive).schema_conformance;
    const correct = signals('v2', CONFIGS.healed).schema_conformance;

    assert.equal(naive >= before, false, 'a 0.95 repair must not pass verification');
    assert.equal(correct >= before, true);
  });
});

describe('EVOLVE, once the scraper is healed', () => {
  test('v3 with a healed scraper is a clean schema extension', () => {
    const s = signals('v3', CONFIGS.healed);
    assert.equal(s.rows_returned, 20);
    assert.equal(s.schema_conformance, 1, 'nothing is broken — this is a requirement change');
    assert.deepEqual(s.unmapped_fields_seen, ['target']);
    assert.equal(s.failure_class, 'schema_extension');
    assert.equal(ROUTE[s.failure_class], 'evolve');
  });

  test('an unknown field is not a conformance failure', () => {
    // additionalProperties is true on purpose. A new field must not look like a break.
    const record = {
      id: 'a'.repeat(16),
      label: 'MRD-4471',
      sourceUrl: `${BASE}mrd-4471/`,
      attributes: {
        compound: 'tarvanidazole',
        indication: 'Visceral leishmaniasis',
        modality: 'Small molecule',
        phase: 'Phase 2',
        status: 'Recruiting',
        partner: 'DNDi',
        updated: '2026-06-14',
        target: 'CYP51',
      },
    };
    assert.deepEqual(validate(record, schema), []);
  });
});

describe('the routing table', () => {
  const cases = [
    ['healthy', { rows: 20, conformance: 1, unmapped: [] }, 'none', 'none'],
    ['fields went null', { rows: 20, conformance: 0.05, unmapped: [] }, 'selector_drift', 'repair'],
    ['new field only', { rows: 20, conformance: 1, unmapped: ['target'] }, 'schema_extension', 'evolve'],
    ['both at once', { rows: 20, conformance: 0.05, unmapped: ['target'] }, 'upstream_shape_change', 'escalate'],
    ['rows collapsed', { rows: 4, conformance: 1, unmapped: [], rowsExpectedMin: 18 }, 'row_count_collapse', 'repair'],
    ['nothing came back', { rows: 0, conformance: 0, unmapped: [] }, 'empty_result', 'repair'],
  ];

  for (const [name, input, expectedClass, expectedRoute] of cases) {
    test(`${name} -> ${expectedClass} -> ${expectedRoute}`, () => {
      const cls = classify(input);
      assert.equal(cls, expectedClass);
      assert.equal(ROUTE[cls], expectedRoute);
    });
  }

  test('a broken field plus a new field is never auto-repaired', () => {
    // A moved field and a replaced field are indistinguishable from the signals alone.
    // Guessing here is how a self-healing system quietly corrupts data.
    assert.equal(ROUTE[classify({ rows: 20, conformance: 0.2, unmapped: ['target'] })], 'escalate');
  });
});
