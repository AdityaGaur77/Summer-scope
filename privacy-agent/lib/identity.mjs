/**
 * The subject file: who the agent is looking for.
 *
 * This tool is a self-scan tool. It reads one identity -- yours -- and looks for
 * where that identity is already exposed so you can get it taken down. The
 * consent gate below is the whole safety model: the file must state, in writing,
 * that the identity belongs to the person running the scan.
 */

import { digits, normalize, readJson, shortHash } from './util.mjs';

export const CONSENT_HELP = `identity.json must contain:

  "consent": {
    "selfScan": true,
    "subjectIsMe": true,
    "acknowledgedAt": "YYYY-MM-DD"
  }

This agent only scans for the identity of the person running it. If you need to
find data about someone else, they have to run it themselves -- point them at
this repo instead.`;

/** Exclusivity of each selector type: how strongly a hit implies "this is me". */
const WEIGHTS = {
  email: 0.95,
  phone: 0.9,
  address: 0.85,
  domain: 0.6,
  username: 0.6,
  name: 0.3,
  employer: 0.15,
  school: 0.15,
  location: 0.1,
  birthYear: 0.1,
};

const DEFAULT_SCAN = {
  channels: ['web', 'brokers', 'github'],
  maxResultsPerQuery: 8,
  maxPagesPerRun: 60,
  minConfidence: 0.45,
  minGapMs: 1500,
  concurrency: 2,
};

export class IdentityError extends Error {}

export async function loadIdentity(path) {
  const raw = await readJson(path, null);
  if (raw === null) {
    throw new IdentityError(
      `No identity file at ${path}.\nRun \`node privacy-agent/agent.mjs init\` to create one from the example.`,
    );
  }
  return validateIdentity(raw);
}

export function validateIdentity(raw) {
  const consent = raw.consent || {};
  if (consent.selfScan !== true || consent.subjectIsMe !== true || !consent.acknowledgedAt) {
    throw new IdentityError(`Consent block missing or incomplete.\n\n${CONSENT_HELP}`);
  }
  const subject = raw.subject || {};
  const hasAnchor =
    (subject.names?.length || 0) + (subject.emails?.length || 0) + (subject.aliases?.length || 0) > 0;
  if (!hasAnchor) {
    throw new IdentityError('subject needs at least one of: names, emails, aliases.');
  }
  return {
    consent,
    subject,
    scan: { ...DEFAULT_SCAN, ...(raw.scan || {}) },
    jurisdiction: raw.jurisdiction || 'US',
    contact: raw.contact || {},
  };
}

function sel(type, value, extra = {}) {
  const display = String(value);
  return {
    id: `${type}:${shortHash(type, normalize(display))}`,
    type,
    value: display,
    norm: type === 'phone' ? digits(display) : normalize(display),
    weight: WEIGHTS[type] ?? 0.2,
    ...extra,
  };
}

/**
 * Flatten the identity into matchable selectors. Order matters only for display;
 * scoring uses the weights above.
 */
export function selectorsOf(identity) {
  const s = identity.subject;
  const out = [];
  for (const name of s.names || []) out.push(sel('name', name));
  for (const alias of s.aliases || []) out.push(sel('username', alias));
  for (const [platform, list] of Object.entries(s.usernames || {})) {
    for (const u of list || []) out.push(sel('username', u, { platform }));
  }
  for (const email of s.emails || []) out.push(sel('email', email));
  for (const phone of s.phones || []) out.push(sel('phone', phone));
  for (const addr of s.addresses || []) out.push(sel('address', addr));
  for (const d of s.domains || []) out.push(sel('domain', d));
  for (const e of s.employers || []) out.push(sel('employer', e));
  for (const school of s.schools || []) out.push(sel('school', school));
  for (const loc of s.locations || []) {
    const label = typeof loc === 'string' ? loc : [loc.city, loc.region].filter(Boolean).join(', ');
    if (label) out.push(sel('location', label));
  }
  if (s.birthYear) out.push(sel('birthYear', String(s.birthYear)));

  // De-duplicate: the same string listed twice should not double-count in scoring.
  const seen = new Set();
  return out.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
}

export function primaryName(identity) {
  return identity.subject.names?.[0] || identity.subject.aliases?.[0] || 'the subject';
}

export function primaryLocation(identity) {
  const loc = identity.subject.locations?.[0];
  if (!loc) return '';
  return typeof loc === 'string' ? loc : [loc.city, loc.region].filter(Boolean).join(', ');
}
