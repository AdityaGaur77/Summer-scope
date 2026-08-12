// SummerScope Analytics API
//
//   GET /api/analytics?days=7|30|90|365
//   GET /api/analytics?days=all          ← whole tracking history
//
// Every response also carries a `lifetime` block with all-time totals,
// independent of the selected range, so the dashboard can always show
// cumulative views and visits alongside the windowed numbers.
//
// Requires env vars: SUPABASE_SERVICE_KEY, DASHBOARD_PASSWORD

import { SUPABASE_BASE, authHeaders, countRows, fetchAll, rpc, firstEventAt } from './_supabase.js';

// Hard ceiling on rows pulled for the detailed breakdowns. Headline totals
// never rely on this — they come from exact COUNT queries.
const DETAIL_ROW_CAP = 50000;

function countBy(arr, key) {
  const m = new Map();
  for (const e of arr) {
    const v = e[key];
    if (v != null && v !== '') m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

function countArr(arr) {
  const m = new Map();
  for (const v of arr) if (v) m.set(String(v), (m.get(String(v)) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return null; }
}

/** Self-referrals shouldn't show up as a traffic source. */
function isSelfReferral(host, reqHost) {
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (!reqHost) return /summerscope/i.test(host);
  const bare = String(reqHost).replace(/^www\./, '').split(':')[0];
  return host === bare || host.endsWith('.' + bare) || /summerscope/i.test(host);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  // ── Auth: fail closed ─────────────────────────────────────────────────────
  // Previously the password was only enforced `if (pw)`, so an unset
  // DASHBOARD_PASSWORD published the whole analytics feed to the internet.
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) {
    console.error('[analytics] DASHBOARD_PASSWORD not set — refusing to serve');
    return res.status(503).json({ error: 'dashboard_password_not_configured' });
  }
  const auth = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (auth !== pw) return res.status(401).json({ error: 'unauthorized' });

  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return res.status(500).json({ error: 'not_configured' });

  // ── Range ─────────────────────────────────────────────────────────────────
  const rawDays = String(req.query?.days ?? '7');
  const isAll = rawDays === 'all' || rawDays === 'lifetime' || rawDays === '0';
  const days = isAll ? null : Math.min(Math.max(parseInt(rawDays, 10) || 7, 1), 3650);

  try {
    // ── Lifetime totals — exact, from COUNT queries, no row cap ─────────────
    const firstSeen = await firstEventAt(key);

    // Prefer the SQL rollup when the operator has applied supabase/schema.sql:
    // it gives exact distinct visitor/session counts, which PostgREST alone
    // cannot express. Otherwise we fall back to counting what we can exactly
    // and flag the distincts as a floor rather than pretending they're exact.
    const life = await rpc(key, 'summerscope_lifetime');

    const [lifePv, lifeAll] = await Promise.all([
      countRows(key, 'event_type=eq.pageview'),
      countRows(key),
    ]);

    let lifetime;
    if (life && (Array.isArray(life) ? life[0] : life)) {
      const L = Array.isArray(life) ? life[0] : life;
      lifetime = {
        total_pageviews: Number(L.total_pageviews ?? lifePv ?? 0),
        unique_visitors: Number(L.unique_visitors ?? 0),
        unique_sessions: Number(L.unique_sessions ?? 0),
        total_events: Number(L.total_events ?? lifeAll ?? 0),
        first_event_at: L.first_event_at ?? firstSeen,
        exact: true,
        source: 'sql_rollup',
      };
    } else {
      // No migration applied. Totals are still exact; distinct counts are
      // derived from a capped scan, so report them as a minimum.
      const { rows: vids, capped } = await fetchAll(
        key,
        'events?select=visitor_id,session_id&event_type=eq.pageview&order=created_at.desc',
        DETAIL_ROW_CAP,
      );
      lifetime = {
        total_pageviews: lifePv ?? 0,
        unique_visitors: new Set(vids.map(v => v.visitor_id).filter(Boolean)).size,
        unique_sessions: new Set(vids.map(v => v.session_id).filter(Boolean)).size,
        total_events: lifeAll ?? 0,
        first_event_at: firstSeen,
        // Totals are exact either way; only the distinct counts are floored.
        exact: !capped,
        distinct_counts_capped: capped,
        source: capped ? 'scan_capped' : 'scan',
      };
    }

    if (lifetime.first_event_at) {
      const startedMs = new Date(lifetime.first_event_at).getTime();
      const daysTracked = Math.max(1, Math.ceil((Date.now() - startedMs) / 86400000));
      lifetime.days_tracked = daysTracked;
      lifetime.avg_pageviews_per_day = Math.round((lifetime.total_pageviews / daysTracked) * 10) / 10;
    }

    // ── Windowed detail ───────────────────────────────────────────────────────
    const since = isAll
      ? (lifetime.first_event_at || new Date(0).toISOString())
      : new Date(Date.now() - days * 86400000).toISOString();

    const cols = 'event_type,page,visitor_id,session_id,referrer,device_type,browser,os,' +
                 'scroll_depth,duration_ms,element,element_label,search_query,created_at,metadata,utm_source';
    const path = `events?select=${cols}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc`;

    const { rows: events, capped } = await fetchAll(key, path, DETAIL_ROW_CAP);

    const pageviews  = events.filter(e => e.event_type === 'pageview');
    const sessionEnd = events.filter(e => e.event_type === 'session_end');
    const scrollEvts = events.filter(e => e.event_type === 'scroll');
    const clickEvts  = events.filter(e => e.event_type === 'click');
    const searchEvts = events.filter(e => e.event_type === 'search');

    const visitorSet = new Set(pageviews.map(e => e.visitor_id).filter(Boolean));
    const sessionSet = new Set(pageviews.map(e => e.session_id).filter(Boolean));

    // Average session duration, ignoring implausible outliers.
    const durations = sessionEnd.map(e => e.duration_ms).filter(v => v > 0 && v < 3600000);
    const avgDurationSec = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000)
      : 0;
    const medianDurationSec = durations.length
      ? Math.round(durations.slice().sort((a, b) => a - b)[Math.floor(durations.length / 2)] / 1000)
      : 0;

    // Returning vs new, counted by VISITOR not by pageview. The old version
    // compared a pageview count against a visitor count, so a returning
    // visitor who viewed five pages counted as five returning "visitors" and
    // new_visitors could go negative.
    const returningVisitors = new Set(
      pageviews.filter(e => e.metadata && typeof e.metadata === 'object' && e.metadata.returning === true)
               .map(e => e.visitor_id).filter(Boolean),
    );
    const returningCount = returningVisitors.size;
    const newCount = Math.max(0, visitorSet.size - returningCount);

    // Pageviews per day, every day in range filled in.
    const byDayMap = {};
    for (const e of pageviews) {
      const d = e.created_at.slice(0, 10);
      byDayMap[d] = (byDayMap[d] || 0) + 1;
    }
    const spanDays = isAll
      ? Math.max(1, Math.ceil((Date.now() - new Date(since).getTime()) / 86400000))
      : days;
    const pageviewsByDay = [];
    for (let i = Math.min(spanDays, 3650) - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      pageviewsByDay.push({ date: d, count: byDayMap[d] || 0 });
    }

    // Engagement
    const pagesPerSession = sessionSet.size
      ? Math.round((pageviews.length / sessionSet.size) * 100) / 100
      : 0;
    const sessionPageCounts = {};
    for (const e of pageviews) if (e.session_id) sessionPageCounts[e.session_id] = (sessionPageCounts[e.session_id] || 0) + 1;
    const singlePage = Object.values(sessionPageCounts).filter(n => n === 1).length;
    const bounceRate = sessionSet.size ? Math.round((singlePage / sessionSet.size) * 1000) / 10 : 0;

    // When people visit — useful for scheduling posts.
    const byHour = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, '0') + ':00', count: 0 }));
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byWeekday = DOW.map(d => ({ label: d, count: 0 }));
    for (const e of pageviews) {
      const t = new Date(e.created_at);
      byHour[t.getUTCHours()].count++;
      byWeekday[t.getUTCDay()].count++;
    }

    // Scroll depth as a share of sessions, deduped — one session hitting 50%
    // twice was previously counted twice.
    const scrollDepth = [25, 50, 75, 100].map(m => {
      const sessions = new Set(
        scrollEvts.filter(e => e.scroll_depth === m).map(e => e.session_id).filter(Boolean),
      );
      return {
        label: m + '%',
        count: sessions.size,
        pct: sessionSet.size ? Math.round((sessions.size / sessionSet.size) * 1000) / 10 : 0,
      };
    });

    const reqHost = req.headers['x-forwarded-host'] || req.headers.host;
    const topReferrers = countArr(
      pageviews.map(e => e.referrer).filter(Boolean)
        .map(hostname).filter(h => !isSelfReferral(h, reqHost)),
    ).slice(0, 10);

    const topUTMSources = countArr(
      pageviews.map(e => e.utm_source || (e.metadata && e.metadata.utm_source)).filter(Boolean),
    ).slice(0, 10);

    const clicksOn = (el) => clickEvts.filter(e => e.element === el).map(e => e.element_label).filter(Boolean);

    return res.status(200).json({
      generated_at: new Date().toISOString(),
      range_days: isAll ? 'all' : days,
      range_start: since,
      // True when the detail breakdowns hit the row cap. The dashboard shows a
      // notice so a truncated chart is never mistaken for a complete one.
      detail_truncated: capped,
      detail_row_cap: DETAIL_ROW_CAP,

      lifetime,

      summary: {
        total_pageviews: pageviews.length,
        unique_visitors: visitorSet.size,
        unique_sessions: sessionSet.size,
        avg_duration_sec: avgDurationSec,
        median_duration_sec: medianDurationSec,
        returning_visitors: returningCount,
        new_visitors: newCount,
        pages_per_session: pagesPerSession,
        bounce_rate_pct: bounceRate,
        total_events: events.length,
      },

      pageviews_by_day: pageviewsByDay,
      by_page:     countBy(pageviews, 'page'),
      by_device:   countBy(pageviews, 'device_type'),
      by_browser:  countBy(pageviews, 'browser'),
      by_os:       countBy(pageviews, 'os'),
      by_hour:     byHour,
      by_weekday:  byWeekday,

      top_referrers:   topReferrers,
      top_utm_sources: topUTMSources,
      scroll_depth:    scrollDepth,

      top_programs:  countArr(clicksOn('program_card')).slice(0, 15),
      top_events:    countArr(clicksOn('event_card')).slice(0, 10),
      top_nav_tabs:  countArr(clicksOn('nav_tab')),
      top_filters:   countArr(clicksOn('filter_checkbox')).slice(0, 15),
      top_apply:     countArr(clicksOn('apply_click')).slice(0, 15),
      top_searches:  countArr(searchEvts.map(e => e.search_query).filter(Boolean)).slice(0, 15),
      top_links: countArr(
        clicksOn('external_link').map(u => {
          try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + x.pathname.slice(0, 30); }
          catch { return u; }
        }),
      ).slice(0, 10),
    });
  } catch (e) {
    console.error('[analytics] error:', e);
    return res.status(502).json({ error: 'db_error', detail: String(e.message || e) });
  }
}
