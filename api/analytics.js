// SummerScope Analytics API
// GET /api/analytics?days=7|30|90
// Requires env vars: SUPABASE_SERVICE_KEY, DASHBOARD_PASSWORD

const SUPABASE_BASE = 'https://fdpwoccrmdyuhelyocpk.supabase.co/rest/v1';

function countBy(arr, key) {
  const m = {};
  arr.forEach(e => { const v = e[key]; if (v != null && v !== '') m[v] = (m[v] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

function countArr(arr) {
  const m = {};
  arr.forEach(v => { if (v) m[String(v)] = (m[String(v)] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).end();

  // Password check
  const pw   = process.env.DASHBOARD_PASSWORD;
  const auth = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (pw && auth !== pw) return res.status(401).json({ error: 'unauthorized' });

  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return res.status(500).json({ error: 'not_configured' });

  // Range — default 7 days
  const days  = Math.min(parseInt(req.query?.days || req.url?.split('days=')[1]) || 7, 90);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // Fetch all events in range
  const cols = 'event_type,page,visitor_id,session_id,referrer,device_type,browser,os,scroll_depth,duration_ms,element,element_label,search_query,created_at,metadata,utm_source';
  const url  = `${SUPABASE_BASE}/events?select=${cols}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=10000`;

  const r = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) return res.status(502).json({ error: 'db_error', detail: await r.text() });

  const events = await r.json();
  if (!Array.isArray(events)) return res.status(502).json({ error: 'unexpected_response' });

  // Partition by event type
  const pageviews  = events.filter(e => e.event_type === 'pageview');
  const sessionEnd = events.filter(e => e.event_type === 'session_end');
  const scrollEvts = events.filter(e => e.event_type === 'scroll');
  const clickEvts  = events.filter(e => e.event_type === 'click');
  const searchEvts = events.filter(e => e.event_type === 'search');

  // Unique visitors (by visitor_id) and sessions (by session_id)
  const uniqueVisitors = new Set(pageviews.map(e => e.visitor_id).filter(Boolean)).size;
  const uniqueSessions = new Set(pageviews.map(e => e.session_id).filter(Boolean)).size;

  // Average session duration from session_end events
  const durations     = sessionEnd.map(e => e.duration_ms).filter(v => v > 0 && v < 3600000);
  const avgDurationSec = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000)
    : 0;

  // Returning visitors — metadata.returning is set by the tracker
  const returningCount = pageviews.filter(e => {
    const meta = e.metadata;
    return meta && typeof meta === 'object' && meta.returning === true;
  }).length;

  // Pageviews by day — fill every day in range
  const byDayMap = {};
  pageviews.forEach(e => { const d = e.created_at.slice(0, 10); byDayMap[d] = (byDayMap[d] || 0) + 1; });
  const pageviewsByDay = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    pageviewsByDay.push({ date: d, count: byDayMap[d] || 0 });
  }

  // Audience breakdowns (from pageviews only)
  const byPage    = countBy(pageviews, 'page');
  const byDevice  = countBy(pageviews, 'device_type');
  const byBrowser = countBy(pageviews, 'browser');
  const byOS      = countBy(pageviews, 'os');

  // Referrers — clean hostname, exclude self-referrals and empty
  const ownHost = 'summerscope';
  const refHosts = pageviews
    .filter(e => e.referrer)
    .map(e => hostname(e.referrer))
    .filter(h => h && !h.includes(ownHost));
  const topReferrers = countArr(refHosts).slice(0, 10);

  // UTM sources (stored both in utm_source column AND metadata.utm_source)
  const utmSources = pageviews
    .map(e => e.utm_source || (e.metadata && e.metadata.utm_source))
    .filter(Boolean);
  const topUTMSources = countArr(utmSources).slice(0, 10);

  // Scroll depth — sessions reaching each milestone
  const scrollDepth = [25, 50, 75, 100].map(m => ({
    label: m + '%',
    count: scrollEvts.filter(e => e.scroll_depth === m).length,
  }));

  // Content clicks
  const topPrograms = countArr(
    clickEvts.filter(e => e.element === 'program_card').map(e => e.element_label).filter(Boolean)
  ).slice(0, 10);

  const topEvents = countArr(
    clickEvts.filter(e => e.element === 'event_card').map(e => e.element_label).filter(Boolean)
  ).slice(0, 10);

  const topNavTabs = countArr(
    clickEvts.filter(e => e.element === 'nav_tab').map(e => e.element_label).filter(Boolean)
  );

  // Searches
  const topSearches = countArr(
    searchEvts.map(e => e.search_query).filter(Boolean)
  ).slice(0, 15);

  // Filters used
  const topFilters = countArr(
    clickEvts.filter(e => e.element === 'filter_checkbox').map(e => e.element_label).filter(Boolean)
  ).slice(0, 15);

  // External links
  const topLinks = countArr(
    clickEvts.filter(e => e.element === 'external_link').map(e => {
      try { return new URL(e.element_label).hostname.replace(/^www\./, '') + new URL(e.element_label).pathname.slice(0, 30); }
      catch { return e.element_label; }
    }).filter(Boolean)
  ).slice(0, 10);

  return res.status(200).json({
    generated_at:     new Date().toISOString(),
    range_days:       days,
    summary: {
      total_pageviews:    pageviews.length,
      unique_visitors:    uniqueVisitors,
      unique_sessions:    uniqueSessions,
      avg_duration_sec:   avgDurationSec,
      returning_visitors: returningCount,
      new_visitors:       pageviews.length > 0 ? pageviews.length - returningCount : 0,
      total_events:       events.length,
    },
    pageviews_by_day: pageviewsByDay,
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
