// SummerScope — client-side visit tracking.
//
// Tracks pageviews, scroll depth, active time, clicks, search and filter use,
// and posts them to /api/collect (which Vercel rewrites to api/track.js).
//
// ── Why this file is not called analytics.bundle.js ──────────────────────────
// It was, and it posted to /api/track. Both names are on the standard blocklists
// that ship with uBlock Origin, Brave and Safari's content blockers — the
// filenames `analytics*.js` and request paths containing `/track` are matched by
// EasyPrivacy directly. Every reader with a blocker was invisible, which on a
// site aimed at teenagers is a large and non-random share of the audience: it
// does not lower the visit count evenly, it deletes exactly the more
// technical visitors. First-party names that describe the file honestly are not
// on those lists.
//
// ── What "accurate" means here ───────────────────────────────────────────────
// Every rule below exists because it was over- or under-counting real visits:
//
//   · A blocked localStorage used to return the literal string 'anon' as the
//     visitor ID. Every private-window and cookie-blocked reader therefore
//     shared one ID and collapsed into a single "unique visitor". They now get
//     a random per-page ID, which counts them once each instead of once in total.
//   · sendBeacon returns false when the browser's queue is full. The old code
//     ignored the return value and dropped the event.
//   · A prerendered page (Chrome speculation rules, a link preview) executed
//     this script and logged a view nobody saw.
//   · A back/forward-cache restore fired nothing at all, so a reader returning
//     to the tab was not counted.
//   · Crawlers were counted as people. They are dropped server-side by
//     user-agent, and headless browsers are dropped here.

