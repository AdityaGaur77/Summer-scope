// Small shared helpers. No dependencies -- Node 18+ only.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const nowIso = () => new Date().toISOString();

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function shortHash(...parts) {
  return createHash('sha256').update(parts.join(' ')).digest('hex').slice(0, 12);
}

/** Concurrency gate. `limiter(2)` returns a wrapper that runs at most 2 jobs at once. */
export function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { job, resolve, reject } = queue.shift();
    job().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  return (job) =>
    new Promise((resolve, reject) => {
      queue.push({ job, resolve, reject });
      next();
    });
}

/**
 * Per-host politeness. Every host gets its own minimum gap between requests, so a
 * scan that touches forty pages on one broker still looks like a person reading.
 */
export function hostThrottle(minGapMs = 1500) {
  const lastAt = new Map();
  return async function wait(host) {
    const prev = lastAt.get(host) ?? 0;
    const gap = Date.now() - prev;
    if (gap < minGapMs) await sleep(minGapMs - gap);
    lastAt.set(host, Date.now());
  };
}

export function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g;
const PHONE_RE = /(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
// Case-insensitive on purpose: evidence snippets are stored normalized (lower
// case), so a capitalized-only pattern would let every address through.
const STREET_RE =
  /\b\d{1,5}\s+([\w'.-]+\s){1,3}(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|way|ter|terrace|pl|place|cir|circle)\b\.?/gi;

/** Mask PII so reports and logs can be shared without leaking the very data we are hunting. */
export function redact(text = '') {
  return String(text)
    .replace(EMAIL_RE, (m) => {
      const [user, domain] = m.split('@');
      return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
    })
    // Separators make per-digit masking read as noise; keep the last two digits
    // so you can tell which of your numbers a page is publishing, nothing more.
    .replace(PHONE_RE, (m) => `[phone ...${m.replace(/\D/g, '').slice(-2)}]`)
    .replace(STREET_RE, '[address redacted]');
}

export function digits(s = '') {
  return String(s).replace(/\D+/g, '');
}

export function normalize(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(s = '', n = 220) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}...` : t;
}

export async function readJson(path, fallback = undefined) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (fallback !== undefined && err.code === 'ENOENT') return fallback;
    throw err;
  }
}

/** Write via temp file + rename so an interrupted run never truncates the ledger. */
export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

export async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
}

const LEVELS = { quiet: 0, normal: 1, verbose: 2 };
let level = LEVELS.normal;
export function setLogLevel(name) {
  level = LEVELS[name] ?? LEVELS.normal;
}
export const log = {
  step: (...a) => level >= LEVELS.normal && console.log(...a),
  detail: (...a) => level >= LEVELS.verbose && console.log('   ', ...a),
  warn: (...a) => level >= LEVELS.normal && console.warn('  !', ...a),
  error: (...a) => console.error('  x', ...a),
};
