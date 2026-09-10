// SummerScope Analytics — Vercel Serverless Function
//
// Receives visit events from the browser and writes them to Supabase.
// Reached at BOTH /api/track and /api/collect — the second is a rewrite in
// vercel.json, and it is the one the browser actually calls, because request
// paths containing "track" are matched by the blocklists that ship with uBlock
// Origin, Brave and Safari. See the header of ss-insights.js.
//
// Requires env var: SUPABASE_SERVICE_KEY

import { SUPABASE_BASE, authHeaders } from './_supabase.js';

const EVENTS_URL = `${SUPABASE_BASE}/events`;

// Only event types the tracker actually emits are accepted. Without this the
// endpoint is an open write to the analytics table for anyone who finds it.
const ALLOWED_EVENTS = new Set(['pageview', 'scroll', 'session_end', 'click', 'search']);

/**
 * Crawlers, previewers and monitors are not visitors.
 *
 * Nothing filtered these before, so every Googlebot pass, every uptime check and
 * every Slack/Discord/WhatsApp link unfurl was one more "unique visitor" in the
 * dashboard — on a low-traffic site that is not a rounding error, it is most of
 * the traffic. Dropping them at ingest keeps the events table itself clean, so
 * the numbers are right retroactively as well as going forward.
 *
 * The list is a generic pass for anything that calls itself a bot, crawler or
 * spider, plus the named agents that do not.
 *
 * The terms are deliberately narrow. Several search companies also ship a real
 * browser, and their readers are exactly this site's audience — `duckduckgo`
 * would have dropped every DuckDuckGo Browser visit, `pinterest` every visit
 * from the Pinterest in-app browser, and a bare `search` or `preview` catches
 * things nobody can predict. Where the crawler's own name already contains
 * "bot" or "spider", the generic term is enough and the brand is left out.
 */
const BOT_UA = new RegExp([
  'bot\\b', 'bot/', 'crawl', 'spider', 'slurp', 'monitor', 'scrap',
  'headless', 'phantom', 'selenium', 'puppeteer', 'playwright', 'lighthouse',
  'curl/', 'wget', 'python-requests', 'httpclient', 'okhttp', 'axios', 'go-http',
  'java/', 'libwww', 'apache-httpclient', 'node-fetch', 'got \\(', 'guzzle',
  'unfurl', 'embedly', 'quora link', 'outbrain', 'validator', 'archiver',
  'facebookexternalhit', 'facebookcatalog', 'whatsapp/', 'skypeuripreview',
  'vkshare', 'bingpreview', 'ahrefs', 'semrush', 'mj12', 'seznam',
  'gtmetrix', 'pingdom', 'uptimerobot', 'pagespeed', 'dataprovider', 'siteaudit',
].join('|'), 'i');

/** A request with no user agent at all is never a browser either. */
function isBot(ua) {
  if (!ua || ua.length < 12) return true;
  return BOT_UA.test(ua);
}

/**
 * Reject writes posted from somewhere other than this deployment.
 *
 * The endpoint used to answer `Access-Control-Allow-Origin: *`, which is an open
 * invitation to inflate someone else's numbers from a browser console. Requests
 * that carry no Origin at all are still accepted: some browsers omit it on
 * sendBeacon, and dropping those would lose real visits to fix a hypothetical.
 */
function isForeignOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
  if (!host) return false;
  let originHost;
  try { originHost = new URL(origin).hostname; } catch { return true; }
  if (originHost === 'localhost' || originHost === '127.0.0.1') return false;
  const bare = host.replace(/^www\./, '');
  return !(originHost === host || originHost === 'www.' + bare
           || originHost === bare || originHost.endsWith('.' + bare));
}

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
  // The tracker is same-origin, so there is nothing to grant cross-origin.
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Filtered requests get 204, not an error: the browser must not retry, and a
  // crawler should see nothing interesting here.
  if (isBot(req.headers['user-agent'])) return res.status(204).end();
  if (isForeignOrigin(req)) return res.status(204).end();

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