(function () {
  'use strict';

  // Two copies of the tag on one page would double every number.
  if (window.__ssInsights) return;
  window.__ssInsights = true;

  var ENDPOINT = '/api/collect';
  var pageStart = Date.now();

  // Automation is not an audience. navigator.webdriver is set by Selenium,
  // Playwright and Puppeteer; the UA check catches the headless Chrome that
  // link unfurlers and screenshot services run.
  if (navigator.webdriver === true || /HeadlessChrome|Puppeteer|Playwright|Lighthouse/i.test(navigator.userAgent)) {
    return;
  }

  // ── IDs ───────────────────────────────────────────────────────────────────
  function uuid() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  /**
   * Read-through cache over a Storage object that never throws and never
   * returns a shared constant. When storage is unavailable the ID is random and
   * lives only in this page, so the visitor is counted once rather than merged
   * with every other blocked visitor.
   */
  function stableId(store, key) {
    try {
      var s = window[store];
      var v = s.getItem(key);
      if (!v) { v = uuid(); s.setItem(key, v); }
      return v;
    } catch (_) {
      return uuid();
    }
  }

  var visitorId = stableId('localStorage', '_ss_vid');
  var sessionId = stableId('sessionStorage', '_ss_sid');

  // Returning is a separate key from the ID: it has to be read before it is
  // written, and the ID may have been created several lines above.
  var isReturning = false;
  try {
    isReturning = !!localStorage.getItem('_ss_seen');
    localStorage.setItem('_ss_seen', '1');
  } catch (_) {}

  // ── Environment ───────────────────────────────────────────────────────────
  function deviceType() {
    var w = window.innerWidth;
    return w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop';
  }

  function getBrowser() {
    var ua = navigator.userAgent;
    if (/Edg\//.test(ua))     return 'Edge';
    if (/OPR\//.test(ua))     return 'Opera';
    if (/Chrome\//.test(ua))  return 'Chrome';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Safari\//.test(ua))  return 'Safari';
    return 'Other';
  }

  function getOS() {
    var ua = navigator.userAgent;
    if (/iPhone|iPad/.test(ua))        return 'iOS';
    if (/Android/.test(ua))            return 'Android';
    if (/Windows/.test(ua))            return 'Windows';
    if (/Macintosh|Mac OS X/.test(ua)) return 'macOS';
    if (/Linux/.test(ua))              return 'Linux';
    return 'Other';
  }

  var qp = new URLSearchParams(window.location.search);
  var pageName = window.location.pathname.indexOf('landing') !== -1 ? 'landing' : 'index';

  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
    var v = qp.get(k);
    if (v) { try { sessionStorage.setItem('_ss_' + k, v); } catch (_) {} }
  });

  function getUTM(key) {
    var fromUrl = qp.get(key);
    if (fromUrl) return fromUrl;
    try { return sessionStorage.getItem('_ss_' + key); } catch (_) { return null; }
  }

  function base() {
    return {
      session_id:   sessionId,
      visitor_id:   visitorId,
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

  // ── Transport ─────────────────────────────────────────────────────────────
  /**
   * sendBeacon first — it is the only transport that survives the page closing.
   * It returns false when the browser's beacon queue is over budget, and the old
   * version treated that as success, so events at the end of a busy session were
   * silently lost. A false return falls through to keepalive fetch.
   */
  function post(payload) {
    if (navigator.sendBeacon) {
      try {
        var blob = new Blob([payload], { type: 'application/json' });
        if (navigator.sendBeacon(ENDPOINT, blob)) return;
      } catch (_) { /* fall through */ }
    }
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
        credentials: 'omit',
      }).catch(function () {});
    } catch (_) {}
  }

  // Events raised before the page is activated (a prerender) are held here and
  // flushed once a human actually looks at it.
  var queue = [];
  var live = false;

  function send(data) {
    try {
      var payload = JSON.stringify(Object.assign(base(), data));
      if (!live) { queue.push(payload); return; }
      post(payload);
    } catch (_) { /* never break the page for a metric */ }
  }

  function flush() {
    live = true;
    while (queue.length) post(queue.shift());
  }

  // ── 1. PAGEVIEW ───────────────────────────────────────────────────────────
  function pageview(extra) {
    send({
      event_type: 'pageview',
      referrer:   document.referrer || null,
      metadata: Object.assign({
        url:           window.location.href,
        path:          window.location.pathname,
        title:         document.title,
        screen_height: window.screen.height,
        timezone:      (function () {
          try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) { return null; }
        })(),
        language:      navigator.language,
        returning:     isReturning,
        utm_term:      getUTM('utm_term'),
        utm_content:   getUTM('utm_content'),
      }, extra || {}),
    });
  }

  pageview();

  /**
   * A prerendered document runs its scripts before anyone has seen it, and the
   * prerender is often discarded. Counting it inflates views — and inflates them
   * for popular pages specifically, which is the worst place to be wrong. Hold
   * everything until activation.
   */
  if (document.prerendering) {
    document.addEventListener('prerenderingchange', flush, { once: true });
  } else {
    flush();
  }

  // ── 2. SCROLL DEPTH — once each at 25/50/75/100% ──────────────────────────
  var scrollHits = {};
  var scrollQueued = false;
  window.addEventListener('scroll', function () {
    // One measurement per frame: the handler reads scrollHeight, which forces
    // layout, and scroll fires far more often than that.
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(function () {
      scrollQueued = false;
      var total = document.documentElement.scrollHeight - window.innerHeight;
      if (total <= 0) return;
      var pct = Math.round((window.scrollY / total) * 100);
      [25, 50, 75, 100].forEach(function (m) {
        if (pct >= m && !scrollHits[m]) {
          scrollHits[m] = true;
          send({ event_type: 'scroll', scroll_depth: m });
        }
      });
    });
  }, { passive: true });

  // ── 3. ACTIVE TIME ────────────────────────────────────────────────────────
  // The clock pauses while the tab is hidden, so "time on page" is time the
  // reader was actually looking.
  //
  // The flush is the subtle part. A hidden tab may never come back — on mobile
  // the process is often killed outright — so the duration has to go out at the
  // first hide. But a reader who checks another tab and returns keeps reading,
  // and the old code, having sent once, never sent again: their whole visit was
  // recorded as however long they had read before the first tab switch. Now a
  // later hide sends an updated row, and /api/analytics keeps the longest
  // duration per session rather than averaging the partials.
  var activeMs = 0;
  var lastResume = Date.now();
  var visible = document.visibilityState !== 'hidden';
  var sentSeq = 0;

  function activeDuration() {
    return activeMs + (visible ? Date.now() - lastResume : 0);
  }

  function sendEnd(final) {
    var ms = activeDuration();
    // Nothing new to say: don't spend a row on it.
    if (sentSeq > 0 && ms - sentSeq < 1000 && !final) return;
    sentSeq = ms;
    var maxDepth = Object.keys(scrollHits).reduce(function (a, b) { return Math.max(a, +b); }, 0);
    send({
      event_type:  'session_end',
      duration_ms: ms,
      metadata: {
        scroll_depth_reached: maxDepth,
        wall_clock_ms:        Date.now() - pageStart,
      },
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      if (visible) { activeMs += Date.now() - lastResume; visible = false; }
      sendEnd(false);
    } else if (!visible) {
      visible = true;
      lastResume = Date.now();
    }
  });
  window.addEventListener('pagehide', function () { sendEnd(true); });

  /**
   * Back/forward-cache restore. The page was frozen, not reloaded, so no script
   * runs again — the old version recorded nothing and lost the visit. This is a
   * genuine second view of the page by the same session.
   */
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    activeMs = 0;
    lastResume = Date.now();
    visible = document.visibilityState !== 'hidden';
    sentSeq = 0;
    pageStart = Date.now();
    pageview({ restored: true });
  });

  // ── 4. CLICKS — one delegated listener, capture phase ─────────────────────
  /** A card's own title, not its entire text content. */
  function titleOf(root, sel) {
    var el = root.querySelector(sel) || root.querySelector('h1, h2, h3, strong');
    return el ? el.textContent.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
  }

  function label(el, max) {
    return el.textContent.trim().replace(/\s+/g, ' ').slice(0, max || 80);
  }

  document.addEventListener('click', function (e) {
    var t = e.target;

    // Section tabs — the desktop row and the phone bottom bar both carry
    // data-page, so one branch covers navigation on every screen size.
    var tab = t.closest('[data-page]');
    if (tab) {
      send({ event_type: 'click', element: 'nav_tab', element_label: tab.getAttribute('data-page') });
      return;
    }

    // Event-type filter buttons on the events page.
    var efbtn = t.closest('.efbtn');
    if (efbtn) {
      send({
        event_type: 'click', element: 'event_filter_btn',
        element_label: efbtn.getAttribute('data-t') || label(efbtn),
      });
      return;
    }

    // Apply / official-website buttons. Checked before the card branch: these
    // sit inside a .card, and a click-through to a program is the single most
    // valuable signal on the site — it must not be filed as a card open.
    var apply = t.closest('.abtn, .mapp');
    if (apply) {
      var host = apply.closest('.card');
      send({
        event_type: 'click', element: 'apply_click',
        element_label: (host ? titleOf(host, '.ctitle') : titleOf(document, '.mtitle')) || label(apply),
        metadata: { source: host ? 'card' : 'modal' },
      });
      return;
    }

    var card = t.closest('.card');
    if (card) {
      send({
        event_type: 'click', element: 'program_card',
        element_label: titleOf(card, '.ctitle') || label(card, 120),
      });
      return;
    }

    var ecard = t.closest('.ecard');
    if (ecard) {
      send({
        event_type: 'click', element: 'event_card',
        element_label: titleOf(ecard, '.etitle') || label(ecard, 120),
      });
      return;
    }

    // Quick-filter chips above the results.
    var qchip = t.closest('.qchip');
    if (qchip) {
      send({
        event_type: 'click', element: 'filter_checkbox',
        element_label: qchip.getAttribute('data-group') + ':' + qchip.getAttribute('data-value'),
        metadata: {
          filter_group: qchip.getAttribute('data-group'),
          filter_value: qchip.getAttribute('data-value'),
          via: 'quick_chip',
        },
      });
      return;
    }

    // Sidebar checkboxes are handled by the `change` listener below, not here:
    // clicking the label text fires this listener twice — once for the label and
    // once for the click it synthesises on the input — and `checked` reads
    // differently in each. One `change` per toggle, with the settled state.
    if (t.closest('.fo')) return;

    // Removing one active filter chip, or clearing them all.
    var chip = t.closest('#chips button, .sb-reset');
    if (chip) {
      send({
        event_type: 'click',
        element: chip.classList.contains('sb-reset') || chip.getAttribute('data-clear') === 'all'
          ? 'clear_filters' : 'remove_filter',
        element_label: chip.getAttribute('data-group')
          ? chip.getAttribute('data-group') + ':' + chip.getAttribute('data-value')
          : label(chip),
      });
      return;
    }

    // Opening the filter panel — worth knowing on a phone, where it is a sheet.
    if (t.closest('#filter-btn, #mn-filter')) {
      send({ event_type: 'click', element: 'open_filters' });
      return;
    }

    if (t.closest('#theme-btn')) {
      send({
        event_type: 'click', element: 'theme_toggle',
        element_label: document.documentElement.getAttribute('data-theme') === 'light' ? 'to_dark' : 'to_light',
      });
      return;
    }

    // Any remaining outbound anchor.
    var a = t.closest('a[href]');
    if (a && a.hostname && a.hostname !== window.location.hostname) {
      send({
        event_type: 'click', element: 'external_link',
        element_label: a.href.slice(0, 200),
        metadata: { link_text: label(a) },
      });
      return;
    }

    var btn = t.closest('button');
    if (btn && label(btn)) {
      send({ event_type: 'click', element: 'button', element_label: label(btn) });
    }
  }, true);

  // ── 5. SORT + FILTER CHECKBOXES ───────────────────────────────────────────
  document.addEventListener('change', function (e) {
    var cb = e.target.closest('#sb-body input[type=checkbox]');
    if (cb) {
      send({
        event_type: 'click', element: 'filter_checkbox',
        element_label: (cb.name || '') + ':' + (cb.value || ''),
        metadata: { filter_group: cb.name, filter_value: cb.value, checked: cb.checked },
      });
      return;
    }
    var sel = e.target.closest('.ssel, select');
    if (sel) send({ event_type: 'click', element: 'sort_dropdown', element_label: sel.value });
  });

  // ── 6. SEARCH — 800 ms after the reader stops typing ──────────────────────
  var searchTimer;
  var lastQuery = '';
  function hookSearch() {
    var inp = document.getElementById('si') || document.querySelector('.sbar input, input[type="search"]');
    if (!inp || inp._ssHooked) return;
    inp._ssHooked = true;
    inp.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        var q = inp.value.trim();
        // "ha" → "hac" → "hack" is one search, not three.
        if (q.length > 1 && q !== lastQuery) {
          lastQuery = q;
          send({ event_type: 'search', search_query: q.slice(0, 100) });
        }
      }, 800);
    });
  }
  hookSearch();
  // The field is in the initial HTML, but retry once in case a future layout
  // renders it late.
  setTimeout(hookSearch, 1200);
})();
