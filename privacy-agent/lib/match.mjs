/**
 * "Is this page actually about me?"
 *
 * The failure mode this module exists to prevent is a report full of strangers
 * who share your name. Scoring is a noisy-OR over how *exclusive* each matched
 * selector is, with a hard cap when a common-name match is all we have.
 */

import { digits, normalize } from './util.mjs';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Context is taken from the normalized text, not the raw page: normalization
 * collapses whitespace, so raw offsets would drift and quote the wrong line.
 */
function contextAround(text, index, span = 70) {
  if (index < 0) return '';
  const start = Math.max(0, index - span);
  return text.slice(start, Math.min(text.length, index + span)).trim();
}

function findName(normText, value) {
  const parts = normalize(value).split(' ').filter(Boolean);
  if (parts.length === 0) return null;
  const forms = [parts.join('\\s+')];
  if (parts.length > 1) {
    const [first, ...rest] = parts;
    const last = rest[rest.length - 1];
    forms.push(`${escape(last)},\\s*${escape(first)}`); // "Doe, Jane" listing style
  }
  for (const form of forms) {
    const re = new RegExp(`\\b${form}\\b`, 'g');
    const m = re.exec(normText);
    if (m) {
      const count = (normText.match(re) || []).length;
      return { count, context: contextAround(normText, m.index) };
    }
  }
  return null;
}

function findToken(normText, value) {
  const re = new RegExp(`(?<![\\w-])${escape(normalize(value))}(?![\\w-])`, 'g');
  const m = re.exec(normText);
  if (!m) return null;
  return { count: (normText.match(re) || []).length, context: contextAround(normText, m.index) };
}

/**
 * Phones are matched on digits only, so `(555) 010-1234`, `555.010.1234` and
 * `+1 555 010 1234` all count as the same number. The context quote is recovered
 * by re-finding those digits in the text with any separators between them.
 */
function findPhone(digitText, normText, value) {
  const d = digits(value);
  if (d.length < 7) return null;
  const needle = d.length > 10 ? d.slice(-10) : d;
  if (!digitText.includes(needle)) return null;
  const loose = new RegExp(needle.split('').join('\\D{0,3}'));
  const m = loose.exec(normText);
  return {
    count: digitText.split(needle).length - 1,
    context: m ? contextAround(normText, m.index) : '',
  };
}

export function findHits(text, selectors) {
  const rawText = String(text || '');
  const normText = normalize(rawText);
  const digitText = digits(rawText);
  const hits = [];

  for (const s of selectors) {
    let found = null;
    switch (s.type) {
      case 'name':
        found = findName(normText, s.value);
        break;
      case 'phone':
        found = findPhone(digitText, normText, s.value);
        break;
      case 'email':
      case 'domain':
      case 'username':
      case 'birthYear':
        found = findToken(normText, s.value);
        break;
      default:
        found = normText.includes(normalize(s.value))
          ? { count: 1, context: contextAround(normText, normText.indexOf(normalize(s.value))) }
          : null;
    }
    if (found) hits.push({ selectorId: s.id, type: s.type, value: s.value, weight: s.weight, ...found });
  }
  return hits;
}

const WEAK_TYPES = new Set(['location', 'employer', 'school', 'birthYear']);

export function scoreHits(hits) {
  if (hits.length === 0) return 0;
  const byType = new Map();
  for (const h of hits) byType.set(h.type, Math.max(byType.get(h.type) ?? 0, h.weight));

  let miss = 1;
  for (const w of byType.values()) miss *= 1 - w;
  let confidence = 1 - miss;

  // Two independent kinds of match (name + phone, handle + employer) is much
  // stronger evidence than either alone.
  if (byType.size >= 2) confidence += (1 - confidence) * 0.25;

  const types = [...byType.keys()];
  if (types.every((t) => WEAK_TYPES.has(t))) confidence = Math.min(confidence, 0.2);
  else if (types.length === 1 && types[0] === 'name') confidence = Math.min(confidence, 0.35);

  return Math.round(Math.min(confidence, 0.99) * 100) / 100;
}

export function scoreDocument(text, selectors) {
  const hits = findHits(text, selectors);
  return { confidence: scoreHits(hits), hits };
}
