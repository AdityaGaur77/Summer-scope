/**
 * What kind of data is exposed on a page, and how badly it hurts.
 *
 * Severity drives the whole workflow: it decides what the report puts at the top
 * and which findings `letters` drafts removal requests for first. A home address
 * on a people-search site outranks a decade-old forum post with your handle.
 */

import { redact, truncate } from './util.mjs';

export const SEVERITY = { low: 1, medium: 2, high: 3, critical: 4 };
export const SEVERITY_NAME = ['none', 'low', 'medium', 'high', 'critical'];

const PATTERNS = [
  {
    key: 'government_id',
    label: 'Government ID number',
    severity: SEVERITY.critical,
    re: /\b\d{3}-\d{2}-\d{4}\b/g,
    // Never stored: presence is recorded, the value never is.
    store: false,
  },
  {
    key: 'date_of_birth',
    label: 'Date of birth',
    severity: SEVERITY.critical,
    re: /\b(?:dob|date of birth|born)\b[:\s]*((?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4})|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4})/gi,
    store: false,
  },
  {
    key: 'street_address',
    label: 'Home address',
    severity: SEVERITY.high,
    re: /\b\d{1,5}\s+(?:[a-z0-9'.-]+\s){1,4}(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|way|ter|terrace|pl|place|cir|circle|hwy|highway)\b\.?/gi,
    store: false,
  },
  {
    key: 'phone_number',
    label: 'Phone number',
    severity: SEVERITY.high,
    re: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    store: false,
  },
  {
    key: 'relatives',
    label: 'Named relatives / associates',
    severity: SEVERITY.high,
    re: /\b(?:relatives?|possible relatives|family members|associates|known associates|lives with)\b[:\s]/gi,
    store: true,
  },
  {
    key: 'age',
    label: 'Age',
    severity: SEVERITY.high,
    re: /\b(?:(?:age|aged)\s*:?\s*\d{1,3}|\d{1,3}\s+years?\s+old)\b/gi,
    store: true,
  },
  {
    key: 'public_records',
    label: 'Court / property / voter records',
    severity: SEVERITY.high,
    re: /\b(?:criminal record|court record|arrest record|property record|voter registration|marriage record|bankruptc)\w*/gi,
    store: true,
  },
  {
    key: 'email_address',
    label: 'Email address',
    severity: SEVERITY.medium,
    re: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g,
    store: false,
  },
  {
    key: 'employment',
    label: 'Employer / school',
    severity: SEVERITY.medium,
    re: /\b(?:works? at|employed (?:at|by)|employer|studies at|student at|attends)\b[:\s]/gi,
    store: true,
  },
  {
    key: 'photo',
    label: 'Photo of the subject',
    severity: SEVERITY.medium,
    re: /\b(?:profile (?:photo|picture|image)|headshot|avatar)\b/gi,
    store: true,
  },
];

/**
 * Pages that exist to sell a dossier get an automatic floor: a broker listing is
 * high-severity even when its preview shows only a name and a city, because the
 * page's whole purpose is to sell what it is hiding behind the paywall.
 */
export function extractPii(text, { isBroker = false } = {}) {
  const body = String(text || '');
  const categories = [];
  for (const p of PATTERNS) {
    const matches = body.match(p.re);
    if (!matches?.length) continue;
    categories.push({
      key: p.key,
      label: p.label,
      severity: p.severity,
      count: matches.length,
      sample: p.store ? truncate(matches[0], 80) : redact(truncate(matches[0], 80)),
    });
  }
  let severity = categories.reduce((max, c) => Math.max(max, c.severity), 0);
  if (isBroker) severity = Math.max(severity, SEVERITY.high);
  else if (severity === 0) severity = SEVERITY.low;

  // Address plus a live phone number is a physical-safety problem, not a privacy nit.
  const keys = new Set(categories.map((c) => c.key));
  if (keys.has('street_address') && keys.has('phone_number')) severity = SEVERITY.critical;

  return { severity, severityName: SEVERITY_NAME[severity], categories };
}
