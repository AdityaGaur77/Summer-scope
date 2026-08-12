-- ═══════════════════════════════════════════════════════════════════════════
-- SummerScope analytics — durable lifetime storage
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query
-- → paste → Run). It is idempotent: running it again is safe and changes
-- nothing that already exists.
--
-- WHY THIS EXISTS
--
-- The raw `events` table is the source of truth, but it is a poor place to
-- read lifetime numbers from:
--
--   * counting distinct visitors across all time means scanning every row,
--     which gets slower every week;
--   * PostgREST cannot express COUNT(DISTINCT ...) at all, so the API had to
--     approximate it;
--   * if the table is ever pruned to save space, the history is simply gone.
--
-- So this migration adds two small, permanent tables that accumulate rather
-- than expire. Once a day is rolled up, its numbers are fixed forever — you
-- can delete raw events from 2026 and still see 2026 in the dashboard.
--
--   analytics_daily     one row per (day, page) — counts that never expire
--   analytics_visitors  one row per visitor ever seen — exact lifetime uniques
--
-- Nothing here deletes or rewrites anything in `events`.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Indexes on the raw event log ────────────────────────────────────────────
-- Everything the API does filters on created_at and event_type.
CREATE INDEX IF NOT EXISTS events_created_at_idx  ON public.events (created_at DESC);
CREATE INDEX IF NOT EXISTS events_type_time_idx   ON public.events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS events_visitor_idx     ON public.events (visitor_id) WHERE visitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_session_idx     ON public.events (session_id) WHERE session_id IS NOT NULL;


-- ── Durable daily rollup ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.analytics_daily (
  day         date    NOT NULL,
  page        text    NOT NULL DEFAULT 'all',
  pageviews   integer NOT NULL DEFAULT 0,
  sessions    integer NOT NULL DEFAULT 0,
  visitors    integer NOT NULL DEFAULT 0,
  events      integer NOT NULL DEFAULT 0,
  clicks      integer NOT NULL DEFAULT 0,
  searches    integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, page)
);

COMMENT ON TABLE public.analytics_daily IS
  'Permanent per-day counts. Survives pruning of the raw events table.';


