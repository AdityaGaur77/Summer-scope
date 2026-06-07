// SummerScope Analytics API
// Returns aggregated analytics data for the dashboard.
// Requires env vars: SUPABASE_SERVICE_KEY, DASHBOARD_PASSWORD

const SUPABASE_BASE = 'https://fdpwoccrmdyuhelyocpk.supabase.co/rest/v1';

function countBy(arr, key) {
  const m = {};
  arr.forEach(e => { const v = e[key]; if (v != null) m[v] = (m[v] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

function countArray(arr) {
  const m = {};
  arr.forEach(v => { if (v) m[v] = (m[v] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).end();

  // ── Password check ──────────────────────────────────────────────────
  const pw   = process.env.DASHBOARD_PASSWORD;
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (pw && auth !== pw) return res.status(401).json({ error: 'unauthorized' });

  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return res.status(500).json({ error: 'not_configured' });

  // ── Fetch last 30 days of events ────────────────────────────────────
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const cols  = [
    'event_type','page','visitor_id','session_id','referrer',
    'device_type','browser','os','scroll_depth','duration_ms',
    'element','element_label','search_query','created_at','metadata',
  ].join(',');

  const url = `${SUPABASE_BASE}/events?select=${cols}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=10000`;
  const r = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) return res.status(502).json({ error: 'db_error', detail: await r.text() });

  const events = await r.json();

  // ── Slice by type ───────────────────────────────────────────────────
  const pageviews  = events.filter(e => e.event_type === 'pageview');
  const sessionEnd = events.filter(e => e.event_type === 'session_end');
  const scrollEvts = events.filter(e => e.event_type === 'scroll');
  const clickEvts  = events.filter(e => e.event_type === 'click');
  const searchEvts = events.filter(e => e.event_type === 'search');

  // ── Summary stats ───────────────────────────────────────────────────
  const uniqueVisitors = new Set(pageviews.map(e => e.visitor_id).filter(Boolean)).size;
  const uniqueSessions = new Set(pageviews.map(e => e.session_id).filter(Boolean)).size;
  const durations      = sessionEnd.map(e => e.duration_ms).filter(Boolean);
  const avgDurationSec = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000)
    : 0;

  // Returning vs new visitors
  const returning = pageviews.filter(e => e.metadata?.returning).length;

  // ── Pageviews by day (last 30 days, fill gaps) ──────────────────────
  const byDayMap = {};
  pageviews.forEach(e => {
    const day = e.created_at.slice(0, 10);
    byDayMap[day] = (byDayMap[day] || 0) + 1;
  });
  // Fill every day in the range
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push({ date: d, count: byDayMap[d] || 0 });
  }

  // ── Breakdowns ──────────────────────────────────────────────────────
  const byPage    = countBy(pageviews, 'page');
  const byDevice  = countBy(pageviews, 'device_type');
  const byBrowser = countBy(pageviews, 'browser');
  const byOS      = countBy(pageviews, 'os');

  // Referrers — strip hostname, exclude direct/empty
  const referrerHosts = pageviews
    .filter(e => e.referrer)
    .map(e => hostnameOf(e.referrer))
    .filter(h => h && !h.includes(req.headers.host || 'summerscope'));
  const topReferrers = countArray(referrerHosts).slice(0, 10);

  // Scroll depth — how far users scroll (% of sessions reaching each milestone)
  const scrollDepth = [25, 50, 75, 100].map(m => ({
    label: `${m}%`,
    count: scrollEvts.filter(e => e.scroll_depth === m).length,
  }));

  // Top programs clicked
  const topPrograms = countArray(
    clickEvts.filter(e => e.element === 'program_card').map(e => e.element_label).filter(Boolean)
  ).slice(0, 10);

  // Top event/competition cards clicked
  const topEvents = countArray(
    clickEvts.filter(e => e.element === 'event_card').map(e => e.element_label).filter(Boolean)
  ).slice(0, 10);

  // Nav tab switches
  const topNavTabs = countArray(
    clickEvts.filter(e => e.element === 'nav_tab').map(e => e.element_label).filter(Boolean)
  );

  // Top searches
  const topSearches = countArray(
    searchEvts.map(e => e.search_query).filter(Boolean)
  ).slice(0, 15);

  // Top filters used
  const topFilters = countArray(
    clickEvts.filter(e => e.element === 'filter_checkbox').map(e => e.element_label).filter(Boolean)
  ).slice(0, 15);

  // External links clicked
  const topLinks = countArray(
    clickEvts.filter(e => e.element === 'external_link').map(e => e.element_label).filter(Boolean)
  ).slice(0, 10);

  // UTM sources
  const topUTMSources = countArray(
    pageviews.map(e => e.utm_source).filter(Boolean)
  ).slice(0, 10);

  return res.status(200).json({
    generated_at: new Date().toISOString(),
    summary: {
      total_pageviews:     pageviews.length,
      unique_visitors:     uniqueVisitors,
      unique_sessions:     uniqueSessions,
      avg_duration_sec:    avgDurationSec,
      returning_visitors:  returning,
      new_visitors:        pageviews.length - returning,
    },
    pageviews_by_day: days,
    by_page:          byPage,
    by_device:        byDevice,
    by_browser:       byBrowser,
    by_os:            byOS,
    top_referrers:    topReferrers,
    top_utm_sources:  topUTMSources,
    scroll_depth:     scrollDepth,
    top_programs:     topPrograms,
    top_events:       topEvents,
    top_nav_tabs:     topNavTabs,
    top_searches:     topSearches,
    top_filters:      topFilters,
    top_links:        topLinks,
  });
}
