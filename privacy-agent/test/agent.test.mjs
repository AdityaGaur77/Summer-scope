/**
 * Unit tests for the parts where being wrong is expensive: deciding a page is
 * about you, deciding how bad the exposure is, and remembering what happened.
 *
 *   node --test privacy-agent/test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { selectorsOf, validateIdentity, IdentityError } from '../lib/identity.mjs';
import { redact } from '../lib/util.mjs';
import { scoreDocument } from '../lib/match.mjs';
import { extractPii, SEVERITY } from '../lib/extract.mjs';
import { buildQueryPlan } from '../lib/plan.mjs';
import { draftLetter, playbookFor } from '../lib/removal.mjs';
import { loadLedger, markGone, setStatus, STATUS, upsertFinding } from '../lib/ledger.mjs';

const IDENTITY = validateIdentity({
  consent: { selfScan: true, subjectIsMe: true, acknowledgedAt: '2026-01-01' },
  subject: {
    names: ['Jane Q. Public'],
    aliases: ['janeqp'],
    emails: ['jane@example.com'],
    phones: ['+1 555 010 1234'],
    locations: [{ city: 'Springfield', region: 'IL' }],
    employers: ['Example Corp'],
  },
  contact: { email: 'jane@example.com' },
  jurisdiction: 'US-CA',
});
const SELECTORS = selectorsOf(IDENTITY);

test('consent gate rejects an identity that does not claim to be self-scanned', () => {
  assert.throws(
    () => validateIdentity({ consent: { selfScan: true }, subject: { names: ['Someone Else'] } }),
    IdentityError,
  );
});

test('a namesake alone stays below the default confidence threshold', () => {
  const page = 'Jane Q. Public was appointed to the board of a company in Ohio last spring.';
  const { confidence } = scoreDocument(page, SELECTORS);
  assert.ok(confidence <= 0.35, `expected a capped score for a bare name match, got ${confidence}`);
  assert.ok(confidence < IDENTITY.scan.minConfidence);
});

test('name plus city plus phone reads as a confident match', () => {
  const page = `Jane Q. Public, Springfield, IL. Phone: (555) 010-1234. Age: 34.`;
  const { confidence, hits } = scoreDocument(page, SELECTORS);
  assert.ok(confidence > 0.9, `expected high confidence, got ${confidence}`);
  assert.ok(hits.some((h) => h.type === 'phone'));
});

test('phone matching ignores formatting', () => {
  for (const form of ['555.010.1234', '+1 (555) 010-1234', '15550101234']) {
    const { hits } = scoreDocument(`contact ${form} today`, SELECTORS);
    assert.ok(hits.some((h) => h.type === 'phone'), `did not match ${form}`);
  }
});

test('a handle inside a longer word is not a match', () => {
  const { hits } = scoreDocument('see also janeqpublicity-agency for details', SELECTORS);
  assert.equal(hits.filter((h) => h.type === 'username').length, 0);
});

test('"Public, Jane" listing order still matches the name', () => {
  const { hits } = scoreDocument('Public, Jane -- Springfield IL', SELECTORS);
  assert.ok(hits.some((h) => h.type === 'name'));
});

test('address plus phone is escalated to critical', () => {
  const page = 'Lives at 42 Elm Street, Springfield IL. Phone (555) 010-1234. Relatives: John Public.';
  const pii = extractPii(page);
  assert.equal(pii.severity, SEVERITY.critical);
  assert.ok(pii.categories.some((c) => c.key === 'street_address'));
});

test('a broker page is high severity even when the preview shows almost nothing', () => {
  const pii = extractPii('Jane Q. Public - view full report', { isBroker: true });
  assert.ok(pii.severity >= SEVERITY.high);
});

test('extracted samples never carry the raw value for sensitive categories', () => {
  const pii = extractPii('Email: jane@example.com');
  const email = pii.categories.find((c) => c.key === 'email_address');
  assert.ok(email);
  assert.ok(!email.sample.includes('jane@example.com'), 'raw email leaked into the sample');
});

test('redaction survives lowercased evidence snippets', () => {
  // Stored context is normalized to lower case, so a capitalized-only address
  // pattern would quietly pass the address straight through into the report.
  const lowered = 'current address: 42 elm street, springfield, il 62704 phone: (555) 010-1234';
  const out = redact(lowered);
  assert.ok(!out.includes('42 elm street'), `address leaked: ${out}`);
  assert.ok(!out.includes('555) 010-1234'), `phone leaked: ${out}`);
  assert.ok(!redact('Lives at 42 Elm Street, Springfield IL').includes('42 Elm Street'));
  assert.match(redact('call 555.010.1234'), /\[phone \.\.\.34\]/);
});

test('the plan puts uniquely-identifying selectors before name sweeps', () => {
  const plan = buildQueryPlan(IDENTITY, SELECTORS, { channels: ['web', 'github'], brokers: [] });
  assert.equal(plan[0].priority, 1);
  const firstNameOnly = plan.findIndex((t) => t.priority === 3);
  const lastPriorityOne = plan.map((t) => t.priority).lastIndexOf(1);
  assert.ok(lastPriorityOne < firstNameOnly);
});

test('broker sweep builds one listing URL per known pattern', () => {
  const brokers = [
    { id: 'demo', name: 'Demo', host: 'demo.example', type: 'broker', searchUrl: 'https://demo.example/{first}-{last}' },
  ];
  const plan = buildQueryPlan(IDENTITY, SELECTORS, { channels: ['brokers'], brokers });
  const fetches = plan.filter((t) => t.kind === 'fetch');
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].url, 'https://demo.example/Jane-Public');
});

test('ledger records discovery, removal, and reappearance as distinct events', async () => {
  const ledger = await loadLedger('/nonexistent/findings.json');
  const candidate = {
    url: 'https://demo.example/jane-public',
    channel: 'brokers',
    confidence: 0.9,
    severity: SEVERITY.high,
    severityName: 'high',
    pii: [],
    hits: [{ type: 'phone', value: '+1 555 010 1234', count: 1, context: 'phone (555) 010-1234' }],
  };
  const first = upsertFinding(ledger, candidate, { runId: 'r1' });
  assert.equal(first.isNew, true);
  assert.equal(first.finding.status, STATUS.NEW);

  setStatus(ledger, first.finding.id, STATUS.REQUESTED, { requestedAt: new Date().toISOString() });
  markGone(ledger, first.finding.id);
  assert.equal(ledger.findings[first.finding.id].status, STATUS.REMOVED);

  const again = upsertFinding(ledger, candidate, { runId: 'r2' });
  assert.equal(again.reappeared, true);
  assert.equal(again.finding.status, STATUS.REAPPEARED);
});

test('stored evidence is redacted, so the ledger is not a second copy of the leak', async () => {
  const ledger = await loadLedger('/nonexistent/findings.json');
  const { finding } = upsertFinding(ledger, {
    url: 'https://demo.example/x',
    channel: 'web',
    confidence: 0.8,
    severity: SEVERITY.medium,
    severityName: 'medium',
    hits: [{ type: 'email', value: 'jane@example.com', count: 1, context: 'reach me at jane@example.com' }],
  });
  const blob = JSON.stringify(finding);
  assert.ok(!blob.includes('jane@example.com'), 'raw email persisted to the ledger');
});

test('the drafted letter cites the jurisdiction it was asked for', () => {
  const finding = { url: 'https://demo.example/x', host: 'demo.example', pii: [{ label: 'Home address' }] };
  const ca = draftLetter(finding, IDENTITY, { jurisdiction: 'US-CA' });
  assert.match(ca.body, /California Consumer Privacy Act/);
  assert.match(ca.body, /45 days/);
  const eu = draftLetter(finding, IDENTITY, { jurisdiction: 'EU' });
  assert.match(eu.body, /GDPR Articles 17/);
  assert.match(eu.body, /30 days/);
});

test('playbook lookup matches subdomains of a known broker', async () => {
  const registry = { entries: [{ id: 'demo', host: 'demo.example', type: 'broker', optOut: { url: 'https://demo.example/opt-out' } }] };
  assert.equal(playbookFor('www2.demo.example', registry)?.id, 'demo');
  assert.equal(playbookFor('notdemo.example', registry), null);
});
