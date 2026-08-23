/**
 * Turning findings into removals.
 *
 * Two routes exist and they are not interchangeable. Most people-search sites
 * have a self-serve opt-out form, which is faster than any letter -- for those
 * this module emits a checklist with the exact URL and what to have ready.
 * Where there is no form, or the form is a dead end, it drafts a statutory
 * deletion request naming the right law.
 *
 * Nothing here sends anything. Drafts land in the outbox for you to read, edit
 * and send yourself, from your own address.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nowIso, readJson, writeText } from './util.mjs';
import { primaryLocation } from './identity.mjs';
import { SEVERITY_NAME } from './extract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REGISTRY_PATH = join(HERE, '..', 'data', 'brokers.json');

export async function loadRegistry(path = REGISTRY_PATH) {
  return readJson(path);
}

export const brokerEntries = (registry) => registry.entries.filter((e) => e.type === 'broker');

/** Match a finding's host to a registry entry, allowing subdomains. */
export function playbookFor(host, registry) {
  if (!host) return null;
  return (
    registry.entries.find((e) => host === e.host || host.endsWith(`.${e.host}`)) || null
  );
}

const LAWS = {
  'US-CA': {
    name: 'California Consumer Privacy Act (CCPA/CPRA)',
    cite: 'Cal. Civ. Code sections 1798.105 (deletion) and 1798.120 (opt-out of sale/sharing)',
    deadlineDays: 45,
  },
  'US-CO': { name: 'Colorado Privacy Act', cite: 'C.R.S. section 6-1-1306', deadlineDays: 45 },
  'US-VA': { name: 'Virginia CDPA', cite: 'Va. Code section 59.1-577', deadlineDays: 45 },
  'US-CT': { name: 'Connecticut Data Privacy Act', cite: 'Conn. Gen. Stat. section 42-518', deadlineDays: 45 },
  'US-TX': { name: 'Texas Data Privacy and Security Act', cite: 'Tex. Bus. & Com. Code section 541.051', deadlineDays: 45 },
  EU: { name: 'General Data Protection Regulation', cite: 'GDPR Articles 17 (erasure) and 21 (objection)', deadlineDays: 30 },
  UK: { name: 'UK GDPR', cite: 'UK GDPR Articles 17 and 21', deadlineDays: 30 },
  US: {
    name: 'applicable state privacy law',
    cite: 'your state consumer privacy statute, and the site’s own published privacy policy',
    deadlineDays: 45,
  },
};

export const lawFor = (jurisdiction) => LAWS[jurisdiction] || LAWS[String(jurisdiction).split('-')[0]] || LAWS.US;

function subjectBlock(identity) {
  const s = identity.subject;
  const lines = [];
  if (s.names?.length) lines.push(`- Full name: ${s.names[0]}`);
  const loc = primaryLocation(identity);
  if (loc) lines.push(`- City/State: ${loc}`);
  if (identity.contact?.email) lines.push(`- Reply address: ${identity.contact.email}`);
  return lines.join('\n');
}

/**
 * Draft a statutory deletion request. The identifying details stay deliberately
 * thin: a broker needs enough to find the record, and handing over more than
 * that just enriches the profile you are trying to delete.
 */
export function draftLetter(finding, identity, { jurisdiction = identity.jurisdiction } = {}) {
  const law = lawFor(jurisdiction);
  const site = finding.host || 'your website';
  const exposed = (finding.pii || []).map((p) => p.label).join(', ') || 'my personal information';
  const to = finding.removal?.email || `privacy@${finding.host}`;
  const subject = `Request to delete personal information - ${identity.subject.names?.[0] || 'data subject request'}`;
  const body = `To the privacy team at ${site},

I am the data subject identified below. I am writing to request that you delete
my personal information and stop selling or sharing it, under ${law.name}
(${law.cite}).

The page in question:
  ${finding.url}

It publishes ${exposed}.

Subject details, provided only so you can locate the record:
${subjectBlock(identity)}

I request that you:
  1. Delete my personal information from your records and from this page.
  2. Stop selling or sharing my personal information with third parties.
  3. Direct any service providers or downstream recipients to do the same.
  4. Confirm in writing what you deleted and which sources supplied it.

Please confirm within ${law.deadlineDays} days. If you need to verify my identity,
tell me the minimum you require and I will supply that and nothing further --
please do not create a new record or account from this request, and do not use
the details above for any purpose other than processing it.

Regards,
${identity.subject.names?.[0] || ''}
${identity.contact?.email || ''}
`;
  return { to, subject, body, law: law.name, deadlineDays: law.deadlineDays };
}

/** Formats one outbox file: either form instructions or an email draft. */
export function renderRemovalDoc(finding, identity, playbook) {
  const header = [
    '---',
    `finding: ${finding.id}`,
    `url: ${finding.url}`,
    `host: ${finding.host}`,
    `severity: ${SEVERITY_NAME[finding.severity] || finding.severity}`,
    `confidence: ${finding.confidence}`,
    `drafted: ${nowIso()}`,
    '---',
    '',
  ].join('\n');

  const exposure = (finding.pii || []).length
    ? (finding.pii || []).map((p) => `- ${p.label}${p.count > 1 ? ` (x${p.count})` : ''}`).join('\n')
    : '- (not classified -- open the page and check before you send anything)';

  if (playbook && playbook.optOut?.method !== 'email' && playbook.optOut?.url) {
    const req = (playbook.optOut.requires || []).map((r) => `  - [ ] ${r}`).join('\n');
    return `${header}# ${playbook.name} - self-serve opt-out

This site has its own removal flow. Use it -- it is faster than a letter.

**Opt-out:** ${playbook.optOut.url}
**Method:** ${playbook.optOut.method}
**Listing found at:** ${finding.url}

Have ready:
${req || '  - [ ] the listing URL above'}

What it exposes:
${exposure}

${playbook.optOut.notes ? `Note: ${playbook.optOut.notes}\n` : ''}
Steps:
  - [ ] Submit the opt-out
  - [ ] Confirm from the verification email, if one arrives
  - [ ] Mark it: \`node privacy-agent/agent.mjs mark ${finding.id} requested\`
  - [ ] Re-check in ~14 days: \`node privacy-agent/agent.mjs verify\`
`;
  }

  const letter = draftLetter(finding, identity, {});
  return `${header}# ${finding.host} - deletion request (draft)

No self-serve opt-out is on file for this host, so this is a written request
under ${letter.law}. Read it, edit it, send it from your own address.

**To:** ${letter.to}
**Subject:** ${letter.subject}

---

${letter.body}
---

What it exposes:
${exposure}

Steps:
  - [ ] Send the email
  - [ ] Mark it: \`node privacy-agent/agent.mjs mark ${finding.id} requested\`
  - [ ] Chase it if there is no reply in ${letter.deadlineDays} days
`;
}

export async function writeRemovalDoc(outboxDir, finding, identity, playbook) {
  const path = join(outboxDir, `${finding.severity}-${finding.host || 'unknown'}-${finding.id}.md`);
  await writeText(path, renderRemovalDoc(finding, identity, playbook));
  return path;
}
