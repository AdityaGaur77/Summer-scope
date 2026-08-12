// SummerScope Analytics — client-side tracking
// Tracks: pageviews, scroll depth, time on page, clicks, search, filters, sort
// All events are sent to /api/track (Vercel serverless → Supabase)

(function () {
  'use strict';

  const ENDPOINT = '/api/track';
  const pageStart = Date.now();

  // ── Unique IDs ────────────────────────────────────────────────────────
  function uuid() {
    try { return crypto.randomUUID(); } catch (_) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // visitor_id persists across sessions (returning visitor detection)
  function getVid() {
    try {
      let v = localStorage.getItem('_ss_vid');
      if (!v) { v = uuid(); localStorage.setItem('_ss_vid', v); }
      return v;
    } catch (_) { return 'anon'; }
  }

  // session_id resets each browser tab / new session
  function getSid() {
    try {
      let s = sessionStorage.getItem('_ss_sid');
      if (!s) { s = uuid(); sessionStorage.setItem('_ss_sid', s); }
      return s;
    } catch (_) { return 'anon'; }
  }

  // ── Device detection ──────────────────────────────────────────────────
  function deviceType() {
    const w = window.innerWidth;
    return w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop';
  }

  function getBrowser() {
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua))     return 'Edge';
    if (/OPR\//.test(ua))     return 'Opera';
    if (/Chrome\//.test(ua))  return 'Chrome';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Safari\//.test(ua))  return 'Safari';
    return 'Other';
  }

  function getOS() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad/.test(ua))          return 'iOS';
    if (/Android/.test(ua))              return 'Android';
    if (/Windows/.test(ua))              return 'Windows';
    if (/Macintosh|Mac OS X/.test(ua))   return 'macOS';
    if (/Linux/.test(ua))                return 'Linux';
    return 'Other';
  }

  // ── Source / UTM ──────────────────────────────────────────────────────
  const qp = new URLSearchParams(window.location.search);
  const pageName = window.location.pathname.includes('landing') ? 'landing' : 'index';

  // Persist UTM params in sessionStorage so they survive internal navigation
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
    const v = qp.get(k);
    if (v) sessionStorage.setItem('_ss_' + k, v);
  });

  function getUTM(key) {
    return qp.get(key) || sessionStorage.getItem('_ss_' + key) || null;
  }

  // ── Base payload (attached to every event) ────────────────────────────
  function base() {
    return {
      session_id:   getSid(),
      visitor_id:   getVid(),
      page:         pageName,
      device_type:  deviceType(),
      screen_width: window.innerWidth,
      browser:      getBrowser(),
      os:           getOS(),
      utm_source:   getUTM('utm_source'),
      utm_medium:   getUTM('utm_medium'),
      utm_campaign: getUTM('utm_campaign'),
    };
  }

  // ── Fire & forget ─────────────────────────────────────────────────────
  function send(data) {
    try {
      const payload = JSON.stringify(Object.assign(base(), data));
      if (navigator.sendBeacon) {
        // sendBeacon survives page close; Blob sets Content-Type
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        });
      }
    } catch (_) { /* never crash the page */ }
  }

  // ════════════════════════════════════════════════════════════════════
  // 1. PAGEVIEW
  //    Captures: page, referrer, full URL, UTM params, screen info,
  //    timezone, language, and whether this is a returning visitor.
  // ════════════════════════════════════════════════════════════════════
  const isReturning = (function () {
    try { return !!localStorage.getItem('_ss_vid_set'); } catch (_) { return false; }
  })();
  try { localStorage.setItem('_ss_vid_set', '1'); } catch (_) {}

  send({
    event_type: 'pageview',
    referrer:   document.referrer || null,
    metadata: {
      url:            window.location.href,
      path:           window.location.pathname,
      title:          document.title,
      screen_height:  window.screen.height,
      timezone:       Intl.DateTimeFormat().resolvedOptions().timeZone,
      language:       navigator.language,
      returning:      isReturning,
      utm_term:       getUTM('utm_term'),
      utm_content:    getUTM('utm_content'),
    },
  });

  // ════════════════════════════════════════════════════════════════════
  // 2. SCROLL DEPTH
  //    Fires once each at 25 / 50 / 75 / 100 % per session.
  // ════════════════════════════════════════════════════════════════════
  const scrollHits = new Set();
  let scrollQueued = false;
  window.addEventListener('scroll', function () {
    // Coalesce to one measurement per frame — the handler reads
    // scrollHeight, which forces layout, and scroll fires very often.
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(function () {
      scrollQueued = false;
      const total = document.documentElement.scrollHeight - window.innerHeight;
      if (total <= 0) return;
      const pct = Math.round((window.scrollY / total) * 100);
      [25, 50, 75, 100].forEach(function (m) {
        if (pct >= m && !scrollHits.has(m)) {
          scrollHits.add(m);
          send({ event_type: 'scroll', scroll_depth: m });
        }
      });
    });
  }, { passive: true });

  // ════════════════════════════════════════════════════════════════════
  // 3. TIME ON PAGE / SESSION END
  //    Measures ACTIVE time — the clock pauses while the tab is hidden.
  //    The previous version stopped counting at the first tab switch and
  //    never resumed, so any visitor who checked another tab mid-visit had
  //    their whole session recorded as however long they'd been reading
  //    before that moment.
  // ════════════════════════════════════════════════════════════════════
  let activeMs = 0;
  let lastResume = Date.now();
  let visible = document.visibilityState !== 'hidden';
  let endSent = false;

  function activeDuration() {
    return activeMs + (visible ? Date.now() - lastResume : 0);
  }

  function sendEnd() {
    if (endSent) return;
    endSent = true;
    send({
      event_type:  'session_end',
      duration_ms: activeDuration(),
      metadata: {
        scroll_depth_reached: Math.max.apply(null, [0].concat(Array.from(scrollHits))),
        wall_clock_ms:        Date.now() - pageStart,
      },
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      if (visible) { activeMs += Date.now() - lastResume; visible = false; }
      // A hidden tab may never come back — on mobile the process can be
      // killed outright — so flush now. `endSent` keeps it to one row.
      sendEnd();
    } else if (!visible) {
      visible = true;
      lastResume = Date.now();
    }
  });
  window.addEventListener('pagehide', sendEnd);

  // ════════════════════════════════════════════════════════════════════
  // 4. CLICKS — event delegation (capture phase)
  //    Targets: nav tabs, event-type filter buttons, program cards,
  //    event cards, sidebar filter checkboxes, clear-filters, external
  //    links (apply / website links), sort dropdown, other buttons.
  // ════════════════════════════════════════════════════════════════════
  /** Read a card's title, falling back through the usual heading elements. */
  function titleOf(root, sel) {
    const el = root.querySelector(sel) || root.querySelector('h1, h2, h3, strong');
    return el ? el.textContent.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
  }

  document.addEventListener('click', function (e) {
    const t = e.target;

    // 4a. Nav tabs (Programs / Events & Competitions)
    const ntab = t.closest('.ntab');
    if (ntab) {
      send({
        event_type:    'click',
        element:       'nav_tab',
        element_label: ntab.textContent.trim().replace(/\s+/g, ' ').slice(0, 80),
      });
      return;
    }

    // 4b. Events page type-filter buttons (Hackathon / Competition / Award)
    const efbtn = t.closest('.efbtn');
    if (efbtn) {
      send({
        event_type:    'click',
        element:       'event_filter_btn',
        element_label: efbtn.getAttribute('data-t') || efbtn.textContent.trim(),
      });
      return;
    }

    // 4c. Apply / official-website buttons.
    //     These are <button onclick="window.open(...)">, not anchors, so the
    //     outbound-link branch below never sees them — and because they sit
    //     inside a .card they used to be recorded as an ordinary card click.
    //     They are the single most valuable signal on the site: an actual
    //     click through to a program. Checked before the card branch.
    const applyBtn = t.closest('.abtn, .mapp');
    if (applyBtn) {
      const host = applyBtn.closest('.card');
      const name = host ? titleOf(host, '.ctitle') : titleOf(document, '.mtitle');
      send({
        event_type:    'click',
        element:       'apply_click',
        element_label: name || applyBtn.textContent.trim().slice(0, 80),
        metadata:      { source: host ? 'card' : 'modal' },
      });
      return;
    }

    // 4d. Program cards (dynamically rendered)
    const card = t.closest('.card');
    if (card) {
      send({
        event_type:    'click',
        element:       'program_card',
        // .ctitle is the program name. The old selector list didn't include
        // it, so every label was the entire card's text content — which made
        // the "most clicked programs" table unreadable.
        element_label: titleOf(card, '.ctitle') || card.textContent.trim().slice(0, 120),
      });
      return;
    }

    // 4e. Event / competition cards
    const ecard = t.closest('.ecard');
    if (ecard) {
      send({
        event_type:    'click',
        element:       'event_card',
        element_label: titleOf(ecard, '.etitle') || ecard.textContent.trim().slice(0, 120),
      });
      return;
    }

    // 4e. Sidebar filter checkboxes — capture which filter + value + state
    const fo = t.closest('.fo');
    if (fo) {
      const cb = fo.querySelector('input[type=checkbox]');
      if (cb) {
        send({
          event_type:    'click',
          element:       'filter_checkbox',
          element_label: (cb.name || '') + ':' + (cb.value || ''),
          metadata: {
            filter_group: cb.name,
            filter_value: cb.value,
            checked:      cb.checked,
          },
        });
      }
      return;
    }

    // 4f. Clear all filters
    if (t.closest('.clr')) {
      send({ event_type: 'click', element: 'clear_filters' });
      return;
    }

    // 4g. External / outbound links (apply links, program websites, etc.)
    const a = t.closest('a[href]');
    if (a && a.hostname && a.hostname !== window.location.hostname) {
      send({
        event_type:    'click',
        element:       'external_link',
        element_label: a.href.slice(0, 200),
        metadata:      { link_text: a.textContent.trim().slice(0, 80) },
      });
      return;
    }

    // 4h. Landing page CTA buttons / any remaining buttons
    const btn = t.closest('button');
    if (btn) {
      const label = btn.textContent.trim().replace(/\s+/g, ' ').slice(0, 80);
      if (label) {
        send({ event_type: 'click', element: 'button', element_label: label });
      }
    }

  }, true); // capture phase — fires before the page's own onclick handlers

  // ════════════════════════════════════════════════════════════════════
  // 5. SORT DROPDOWN
  // ════════════════════════════════════════════════════════════════════
  document.addEventListener('change', function (e) {
    const sel = e.target.closest('.ssel, select');
    if (sel) {
      send({
        event_type:    'click',
        element:       'sort_dropdown',
        element_label: sel.value,
      });
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // 6. SEARCH (debounced — fires 800 ms after the user stops typing)
  // ════════════════════════════════════════════════════════════════════
  let searchTimer;
  function hookSearch() {
    const inp =
      document.getElementById('si') ||
      document.querySelector('.sbar input, input[type="search"]');
    if (!inp || inp._ss_hooked) return;
    inp._ss_hooked = true;
    inp.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        const q = inp.value.trim();
        if (q.length > 1) {
          send({ event_type: 'search', search_query: q.slice(0, 100) });
        }
      }, 800);
    });
  }
  hookSearch();
  // Retry after data loads (cards are rendered asynchronously)
  setTimeout(hookSearch, 1200);

})();
