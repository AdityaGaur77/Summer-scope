// Shared Supabase/PostgREST helpers for the analytics endpoints.
//
// The important thing in here is `countRows`: PostgREST can return an exact
// row count in a Content-Range header without transferring a single row. That
// is how lifetime totals stay correct and cheap no matter how large the events
// table grows — the previous implementation pulled rows and capped at 10,000,
// which silently under-reported once the site passed that many events.

export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fdpwoccrmdyuhelyocpk.supabase.co';
export const SUPABASE_BASE = `${SUPABASE_URL}/rest/v1`;

/** PostgREST caps a single response at 1000 rows by default. */
const PAGE = 1000;

export function authHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/**
 * Exact row count for a filter, without downloading the rows.
 * Returns null if the count header is missing or malformed.
 */
export async function countRows(key, filter = '') {
  const url = `${SUPABASE_BASE}/events?select=id${filter ? '&' + filter : ''}`;
  const r = await fetch(url, {
    method: 'HEAD',
    headers: { ...authHeaders(key), Prefer: 'count=exact', Range: '0-0' },
  });
  if (!r.ok && r.status !== 206) return null;
  const cr = r.headers.get('content-range'); // e.g. "0-0/12345" or "*/12345"
  if (!cr) return null;
  const total = parseInt(cr.split('/')[1], 10);
  return Number.isFinite(total) ? total : null;
}

/**
 * Page through a query until exhausted or `cap` rows have been read.
 * Returns { rows, capped } so callers can be honest about truncation rather
 * than silently reporting a partial number as if it were complete.
 */
export async function fetchAll(key, path, cap = 50000) {
  const rows = [];
  let capped = false;

  for (let from = 0; from < cap; from += PAGE) {
    const to = Math.min(from + PAGE, cap) - 1;
    const r = await fetch(`${SUPABASE_BASE}/${path}`, {
      headers: { ...authHeaders(key), Range: `${from}-${to}`, 'Range-Unit': 'items' },
    });
    if (!r.ok && r.status !== 206) {
      throw new Error(`supabase ${r.status}: ${await r.text()}`);
    }
    const batch = await r.json();
    if (!Array.isArray(batch)) throw new Error('unexpected response shape');
    rows.push(...batch);
    if (batch.length < to - from + 1) return { rows, capped: false };
    if (rows.length >= cap) { capped = true; break; }
  }
  return { rows, capped };
}

/**
 * Call a Postgres function if the operator has installed supabase/schema.sql.
 * Returns null when the function isn't there, so every caller can fall back to
 * computing the same thing from raw rows. The SQL path is exact and fast; the
 * fallback keeps the dashboard working on a stock database with no migration.
 */
export async function rpc(key, fn, body = {}) {
  try {
    const r = await fetch(`${SUPABASE_BASE}/rpc/${fn}`, {
      method: 'POST',
      headers: { ...authHeaders(key), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null; // 404 = migration not applied; treat as absent
    return await r.json();
  } catch {
    return null;
  }
}

/** Timestamp of the oldest event — the true start of the tracking record. */
export async function firstEventAt(key) {
  const r = await fetch(
    `${SUPABASE_BASE}/events?select=created_at&order=created_at.asc&limit=1`,
    { headers: authHeaders(key) },
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0].created_at : null;
}
