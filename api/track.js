// SummerScope Analytics — Vercel Serverless Function
// Receives analytics events from the browser and writes them to Supabase.
// Requires env var: SUPABASE_SERVICE_KEY

const SUPABASE_URL = 'https://fdpwoccrmdyuhelyocpk.supabase.co/rest/v1/events';

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
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || !body.event_type) return res.status(400).json({ error: 'missing event_type' });

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
      metadata:      body.metadata && typeof body.metadata === 'object' ? body.metadata : null,
    };

    const r = await fetch(SUPABASE_URL, {
      method: 'POST',
      headers: {
        apikey:          key,
        Authorization:   `Bearer ${key}`,
        'Content-Type':  'application/json',
        Prefer:          'return=minimal',
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