-- ── Durable visitor ledger ──────────────────────────────────────────────────
-- One row per visitor_id ever seen. This is what makes lifetime unique-visitor
-- counts both exact and cheap: it is a single COUNT(*) on a table that grows
-- with your audience, not with your traffic.
CREATE TABLE IF NOT EXISTS public.analytics_visitors (
  visitor_id  text PRIMARY KEY,
  first_seen  timestamptz NOT NULL,
  last_seen   timestamptz NOT NULL,
  pageviews   integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.analytics_visitors IS
  'One row per visitor ever seen. Gives exact lifetime uniques without scanning events.';


-- ── Durable session ledger ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.analytics_sessions (
  session_id  text PRIMARY KEY,
  visitor_id  text,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz NOT NULL,
  pageviews   integer NOT NULL DEFAULT 0,
  duration_ms integer
);


-- ═══════════════════════════════════════════════════════════════════════════
-- Rollup: fold raw events into the permanent tables.
-- Safe to run repeatedly — each day is recomputed and upserted.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.summerscope_rollup(p_days integer DEFAULT 3)
RETURNS TABLE (days_rolled integer, visitors_tracked bigint, sessions_tracked bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz := date_trunc('day', now()) - make_interval(days => GREATEST(p_days, 0));
BEGIN
  -- Per-day, per-page counts
  INSERT INTO analytics_daily AS d (day, page, pageviews, sessions, visitors, events, clicks, searches, updated_at)
  SELECT
    (e.created_at AT TIME ZONE 'UTC')::date                                   AS day,
    COALESCE(e.page, 'unknown')                                               AS page,
    COUNT(*) FILTER (WHERE e.event_type = 'pageview')                         AS pageviews,
    COUNT(DISTINCT e.session_id) FILTER (WHERE e.event_type = 'pageview')     AS sessions,
    COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.event_type = 'pageview')     AS visitors,
    COUNT(*)                                                                  AS events,
    COUNT(*) FILTER (WHERE e.event_type = 'click')                            AS clicks,
    COUNT(*) FILTER (WHERE e.event_type = 'search')                           AS searches
  FROM events e
  WHERE e.created_at >= v_from
  GROUP BY 1, 2
  ON CONFLICT (day, page) DO UPDATE SET
    pageviews  = EXCLUDED.pageviews,
    sessions   = EXCLUDED.sessions,
    visitors   = EXCLUDED.visitors,
    events     = EXCLUDED.events,
    clicks     = EXCLUDED.clicks,
    searches   = EXCLUDED.searches,
    updated_at = now();

  -- Visitor ledger. first_seen only ever moves backwards, last_seen forwards,
  -- so re-running never loses an earlier sighting.
  INSERT INTO analytics_visitors AS v (visitor_id, first_seen, last_seen, pageviews)
  SELECT e.visitor_id, MIN(e.created_at), MAX(e.created_at),
         COUNT(*) FILTER (WHERE e.event_type = 'pageview')
  FROM events e
  WHERE e.visitor_id IS NOT NULL AND e.created_at >= v_from
  GROUP BY e.visitor_id
  ON CONFLICT (visitor_id) DO UPDATE SET
    first_seen = LEAST(v.first_seen, EXCLUDED.first_seen),
    last_seen  = GREATEST(v.last_seen, EXCLUDED.last_seen),
    pageviews  = v.pageviews + EXCLUDED.pageviews;

  -- Session ledger
  INSERT INTO analytics_sessions AS s (session_id, visitor_id, started_at, ended_at, pageviews, duration_ms)
  SELECT e.session_id, MIN(e.visitor_id), MIN(e.created_at), MAX(e.created_at),
         COUNT(*) FILTER (WHERE e.event_type = 'pageview'),
         MAX(e.duration_ms) FILTER (WHERE e.event_type = 'session_end')
  FROM events e
  WHERE e.session_id IS NOT NULL AND e.created_at >= v_from
  GROUP BY e.session_id
  ON CONFLICT (session_id) DO UPDATE SET
    started_at  = LEAST(s.started_at, EXCLUDED.started_at),
    ended_at    = GREATEST(s.ended_at, EXCLUDED.ended_at),
    pageviews   = GREATEST(s.pageviews, EXCLUDED.pageviews),
    duration_ms = COALESCE(EXCLUDED.duration_ms, s.duration_ms);

  RETURN QUERY
  SELECT p_days,
         (SELECT COUNT(*) FROM analytics_visitors),
         (SELECT COUNT(*) FROM analytics_sessions);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- Lifetime totals. The API calls this first and falls back to counting raw
-- events if this function isn't installed.
--
-- Reads from the permanent tables where they have data and tops up from raw
-- events for anything not yet rolled up, so the number is correct even if the
-- nightly rollup hasn't run yet today.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.summerscope_lifetime()
RETURNS TABLE (
  total_pageviews bigint,
  unique_visitors bigint,
  unique_sessions bigint,
  total_events    bigint,
  first_event_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM events WHERE event_type = 'pageview')::bigint,
    GREATEST(
      (SELECT COUNT(*) FROM analytics_visitors),
      (SELECT COUNT(DISTINCT visitor_id) FROM events WHERE visitor_id IS NOT NULL)
    )::bigint,
    GREATEST(
      (SELECT COUNT(*) FROM analytics_sessions),
      (SELECT COUNT(DISTINCT session_id) FROM events WHERE session_id IS NOT NULL)
    )::bigint,
    (SELECT COUNT(*) FROM events)::bigint,
    LEAST(
      (SELECT MIN(created_at) FROM events),
      COALESCE((SELECT MIN(first_seen) FROM analytics_visitors), (SELECT MIN(created_at) FROM events))
    );
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- Daily series straight from the permanent rollup — covers the whole history
-- even for days whose raw events have been deleted.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.summerscope_daily(p_from date DEFAULT NULL)
RETURNS TABLE (day date, pageviews bigint, sessions bigint, visitors bigint, events bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT day,
         SUM(pageviews)::bigint,
         SUM(sessions)::bigint,
         SUM(visitors)::bigint,
         SUM(events)::bigint
  FROM analytics_daily
  WHERE p_from IS NULL OR day >= p_from
  GROUP BY day
  ORDER BY day;
$$;


-- ── Permissions ─────────────────────────────────────────────────────────────
-- The API authenticates with the service key, which bypasses RLS. These tables
-- are locked down so nothing is readable with the public anon key.
ALTER TABLE public.analytics_daily    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.summerscope_lifetime() FROM anon;
REVOKE ALL ON FUNCTION public.summerscope_daily(date) FROM anon;
REVOKE ALL ON FUNCTION public.summerscope_rollup(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.summerscope_lifetime() TO service_role;
GRANT EXECUTE ON FUNCTION public.summerscope_daily(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.summerscope_rollup(integer) TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL — run once, now, to fold all existing history into the permanent
-- tables. 4000 days ≈ 11 years, i.e. everything.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT * FROM public.summerscope_rollup(4000);


-- ═══════════════════════════════════════════════════════════════════════════
-- OPTIONAL — keep it current automatically.
--
-- Supabase ships pg_cron. Enable it under Database → Extensions, then run the
-- statement below to roll up the last three days every night at 03:10 UTC.
-- (Three days rather than one so a late-arriving event or a missed night is
-- picked up on the next run.)
--
--   SELECT cron.schedule(
--     'summerscope-rollup',
--     '10 3 * * *',
--     $cron$ SELECT public.summerscope_rollup(3); $cron$
--   );
--
-- Not required: /api/analytics tops the rollup up from raw events on every
-- request, so the numbers are correct with or without the cron job. The job
-- only matters if you ever start deleting old rows from `events`.
-- ═══════════════════════════════════════════════════════════════════════════
