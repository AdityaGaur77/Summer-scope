/**
 * app.js — everything the page does after data.json lands.
 *
 * index.html used to carry all of this inline, and landing.html carried a
 * slightly older copy of the same functions. Both are gone: the markup lives in
 * index.html, the status model in summerscope.js, and the behaviour here.
 *
 * Two rules worth knowing before editing:
 *
 *   · The filter panel is ONE element. On a phone it is a bottom sheet, from
 *     900px up it is a docked column. There is no second set of checkboxes to
 *     keep in sync.
 *
 *   · Filter, sort, tab and search state all live in the URL. Every render
 *     writes them back with replaceState, so a filtered view can be shared or
 *     bookmarked, and the browser Back button steps through what the reader
 *     actually did instead of leaving the site.
 *
 * Plain script, no module — it needs the globals summerscope.js defines.
 */
/* eslint-disable no-unused-vars */
(function () {
  'use strict';

  var P = [];        // programs, dates hydrated
  var E = [];        // events
  var META = {};
  var COUNTS = {};
  var eventType = 'All';
  var lastResults = [];

  // ── Small helpers ────────────────────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /**
   * Escape anything that came out of data.json before it goes into innerHTML.
   * The old code interpolated names, hosts, notes and URLs raw. Nothing in the
   * file is hostile today, but a stray apostrophe in a name was enough to break
   * an onclick attribute, and that is the same hole an injected < would use.
   */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  /** Only http(s) links are ever emitted, so a data:/javascript: URL can't ride in. */
  function safeUrl(u) {
    var s = String(u || '').trim();
    return /^https?:\/\//i.test(s) ? s : '';
  }

  // ── THEME ────────────────────────────────────────────────────────────────
  // Dark is the default. A saved choice wins; the OS preference is deliberately
  // not consulted, so the site looks the same to everyone on first open.
  var THEME_KEY = '_ss_theme';

  function readTheme() {
    try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; }
    catch (_) { return 'dark'; }
  }

  function applyTheme(theme) {
    var light = theme === 'light';
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#0D1926' : '#0E1725');
    var btn = $('theme-btn');
    if (btn) {
      btn.textContent = light ? '☾' : '☀';
      btn.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
      btn.title = btn.getAttribute('aria-label');
    }
  }

  function toggleTheme() {
    var next = readTheme() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
    applyTheme(next);
  }

  // ── FILTER GROUPS ────────────────────────────────────────────────────────
  // One declaration drives the sidebar markup, the URL keys, the active-filter
  // chips and the match test. Adding a facet means adding one entry here.
  var GROUPS = [
    {
      name: 'status', label: 'Status', open: true,
      options: [
        { value: 'open',     label: 'Open now' },
        { value: 'upcoming', label: 'Opens later' },
        { value: 'rolling',  label: 'Rolling / anytime' },
        { value: 'closed',   label: 'Deadline passed' },
        { value: 'inactive', label: 'Stopped / unconfirmed' },
      ],
      match: function (p, vals, now) {
        var s = statusOf(p, now);
        return vals.some(function (v) { return inFilterBucket(s, v); });
      },
    },
    {
      name: 'deadline', label: 'Deadline',
      hint: 'Counted from today, and only for programs whose deadline is still ahead.',
      options: DEADLINE_WINDOWS.map(function (w) { return { value: w.value, label: w.label }; }),
      match: function (p, vals, now) {
        var w = deadlineWindowsOf(p, now);
        return vals.some(function (v) { return w.indexOf(v) !== -1; });
      },
    },
    {
      name: 'cat', label: 'Subject', open: true,
      options: [
        { value: 'STEM',       label: 'STEM / Engineering' },
        { value: 'Math',       label: 'Mathematics' },
        { value: 'CS',         label: 'Computer Science' },
        { value: 'Research',   label: 'Research' },
        { value: 'Medicine',   label: 'Medicine / Biology' },
        { value: 'Humanities', label: 'Humanities' },
        { value: 'Business',   label: 'Business / Econ' },
        { value: 'Leadership', label: 'Leadership' },
        { value: 'Arts',       label: 'Arts' },
      ],
      match: function (p, vals) { return vals.some(function (v) { return p.cat.indexOf(v) !== -1; }); },
    },
    {
      name: 'region', label: 'Where',
      options: [
        { value: 'Northeast',     label: 'Northeast' },
        { value: 'South',         label: 'South' },
        { value: 'Midwest',       label: 'Midwest' },
        { value: 'West',          label: 'West' },
        { value: 'Online',        label: 'Online / remote' },
        { value: 'International', label: 'Outside the US' },
        { value: 'Multiple',      label: 'Multiple sites' },
      ],
      match: function (p, vals) {
        var r = regionsOf(p);
        return vals.some(function (v) { return r.indexOf(v) !== -1; });
      },
    },
    {
      name: 'fmt', label: 'Format',
      options: [
        { value: 'In-Person', label: 'In-Person' },
        { value: 'Online',    label: 'Online' },
        { value: 'Hybrid',    label: 'Hybrid' },
      ],
      match: function (p, vals) { return vals.indexOf(p.fmt) !== -1; },
    },
    {
      name: 'cost', label: 'Cost', open: true,
      options: [
        { value: 'Free',    label: 'Free / Full Aid' },
        { value: 'Under3k', label: 'Under $3,000' },
        { value: '3kTo8k',  label: '$3,000 – $8,000' },
        { value: 'Over8k',  label: 'Over $8,000' },
        // 15 programs are banded "Varies". Without this option no cost filter
        // could ever reach them, so they vanished the moment one was ticked.
        { value: 'Varies',  label: 'Varies by session' },
      ],
      match: function (p, vals) { return vals.indexOf(p.costB) !== -1; },
    },
    {
      name: 'grade', label: 'Grade',
      options: [
        { value: '9',  label: '9th grade' },
        { value: '10', label: '10th grade' },
        { value: '11', label: '11th grade' },
        { value: '12', label: '12th grade' },
      ],
      match: function (p, vals) {
        return vals.some(function (v) { return p.grades.indexOf(parseInt(v, 10)) !== -1; });
      },
    },
    {
      name: 'feature', label: 'Details',
      hint: 'Read from what each program publishes. Programs that stay silent on a '
          + 'detail are not counted as a "no" — they are listed separately above the results.',
      options: FEATURES.map(function (f) { return { value: f.value, label: f.label }; }),
      match: function (p, vals) {
        return vals.some(function (v) { return FEATURE_BY_VALUE[v] && FEATURE_BY_VALUE[v].test(p); });
      },
      // How many programs a tick hides purely for lack of published data.
      unknowns: function (p, vals) {
        return vals.some(function (v) {
          var f = FEATURE_BY_VALUE[v];
          return f && f.unknown && f.known && !f.known(p);
        });
      },
    },
    {
      name: 'prestige', label: 'Selectivity',
      options: [
        { value: '5', label: '★★★★★ Top-tier' },
        { value: '4', label: '★★★★☆ Highly selective' },
        { value: '3', label: '★★★☆☆ Competitive' },
      ],
      match: function (p, vals) { return vals.indexOf(String(p.prestige)) !== -1; },
    },
  ];

  var GROUP_BY_NAME = {};
  GROUPS.forEach(function (g) { GROUP_BY_NAME[g.name] = g; });

  var SORTS = [
    { value: 'prestige',  label: 'Most prestigious first' },
    { value: 'open',      label: 'Open programs first' },
    { value: 'deadline',  label: 'Deadline: soonest first' },
    { value: 'deadline-desc', label: 'Deadline: latest first' },
    { value: 'cost-asc',  label: 'Cost: low to high' },
    { value: 'cost-desc', label: 'Cost: high to low' },
    { value: 'newest',    label: 'Recently added' },
    { value: 'az',        label: 'A – Z' },
  ];

  // Quick chips: the taps people actually make, one press each. Every one maps
  // onto the same checkboxes as the panel, so nothing can get out of step.
  var QUICK = [
    { label: 'Open now',      group: 'status',   value: 'open' },
    { label: 'Free',          group: 'cost',     value: 'Free' },
    { label: 'Online',        group: 'fmt',      value: 'Online' },
    { label: 'Closes < 60d',  group: 'deadline', value: 'd60' },
    { label: 'New',           group: 'feature',  value: 'new' },
    { label: 'Confirmed',     group: 'feature',  value: 'confirmed' },
  ];

  // ── FILTER PANEL MARKUP ──────────────────────────────────────────────────
  function buildPanel() {
    var body = $('sb-body');
    if (!body) return;
    // The docked desktop column scrolls on its own, so every group can start
    // open there. On a phone the panel is a sheet and nine expanded groups is a
    // long scroll past the three that matter, so only those three start open.
    var openAll = window.matchMedia('(min-width:900px)').matches;
    body.innerHTML = GROUPS.map(function (g) {
      return '<details class="fs" data-group="' + g.name + '"' + (g.open || openAll ? ' open' : '') + '>'
        + '<summary>' + esc(g.label) + '<span class="fs-on" hidden></span></summary>'
        + '<div class="fs-list">'
        + (g.hint ? '<p class="fhint">' + esc(g.hint) + '</p>' : '')
        + g.options.map(function (o) {
            return '<label class="fo"><input type="checkbox" name="' + g.name + '" value="'
              + esc(o.value) + '"> <span>' + esc(o.label) + '</span>'
              + '<span class="fc" data-count="' + g.name + ':' + esc(o.value) + '">—</span></label>';
          }).join('')
        + '</div></details>';
    }).join('');

    var quick = $('quick');
    if (quick) {
      quick.innerHTML = QUICK.map(function (q) {
        return '<button type="button" class="qchip" data-group="' + q.group + '" data-value="'
          + esc(q.value) + '">' + esc(q.label) + '</button>';
      }).join('');
    }

    var sel = $('ss');
    if (sel) {
      sel.innerHTML = SORTS.map(function (s) {
        return '<option value="' + s.value + '">' + esc(s.label) + '</option>';
      }).join('');
    }
  }

  // ── URL STATE ────────────────────────────────────────────────────────────
  function selected(name) {
    return $$('input[name="' + name + '"]:checked').map(function (el) { return el.value; });
  }

  function activeCount() {
    return GROUPS.reduce(function (n, g) { return n + selected(g.name).length; }, 0);
  }

  function currentTab() {
    var t = $('page-events');
    return t && t.classList.contains('active') ? 'events' : 'programs';
  }

  function writeUrl() {
    var q = new URLSearchParams();
    var term = ($('si') || {}).value || '';
    if (term.trim()) q.set('q', term.trim());
    GROUPS.forEach(function (g) {
      var v = selected(g.name);
      if (v.length) q.set(g.name, v.join(','));
    });
    var sel = $('ss');
    if (sel && sel.value !== 'prestige') q.set('sort', sel.value);
    if (eventType !== 'All') q.set('etype', eventType);
    var hash = currentTab() === 'events' ? '#events' : '';
    var url = window.location.pathname + (q.toString() ? '?' + q : '') + hash;
    // replaceState, not pushState: typing in the search box must not bury the
    // page the reader arrived from under one history entry per keystroke.
    try { history.replaceState(history.state, '', url); } catch (_) {}
  }

  function readUrl() {
    var q = new URLSearchParams(window.location.search);
    var term = q.get('q');
    if (term && $('si')) $('si').value = term;
    GROUPS.forEach(function (g) {
      var raw = q.get(g.name);
      if (!raw) return;
      var want = raw.split(',');
      $$('input[name="' + g.name + '"]').forEach(function (el) {
        if (want.indexOf(el.value) !== -1) el.checked = true;
      });
    });
    var sort = q.get('sort');
    if (sort && $('ss') && $$('#ss option[value="' + sort + '"]').length) $('ss').value = sort;
    var et = q.get('etype');
    if (et) eventType = et;
    // Open any group that arrived with a tick, so nothing is active-but-hidden.
    GROUPS.forEach(function (g) {
      if (!selected(g.name).length) return;
      var d = document.querySelector('.fs[data-group="' + g.name + '"]');
      if (d) d.open = true;
    });
  }

  // ── DATA LOAD ────────────────────────────────────────────────────────────
  function loadData() {
    return loadProgramData().then(function (loaded) {
      P = loaded.programs;
      E = loaded.events;
      META = loaded.meta;
      COUNTS = loaded.counts;

      var updated = META.lastUpdated || 'unknown';
      var cycle = META.cycle || '';

      var setText = function (id, v) { var el = $(id); if (el) el.textContent = v; };
      setText('nav-updated-text', 'Updated ' + updated);
      setText('notice-date', 'Updated ' + updated);
      setText('footer-meta', 'Last updated: ' + updated + (cycle ? ' · ' + cycle + ' cycle' : '')
        + ' · Programs: ' + P.length + ' · Events: ' + E.length
        + ' · Not affiliated with any program listed.');
      if (cycle) {
        var eyebrow = document.querySelector('.heyebrow');
        if (eyebrow) eyebrow.textContent = 'The complete ' + cycle + ' database';
      }

      setText('pb', P.length);
      setText('eb-count', E.length);
      setText('mn-programs-count', P.length);
      setText('mn-events-count', E.length);
      setText('tc', P.length);
      setText('free-count', P.filter(function (p) { return p.costN === 0; }).length);

      // Count the subject areas rather than hardcoding "8" — the file has
      // nine, and Arts had no filter checkbox at all until this rewrite.
      var subjects = {};
      P.forEach(function (p) { p.cat.forEach(function (c) { subjects[c] = 1; }); });
      setText('subject-count', Object.keys(subjects).length);

      // The actionable stat: what you can apply to today, or — early in a
      // cycle, when nothing has opened — what is coming.
      var hero = $('oc');
      var heroLabel = $('oc-label');
      if (hero && heroLabel) {
        if (COUNTS.takingApps > 0) {
          hero.textContent = COUNTS.takingApps;
          heroLabel.textContent = 'Accepting now';
        } else {
          hero.textContent = COUNTS.upcoming || 0;
          heroLabel.textContent = 'Opening soon';
        }
      }

      readUrl();
      var loading = $('loading-screen');
      if (loading) loading.style.display = 'none';
      showPage(window.location.hash === '#events' ? 'events' : 'programs', { replace: true });
      render();
    });
  }

  // ── FILTERING ────────────────────────────────────────────────────────────
  function matches(p, state, now) {
    if (state.q) {
      var hay = (p.name + ' ' + p.host + ' ' + p.cat.join(' ') + ' ' + p.loc + ' ' + p.desc).toLowerCase();
      if (hay.indexOf(state.q) === -1) return false;
    }
    for (var i = 0; i < GROUPS.length; i++) {
      var g = GROUPS[i];
      var vals = state.sel[g.name];
      if (vals.length && !g.match(p, vals, now)) return false;
    }
    return true;
  }

  function readState() {
    var sel = {};
    GROUPS.forEach(function (g) { sel[g.name] = selected(g.name); });
    return {
      q: (($('si') || {}).value || '').toLowerCase().trim(),
      sel: sel,
      sort: ($('ss') || {}).value || 'prestige',
    };
  }

  /**
   * Per-option result counts, each computed with its own group's filter
   * dropped. A count next to a checkbox has to answer "how many would I get if
   * I ticked this", which is not the same as "how many match right now" —
   * counting with the group still applied showed 0 beside every unticked box in
   * a group that already had one ticked.
   */
  function facetCounts(state, now) {
    var out = {};
    GROUPS.forEach(function (g) {
      var others = Object.assign({}, state, { sel: Object.assign({}, state.sel) });
      others.sel[g.name] = [];
      var pool = P.filter(function (p) { return matches(p, others, now); });
      g.options.forEach(function (o) {
        out[g.name + ':' + o.value] = pool.filter(function (p) { return g.match(p, [o.value], now); }).length;
      });
    });
    return out;
  }

  function sortPrograms(list, sort, now) {
    var rank = function (p) { return STATUS_RANK[statusOf(p, now)]; };
    var byName = function (a, b) { return a.name.localeCompare(b.name); };
    var added = function (p) { return p.addedOn || ''; };
    var cmp = {
      prestige: function (a, b) { return b.prestige - a.prestige || rank(a) - rank(b) || a.dlt - b.dlt; },
      open: function (a, b) { return rank(a) - rank(b) || b.prestige - a.prestige; },
      deadline: function (a, b) { return rank(a) - rank(b) || a.dlt - b.dlt; },
      'deadline-desc': function (a, b) { return rank(a) - rank(b) || b.dlt - a.dlt; },
      'cost-asc': function (a, b) { return a.costN - b.costN || byName(a, b); },
      'cost-desc': function (a, b) { return b.costN - a.costN || byName(a, b); },
      newest: function (a, b) {
        return (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0)
          || added(b).localeCompare(added(a)) || byName(a, b);
      },
      az: byName,
    }[sort];
    return cmp ? list.slice().sort(cmp) : list.slice();
  }

  // ── RENDER ───────────────────────────────────────────────────────────────
  function render() {
    if (!P.length) return;
    var now = new Date();
    var state = readState();
    var results = sortPrograms(P.filter(function (p) { return matches(p, state, now); }), state.sort, now);
    lastResults = results;

    renderFacetCounts(state, now);
    renderChips(state);
    renderUnknownNote(state, now);

    var n = activeCount();
    var applyBtn = $('sb-apply');
    if (applyBtn) applyBtn.textContent = 'Show ' + results.length + ' program' + (results.length === 1 ? '' : 's');
    [$('filter-count'), $('mn-filter-count')].forEach(function (el) {
      if (!el) return;
      el.textContent = n;
      el.hidden = n === 0;
    });

    var rt = $('rt');
    if (rt) {
      rt.innerHTML = results.length === P.length
        ? 'All <strong>' + P.length + '</strong> programs'
        : '<strong>' + results.length + '</strong> of ' + P.length + ' programs';
    }

    renderCards(results, now);
    writeUrl();
  }

  function renderFacetCounts(state, now) {
    var counts = facetCounts(state, now);
    $$('[data-count]').forEach(function (el) {
      var v = counts[el.getAttribute('data-count')];
      el.textContent = v == null ? '—' : v;
    });
    GROUPS.forEach(function (g) {
      var d = document.querySelector('.fs[data-group="' + g.name + '"]');
      if (!d) return;
      var badge = d.querySelector('.fs-on');
      var n = state.sel[g.name].length;
      if (badge) { badge.textContent = n; badge.hidden = n === 0; }
    });
    $$('.qchip').forEach(function (btn) {
      var g = btn.getAttribute('data-group');
      var v = btn.getAttribute('data-value');
      btn.classList.toggle('on', state.sel[g].indexOf(v) !== -1);
      btn.setAttribute('aria-pressed', state.sel[g].indexOf(v) !== -1 ? 'true' : 'false');
    });
  }

  function labelFor(group, value) {
    var g = GROUP_BY_NAME[group];
    if (!g) return value;
    for (var i = 0; i < g.options.length; i++) {
      if (g.options[i].value === value) return g.options[i].label;
    }
    return value;
  }

  function renderChips(state) {
    var box = $('chips');
    if (!box) return;
    var parts = [];
    if (state.q) {
      parts.push('<span class="chip">“' + esc(state.q) + '”'
        + '<button type="button" data-clear="q" aria-label="Clear search">×</button></span>');
    }
    GROUPS.forEach(function (g) {
      state.sel[g.name].forEach(function (v) {
        parts.push('<span class="chip">' + esc(labelFor(g.name, v))
          + '<button type="button" data-group="' + g.name + '" data-value="' + esc(v)
          + '" aria-label="Remove filter ' + esc(labelFor(g.name, v)) + '">×</button></span>');
      });
    });
    if (parts.length > 1) {
      parts.push('<button type="button" class="chip-clear" data-clear="all">Clear all</button>');
    }
    box.innerHTML = parts.join('');
  }

  /**
   * A "Details" tick can only match programs that publish that detail. Saying
   * so beats letting the reader assume the missing ones were ruled out.
   */
  function renderUnknownNote(state, now) {
    var box = $('unknown-note');
    if (!box) return;
    var vals = state.sel.feature || [];
    var g = GROUP_BY_NAME.feature;
    if (!vals.length || !g.unknowns) { box.hidden = true; box.textContent = ''; return; }

    var without = Object.assign({}, state, { sel: Object.assign({}, state.sel) });
    without.sel.feature = [];
    var pool = P.filter(function (p) { return matches(p, without, now); });
    var hidden = pool.filter(function (p) { return !g.match(p, vals, now) && g.unknowns(p, vals); }).length;

    if (!hidden) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.textContent = hidden + ' more program' + (hidden === 1 ? '' : 's')
      + ' may also qualify but do not publish this detail, so they are not shown.';
  }

  function deadlineCell(p, st, now) {
    var days = daysUntil(p.dlt, now);
    var cls = 'mv';
    var text = esc(p.dl);
    var bar = STATUS[st].bar;

    if (st === 'discontinued' || st === 'uncertain') cls = 'mv closed-t';
    else if (st === 'closed') { cls = 'mv closed-t'; text = esc(p.dl) + ' — Closed'; }
    else if (st !== 'rolling' && days != null && days >= 0 && days <= 14) {
      cls = 'mv urgent'; text = esc(p.dl) + ' (' + days + 'd left!)'; bar = 'cbar-urgent';
    } else if (st !== 'rolling' && days != null && days >= 0 && days <= 45) {
      cls = 'mv soon'; text = esc(p.dl) + ' (' + days + 'd)';
    }
    if (p.verification === 'projected' && st !== 'discontinued' && st !== 'uncertain' && st !== 'rolling') {
      text = '<span class="exp" title="Expected date, carried forward from the previous cycle. '
        + 'Confirm on the official site.">' + text + '</span>';
    }
    return { cls: cls, text: text, bar: bar };
  }

  function renderCards(results, now) {
    var g = $('cg');
    if (!g) return;
    if (!results.length) {
      g.innerHTML = '<div class="nores"><h3>No programs match these filters</h3>'
        + '<p>Try removing one, or clear them all to start again.</p>'
        + '<button type="button" data-clear="all">Clear all filters</button></div>';
      return;
    }

    g.innerHTML = results.map(function (p) {
      var st = statusOf(p, now);
      var meta = STATUS[st];
      var dl = deadlineCell(p, st, now);
      var fmtClass = p.fmt === 'In-Person' ? 'tip' : p.fmt === 'Online' ? 'ton' : 'thy';
      var link = safeUrl(p.link);

      return '<article class="card" role="button" tabindex="0" data-id="' + p.id + '"'
        + ' aria-label="' + esc(p.name) + ' — ' + esc(meta.label) + '">'
        + '<div class="cbar ' + dl.bar + '"></div>'
        + '<div class="ctop">'
          + '<div class="clog" style="background:' + esc(p.color) + '" aria-hidden="true">' + esc(p.logo) + '</div>'
          + '<div style="flex:1;min-width:0">'
            + '<div class="ctitle">' + esc(p.name) + '</div>'
            + '<div class="chost">' + esc(p.host) + '</div>'
            + '<span class="cstars" aria-label="Selectivity ' + p.prestige + ' of 5">'
              + '★'.repeat(p.prestige) + '☆'.repeat(5 - p.prestige) + '</span>'
          + '</div>'
          + '<div class="cbadges">'
            + '<span class="tag ' + meta.tag + '" title="' + esc(meta.blurb) + '">' + esc(meta.label) + '</span>'
            + (p.isNew ? '<span class="tag tnew">New</span>' : '')
          + '</div>'
        + '</div>'
        + '<p class="cdesc">' + esc(p.desc.substring(0, 130)) + '…</p>'
        + '<div class="tags">'
          + p.cat.map(function (c) { return '<span class="tag tc">' + esc(c) + '</span>'; }).join('')
          + '<span class="tag ' + fmtClass + '">' + esc(p.fmt) + '</span>'
          + p.grades.map(function (x) { return '<span class="tag tg">Gr ' + esc(x) + '</span>'; }).join('')
        + '</div>'
        + '<div class="cmeta">'
          + '<div class="mi"><div class="ml">Deadline</div><div class="' + dl.cls + '">' + dl.text + '</div></div>'
          + '<div class="mi"><div class="ml">Dates</div><div class="mv">' + esc(p.dates) + '</div></div>'
          + '<div class="mi"><div class="ml">Location</div><div class="mv">' + esc(p.loc) + '</div></div>'
          + '<div class="mi"><div class="ml">Grades</div><div class="mv">'
            + p.grades.map(function (x) { return x + 'th'; }).join(', ') + '</div></div>'
        + '</div>'
        + '<div class="cfoot">'
          + (p.costN === 0
              ? '<span class="cv cvf">Free / Full Aid</span>'
              : '<span class="cv">' + esc(p.cost) + '</span>')
          + (link ? '<button type="button" class="abtn" data-visit="' + esc(link) + '">Visit Site →</button>' : '')
        + '</div>'
        + '</article>';
    }).join('');
  }

  // ── MODAL ────────────────────────────────────────────────────────────────
  var lastFocus = null;

  function openModal(id) {
    var p = P.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var now = new Date();
    var st = statusOf(p, now);
    var cycle = META.cycle || '';
    var days = daysUntil(p.dlt, now);
    var link = safeUrl(p.link);
    var lastCycle = p.history && p.history.length ? p.history[p.history.length - 1].cycle : '—';

    var notices = '';
    if (st === 'discontinued') {
      notices += '<div class="mnotice">🚫 <strong>This program is no longer offered.</strong> '
        + esc(p.discontinuedReason || '') + ' ' + esc(p.successor || '')
        + '<br><span style="opacity:.8">Kept on file for reference — last known cycle: '
        + esc(lastCycle) + '.</span></div>';
    } else if (st === 'uncertain') {
      notices += '<div class="mnotice">⚠️ <strong>Status unconfirmed for ' + esc(cycle) + '.</strong> '
        + esc(p.uncertainReason || '')
        + (p.uncertainSource ? '<br><span style="opacity:.8">Source: ' + esc(p.uncertainSource) + '</span>' : '')
        + '</div>';
    } else if (st === 'closed') {
      notices += '<div class="mnotice">⚠️ The ' + esc(cycle) + ' deadline has passed. '
        + esc(p.note || 'Check the official website for the next cycle.') + '</div>';
    }
    if (st === 'open' && days != null && days >= 0 && days <= 14) {
      notices += '<div class="murgent">⏰ Deadline in ' + days + ' day' + (days !== 1 ? 's' : '')
        + '! Apply immediately.</div>';
    }
    if (st === 'upcoming' && p.opensOn) {
      notices += '<div class="mnote">🔓 Applications open ' + esc(opensLabel(p)) + '.</div>';
    }
    if (p.verification === 'projected' && st !== 'discontinued' && st !== 'uncertain') {
      notices += '<div class="mnote">📅 The ' + esc(cycle) + ' date below is <strong>expected, not '
        + 'confirmed</strong> — carried forward from the ' + esc(cycle - 1) + ' cycle. Verify on the '
        + 'official site before planning around it.</div>';
    }
    if (p.verification === 'verified' && p.lastVerified && st !== 'discontinued' && st !== 'uncertain') {
      notices += '<div class="mgood">✅ Confirmed against the program’s own materials on '
        + esc(p.lastVerified) + '.</div>';
    }

    var boxes = [
      ['Application Deadline', esc(p.dl) + (st === 'closed' ? ' (closed)' : '')],
      ['Program Dates', esc(p.dates)],
      ['Cost', esc(p.cost)],
      ['Eligible Grades', p.grades.map(function (x) { return x + 'th'; }).join(', ')],
      ['Where', esc(p.loc)],
      ['Format', esc(p.fmt)],
    ];
    if (p.duration) boxes.push(['Duration', esc(p.duration)]);
    if (p.programType) boxes.push(['Program Type', esc(p.programType)]);
    if (p.scholarship) boxes.push(['Financial Aid', esc(p.scholarship)]);
    if (p.acceptsInternational != null) {
      boxes.push(['International Students', p.acceptsInternational ? 'Accepted' : 'Not accepted']);
    }

    var dlColor = (st === 'closed' || st === 'discontinued' || st === 'uncertain') ? 'var(--faint)'
      : days != null && days >= 0 && days <= 14 ? 'var(--red)'
      : days != null && days >= 0 && days <= 45 ? 'var(--amber)' : '';

    // Not named `history`: a local of that name shadows window.history for the
    // whole function, which is how the pushState below quietly became a
    // TypeError swallowed by its own try/catch — the Back button then left the
    // site instead of closing this sheet.
    var historyBlock = (p.history && p.history.length)
      ? '<div class="ms"><div class="msl">Previous cycles</div><div class="mhist">'
        + p.history.slice().reverse().map(function (h) {
            return '<div><strong>' + esc(h.cycle) + '</strong> — deadline ' + esc(h.dl)
              + (h.dates ? ' · ' + esc(h.dates) : '') + '</div>';
          }).join('')
        + '</div></div>'
      : '';

    $('mi').innerHTML =
      '<div class="mh">'
        + '<button type="button" class="mx" data-close-modal aria-label="Close">×</button>'
        + '<div class="mhtop">'
          + '<div class="mlog" style="background:' + esc(p.color) + '" aria-hidden="true">' + esc(p.logo) + '</div>'
          + '<div><h2 class="mtitle" id="modal-title">' + esc(p.name) + '</h2>'
            + '<div class="mhost">' + esc(p.host) + ' · ' + esc(p.loc) + '</div>'
            + '<div class="mstars">' + '★'.repeat(p.prestige) + '☆'.repeat(5 - p.prestige) + '</div></div>'
        + '</div>'
        + '<div class="mtags2">'
          + p.cat.map(function (c) { return '<span class="mtag">' + esc(c) + '</span>'; }).join('')
          + '<span class="mtag">' + esc(p.fmt) + '</span>'
          + '<span class="mtag">Grades ' + p.grades.join(', ') + '</span>'
          + (p.isNew ? '<span class="mtag">New</span>' : '')
          + MSTATUS_TAG[st]
        + '</div>'
      + '</div>'
      + '<div class="mb">'
        + notices
        + '<div class="ms"><div class="msl">About this program</div>'
          + '<p class="mdesc">' + esc(p.desc) + '</p></div>'
        + '<div class="ms"><div class="mgrid">'
          + boxes.map(function (b, i) {
              return '<div class="mbox"><div class="mbl">' + b[0] + '</div><div class="mbv"'
                + (i === 0 && dlColor ? ' style="color:' + dlColor + '"' : '') + '>' + b[1] + '</div></div>';
            }).join('')
        + '</div></div>'
        + (st !== 'closed' && st !== 'discontinued' && st !== 'uncertain' && p.note
            ? '<div class="mnote">ℹ️ ' + esc(p.note) + '</div>' : '')
        + historyBlock
      + '</div>'
      + '<div class="mfooter">'
        + '<button type="button" class="mclose" data-close-modal>← Back</button>'
        + (link ? '<button type="button" class="mapp" data-visit="' + esc(link) + '">Official Website →</button>' : '')
      + '</div>';

    lastFocus = document.activeElement;
    var bg = $('modal');
    bg.classList.add('open');
    bg.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    // A history entry so the phone Back gesture closes the sheet instead of
    // leaving the site — the single most common complaint about modals on mobile.
    try { history.pushState({ ssModal: p.id }, '', window.location.href); } catch (_) {}
    var close = bg.querySelector('.mx');
    if (close) close.focus();
  }

  function closeModal(fromHistory) {
    var bg = $('modal');
    if (!bg || !bg.classList.contains('open')) return;
    bg.classList.remove('open');
    bg.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
    if (!fromHistory && history.state && history.state.ssModal) {
      try { history.back(); } catch (_) {}
    }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  // ── FILTER SHEET ─────────────────────────────────────────────────────────
  function setSheet(open) {
    var sb = $('sidebar');
    var bd = $('sb-backdrop');
    if (!sb) return;
    sb.classList.toggle('open', open);
    if (bd) bd.classList.toggle('open', open);
    sb.setAttribute('aria-hidden', open ? 'false' : 'true');
    // Desktop docks the panel permanently, so the scroll lock must not apply.
    if (window.matchMedia('(max-width:899px)').matches) {
      document.body.classList.toggle('no-scroll', open);
    }
    if (open) {
      var first = sb.querySelector('.sb-close') || sb.querySelector('input');
      if (first) first.focus();
    }
  }

  function sheetOpen() {
    var sb = $('sidebar');
    return !!sb && sb.classList.contains('open');
  }

  // ── EVENTS PAGE ──────────────────────────────────────────────────────────
  var EVENT_SECTIONS = [
    { label: 'Hackathons', type: 'Hackathon' },
    { label: 'Science & Math Competitions', type: 'Competition' },
    { label: 'Awards & Recognition', type: 'Award' },
    { label: 'Conferences & Challenges', type: 'Conference' },
  ];

  function renderEvents() {
    var box = $('events-body');
    if (!box || !E.length) return;
    var html = EVENT_SECTIONS.map(function (s) {
      var evs = E.filter(function (e) {
        return e.type === s.type && (eventType === 'All' || eventType === e.type);
      });
      if (!evs.length) return '';
      return '<section class="esec"><h3 class="eslabel">' + esc(s.label) + '</h3><div class="egrid">'
        + evs.map(function (ev) {
            var link = safeUrl(ev.link);
            return '<article class="ecard"' + (link ? ' role="button" tabindex="0" data-visit="' + esc(link) + '"' : '')
              + '>'
              + '<span class="etype ' + esc(ev.badge) + '">' + esc(ev.type) + '</span>'
              + '<div class="etitle">' + esc(ev.name) + '</div>'
              + '<div class="eorg">' + esc(ev.org) + '</div>'
              + '<p class="edesc">' + esc(ev.desc) + '</p>'
              + '<div class="emeta">'
                + '<div class="emi"><div class="eml">When</div><div class="emv">' + esc(ev.dates) + '</div></div>'
                + '<div class="emi"><div class="eml">Deadline</div><div class="emv">' + esc(ev.dl) + '</div></div>'
                + '<div class="emi"><div class="eml">Format</div><div class="emv">' + esc(ev.fmt) + '</div></div>'
                + '<div class="emi"><div class="eml">Cost</div><div class="emv"'
                  + (ev.cost === 'Free' ? ' style="color:var(--green)"' : '') + '>' + esc(ev.cost) + '</div></div>'
              + '</div>'
              + '<div class="efoot"><span class="eprize">' + (ev.prize ? '🏆 ' + esc(ev.prize) : '') + '</span>'
                + (link ? '<span class="ebtn">Learn More →</span>' : '') + '</div>'
              + '</article>';
          }).join('')
        + '</div></section>';
    }).join('');

    box.innerHTML = html || '<div class="nores"><h3>Nothing in this category yet</h3></div>';
    $$('.efbtn').forEach(function (b) {
      var on = b.getAttribute('data-t') === eventType;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // ── PAGE SWITCHING ───────────────────────────────────────────────────────
  function showPage(page, opts) {
    opts = opts || {};
    $$('.page').forEach(function (p) {
      p.classList.toggle('active', p.id === 'page-' + page);
    });
    $$('.ntab').forEach(function (t) {
      var on = t.getAttribute('data-page') === page;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.mobnav [data-page]').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-page') === page);
    });
    if (page === 'events') renderEvents();
    if (!opts.replace) window.scrollTo({ top: 0, behavior: 'auto' });
    setSheet(false);
    writeUrl();
  }

  // ── WIRING ───────────────────────────────────────────────────────────────
  function clearAll() {
    $$('#sb-body input[type=checkbox]').forEach(function (el) { el.checked = false; });
    if ($('si')) { $('si').value = ''; syncSearchUI(); }
    render();
  }

  function toggleFilter(group, value) {
    var box = document.querySelector('input[name="' + group + '"][value="' + value + '"]');
    if (!box) return;
    box.checked = !box.checked;
    var d = document.querySelector('.fs[data-group="' + group + '"]');
    if (d && box.checked) d.open = true;
    render();
  }

  function syncSearchUI() {
    var bar = document.querySelector('.sbar');
    if (bar && $('si')) bar.classList.toggle('has-value', !!$('si').value);
  }

  function wire() {
    // Search — debounced so 125 cards are not re-rendered on every keystroke.
    var searchTimer;
    var si = $('si');
    if (si) {
      si.addEventListener('input', function () {
        syncSearchUI();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(render, 140);
      });
      si.addEventListener('search', render);
    }
    var sclear = $('sclear');
    if (sclear) {
      sclear.addEventListener('click', function () {
        si.value = ''; syncSearchUI(); si.focus(); render();
      });
    }

    // Any checkbox in the panel, and the sort select.
    var body = $('sb-body');
    if (body) body.addEventListener('change', render);
    if ($('ss')) $('ss').addEventListener('change', render);

    // Quick chips.
    var quick = $('quick');
    if (quick) {
      quick.addEventListener('click', function (e) {
        var b = e.target.closest('.qchip');
        if (b) toggleFilter(b.getAttribute('data-group'), b.getAttribute('data-value'));
      });
    }

    // Active-filter chips and the empty-state reset.
    document.addEventListener('click', function (e) {
      var chipBtn = e.target.closest('[data-clear],[data-group][data-value]');
      if (chipBtn && (chipBtn.closest('#chips') || chipBtn.closest('.nores'))) {
        var what = chipBtn.getAttribute('data-clear');
        if (what === 'all') { clearAll(); return; }
        if (what === 'q') { $('si').value = ''; syncSearchUI(); render(); return; }
        var box = document.querySelector('input[name="' + chipBtn.getAttribute('data-group')
          + '"][value="' + chipBtn.getAttribute('data-value') + '"]');
        if (box) { box.checked = false; render(); }
        return;
      }

      // Outbound links. Checked before the card branch so "Visit Site" opens
      // the program instead of the detail sheet.
      var visit = e.target.closest('[data-visit]');
      if (visit) {
        e.stopPropagation();
        window.open(visit.getAttribute('data-visit'), '_blank', 'noopener');
        return;
      }
      if (e.target.closest('[data-close-modal]')) { closeModal(); return; }
      if (e.target.id === 'modal') { closeModal(); return; }

      var card = e.target.closest('.card[data-id]');
      if (card) { openModal(parseInt(card.getAttribute('data-id'), 10)); return; }

      var tab = e.target.closest('[data-page]');
      if (tab) { showPage(tab.getAttribute('data-page')); return; }

      var ef = e.target.closest('.efbtn');
      if (ef) { eventType = ef.getAttribute('data-t'); renderEvents(); writeUrl(); return; }

      if (e.target.closest('#filter-btn,#mn-filter')) { setSheet(!sheetOpen()); return; }
      if (e.target.closest('#sb-close,#sb-apply,#sb-backdrop')) { setSheet(false); return; }
      if (e.target.closest('#sb-reset')) { clearAll(); return; }
      if (e.target.closest('#theme-btn')) { toggleTheme(); return; }
      if (e.target.closest('#totop')) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    });

    // Cards and event cards are focusable, so Enter/Space must activate them.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if ($('modal').classList.contains('open')) { closeModal(); return; }
        if (sheetOpen()) { setSheet(false); return; }
      }
      // "/" jumps to search, the way every search-first site behaves.
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
        e.preventDefault();
        if (currentTab() !== 'programs') showPage('programs');
        if (si) { si.focus(); si.select(); }
        return;
      }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var card = e.target.closest('.card[data-id]');
      if (card) { e.preventDefault(); openModal(parseInt(card.getAttribute('data-id'), 10)); return; }
      var ecard = e.target.closest('.ecard[data-visit]');
      if (ecard) { e.preventDefault(); window.open(ecard.getAttribute('data-visit'), '_blank', 'noopener'); }
    });

    // Back / forward: close the sheet if that is what the entry was for,
    // otherwise follow the hash.
    window.addEventListener('popstate', function () {
      if ($('modal').classList.contains('open')) { closeModal(true); return; }
      showPage(window.location.hash === '#events' ? 'events' : 'programs', { replace: true });
    });

    // Back-to-top appears once there is somewhere to go back to.
    var totop = $('totop');
    if (totop) {
      var ticking = false;
      window.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          ticking = false;
          totop.classList.toggle('show', window.scrollY > 700);
        });
      }, { passive: true });
    }

    // Crossing the 900px line: the sheet becomes a docked column, so drop the
    // scroll lock and the open state that only make sense on a phone.
    var wide = window.matchMedia('(min-width:900px)');
    var onWide = function (e) {
      if (e.matches) {
        document.body.classList.remove('no-scroll');
        var sb = $('sidebar');
        if (sb) { sb.classList.remove('open'); sb.setAttribute('aria-hidden', 'false'); }
        var bd = $('sb-backdrop');
        if (bd) bd.classList.remove('open');
      } else {
        var s = $('sidebar');
        if (s && !s.classList.contains('open')) s.setAttribute('aria-hidden', 'true');
      }
    };
    if (wide.addEventListener) wide.addEventListener('change', onWide);
    else if (wide.addListener) wide.addListener(onWide);
    onWide(wide);
  }

  // ── INIT ─────────────────────────────────────────────────────────────────
  applyTheme(readTheme());
  buildPanel();
  wire();
  syncSearchUI();
  loadData().catch(function (err) {
    console.error('Failed to load data:', err);
    var loading = $('loading-screen');
    if (loading) {
      loading.innerHTML = '<p style="color:var(--red);text-align:center">Could not load the program '
        + 'database. Please refresh the page.</p>';
    }
  });

  // The analytics tracker reads .ctitle / .abtn / .fo, which are all still
  // here; it needs nothing exported. These two are for the console only.
  window.SummerScope = {
    programs: function () { return P; },
    results: function () { return lastResults; },
  };
})();
