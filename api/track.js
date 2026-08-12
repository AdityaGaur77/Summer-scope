// SummerScope Analytics — Vercel Serverless Function
// Receives analytics events from the browser and writes them to Supabase.
// Requires env var: SUPABASE_SERVICE_KEY

import { SUPABASE_BASE, authHeaders } from './_supabase.js';

const EVENTS_URL = `${SUPABASE_BASE}/events`;

// Only event types the tracker actually emits are accepted. Without this the
// endpoint is an open write to the analytics table for anyone who finds it.
const ALLOWED_EVENTS = new Set(['pageview', 'scroll', 'session_end', 'click', 'search']);

/** Keep a single metadata blob from ballooning the row. */
function safeMetadata(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(m)) {
    if (n++ >= 25) break;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      out[String(k).slice(0, 40)] = typeof v === 'string' ? v.slice(0, 300) : v;
    }
  }
  return Object.keys(out).length ? out : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) {
    console.error('[track] SUPABASE_SERVICE_KEY not set');
    return res.status(500).json({ error: 'not_configured' });
  }

  try {
    // sendBeacon posts a Blob, so depending on the runtime `req.body` can
    // arrive as a string, a Buffer, or an already-parsed object.
    let body = req.body;
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    if (!body || !body.event_type) return res.status(400).json({ error: 'missing event_type' });
    if (!ALLOWED_EVENTS.has(String(body.event_type))) {
      return res.status(400).json({ error: 'unknown event_type' });
    }

    // Sanitise every field — never trust client input
    const event = {
      event_type:    String(body.event_type   ?? '').slice(0, 50),
      page:          body.page          ? String(body.page).slice(0, 50)          : null,
      session_id:    body.session_id    ? String(body.session_id).slice(0, 50)    : null,
      visitor_id:    body.visitor_id    ? String(body.visitor_id).slice(0, 50)    : null,
      referrer:      body.referrer      ? String(body.referrer).slice(0, 500)     : null,
      utm_source:    body.utm_source    ? String(body.utm_source).slice(0, 100)   : null,
      utm_medium:    body.utm_medium    ? String(body.utm_medium).slice(0, 100)   : null,
      utm_campaign:  body.utm_campaign  ? String(body.utm_campaign).slice(0, 100) : null,
      element:       body.element       ? String(body.element).slice(0, 100)      : null,
      element_label: body.element_label ? String(body.element_label).slice(0, 200): null,
      scroll_depth:  body.scroll_depth  != null ? Number(body.scroll_depth)       : null,
      duration_ms:   body.duration_ms   != null ? Number(body.duration_ms)        : null,
      device_type:   body.device_type   ? String(body.device_type).slice(0, 20)  : null,
      screen_width:  body.screen_width  != null ? Number(body.screen_width)       : null,
      browser:       body.browser       ? String(body.browser).slice(0, 50)      : null,
      os:            body.os            ? String(body.os).slice(0, 50)            : null,
      search_query:  body.search_query  ? String(body.search_query).slice(0, 200) : null,
      metadata:      safeMetadata(body.metadata),
    };

    const r = await fetch(EVENTS_URL, {
      method: 'POST',
      headers: {
        ...authHeaders(key),
        'Content-Type': 'application/json',
        Prefer:         'return=minimal',
      },
      body: JSON.stringify(event),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('[track] Supabase error:', r.status, err);
      return res.status(502).json({ error: 'db_error' });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[track] handler error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
