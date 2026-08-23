/**
 * End-to-end test against a local stand-in for a people-search site.
 *
 * It exercises the real path -- fetch, read fallback, scoring, PII extraction,
 * the ledger, the report and the drafted removal doc -- without sending a single
 * query about a real person anywhere.
 *
 *   node --test privacy-agent/test/integration.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { selectorsOf, validateIdentity } from '../lib/identity.mjs';
import { Reach } from '../lib/reach.mjs';
import { runScan } from '../lib/scan.mjs';
import { renderReport } from '../lib/report.mjs';
import { listFindings, loadLedger, saveLedger, STATUS } from '../lib/ledger.mjs';
import { playbookFor, writeRemovalDoc } from '../lib/removal.mjs';
import { SEVERITY } from '../lib/extract.mjs';

const LISTING = `<!doctype html><html><body>
  <h1>Jane Q. Public</h1>
  <p>Age: 34</p>
  <p>Current address: 42 Elm Street, Springfield, IL 62704</p>
  <p>Phone: (555) 010-1234</p>
  <p>Email: jane@example.com</p>
  <p>Relatives: John Public, Mary Public</p>
  <a href="/report">View full background report</a>
</body></html>`;

const DECOY = `<!doctype html><html><body>
  <h1>Jane Q. Public appointed to the county arts board</h1>
  <p>A resident of Columbus, Ohio, she has served for six years.</p>
</body></html>`;

async function withServer(run) {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url.startsWith('/people/') ? LISTING : DECOY);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    return await run(port);
  } finally {
    server.close();
  }
}

test('a broker listing is found, classified, recorded and turned into a removal doc', async () => {
  await withServer(async (port) => {
    const host = `127.0.0.1:${port}`;
    const identity = validateIdentity({
      consent: { selfScan: true, subjectIsMe: true, acknowledgedAt: '2026-01-01' },
      subject: {
        names: ['Jane Q. Public'],
        emails: ['jane@example.com'],
        phones: ['+1 555 010 1234'],
        locations: [{ city: 'Springfield', region: 'IL' }],
      },
      contact: { email: 'jane@example.com' },
      jurisdiction: 'US-CA',
      scan: { channels: ['brokers'], maxPagesPerRun: 5, minConfidence: 0.45, minGapMs: 0, concurrency: 2 },
    });
    const registry = {
      entries: [
        {
          id: 'localtest',
          name: 'Local Test Broker',
          host,
          type: 'broker',
          searchUrl: `http://${host}/people/{firstLower}-{lastLower}`,
          optOut: { url: `http://${host}/opt-out`, method: 'web-form', requires: ['listing URL'] },
        },
      ],
    };

    const dir = await mkdtemp(join(tmpdir(), 'privacy-agent-'));
    const ledger = await loadLedger(join(dir, 'findings.json'));
    const selectors = selectorsOf(identity);
    const reach = new Reach({ minGapMs: 0, timeoutMs: 15_000 });

    const { stats } = await runScan({ identity, selectors, reach, registry, ledger, options: {} });
    assert.equal(stats.newFindings, 1, 'expected exactly one new finding');

    const [finding] = listFindings(ledger, {});
    assert.equal(finding.status, STATUS.NEW);
    assert.equal(finding.broker, 'localtest');
    assert.equal(finding.severity, SEVERITY.critical, 'address + phone on a broker page is critical');
    assert.ok(finding.confidence > 0.9);
    const exposed = finding.pii.map((p) => p.key);
    for (const key of ['street_address', 'phone_number', 'email_address', 'relatives', 'age']) {
      assert.ok(exposed.includes(key), `missed ${key}`);
    }
    assert.ok(!JSON.stringify(finding).includes('jane@example.com'), 'raw email stored in the ledger');

    await saveLedger(join(dir, 'findings.json'), ledger);
    const reloaded = await loadLedger(join(dir, 'findings.json'));
    assert.equal(Object.keys(reloaded.findings).length, 1, 'ledger did not survive a round trip');

    const report = renderReport({ identity, ledger, registry, capabilities: null });
    assert.match(report, /Do these first/);
    assert.match(report, new RegExp(host.replace('.', '\\.')));
    assert.match(report, /CRITICAL/);

    const outbox = join(dir, 'outbox');
    const path = await writeRemovalDoc(outbox, finding, identity, playbookFor(host, registry));
    const doc = await readFile(path, 'utf8');
    assert.match(doc, /self-serve opt-out/);
    assert.match(doc, new RegExp(`${host}/opt-out`.replace('.', '\\.')));
    assert.equal((await readdir(outbox)).length, 1);
  });
});

test('a second run over the same page updates rather than duplicates', async () => {
  await withServer(async (port) => {
    const host = `127.0.0.1:${port}`;
    const identity = validateIdentity({
      consent: { selfScan: true, subjectIsMe: true, acknowledgedAt: '2026-01-01' },
      subject: { names: ['Jane Q. Public'], phones: ['+1 555 010 1234'] },
      scan: { channels: ['brokers'], maxPagesPerRun: 5, minConfidence: 0.45, minGapMs: 0 },
    });
    const registry = {
      entries: [
        {
          id: 'localtest',
          name: 'Local Test Broker',
          host,
          type: 'broker',
          searchUrl: `http://${host}/people/{firstLower}-{lastLower}`,
          optOut: { url: `http://${host}/opt-out`, method: 'web-form' },
        },
      ],
    };
    const ledger = await loadLedger('/nonexistent/findings.json');
    const selectors = selectorsOf(identity);
    const reach = new Reach({ minGapMs: 0, timeoutMs: 15_000 });
    const opts = { identity, selectors, reach, registry, ledger, options: {} };

    const first = await runScan(opts);
    const second = await runScan(opts);
    assert.equal(first.stats.newFindings, 1);
    assert.equal(second.stats.newFindings, 0, 'the same page was recorded twice');
    assert.equal(Object.keys(ledger.findings).length, 1);
    assert.equal(ledger.runs.length, 2);
  });
});

test('a namesake page is read but not recorded as you', async () => {
  await withServer(async (port) => {
    const host = `127.0.0.1:${port}`;
    const identity = validateIdentity({
      consent: { selfScan: true, subjectIsMe: true, acknowledgedAt: '2026-01-01' },
      subject: { names: ['Jane Q. Public'], locations: [{ city: 'Springfield', region: 'IL' }] },
      scan: { channels: ['brokers'], maxPagesPerRun: 5, minConfidence: 0.45, minGapMs: 0 },
    });
    // /news/ is served the decoy: same name, wrong city, no contact details.
    const registry = {
      entries: [
        { id: 'news', name: 'News', host, type: 'broker', searchUrl: `http://${host}/news/{lastLower}`, optOut: {} },
      ],
    };
    const ledger = await loadLedger('/nonexistent/findings.json');
    const { stats } = await runScan({
      identity,
      selectors: selectorsOf(identity),
      reach: new Reach({ minGapMs: 0, timeoutMs: 15_000 }),
      registry,
      ledger,
      options: {},
    });
    assert.equal(stats.pagesRead, 1, 'the page should still have been fetched');
    assert.equal(stats.matched, 0, 'a namesake in another state was recorded as the subject');
  });
});
