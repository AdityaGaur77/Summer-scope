/**
 * Query planning: turn one identity into the set of lookups that actually surface
 * exposure, ordered so the highest-signal ones run first (a scan capped at 60
 * pages should spend them on your email address, not on your first name).
 */

import { digits, shortHash } from './util.mjs';
import { primaryLocation } from './identity.mjs';

function nameParts(name) {
  const parts = String(name).trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.length > 1 ? parts[parts.length - 1] : '' };
}

export function renderTemplate(tpl, ctx) {
  return tpl.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(ctx[key] ?? ''));
}

/** Build the URL a broker uses for its own people search, if we know the shape. */
export function brokerSearchUrls(broker, identity) {
  if (!broker.searchUrl) return [];
  const urls = [];
  const loc = identity.subject.locations?.[0] || {};
  const city = typeof loc === 'string' ? loc : loc.city || '';
  const state = typeof loc === 'string' ? '' : loc.region || '';
  for (const name of identity.subject.names || []) {
    const { first, last } = nameParts(name);
    if (!first) continue;
    const ctx = {
      name,
      nameSlug: `${first}-${last}`.replace(/[^\w-]/g, '').toLowerCase(),
      nameQuery: name,
      first,
      last,
      firstLower: first.toLowerCase(),
      lastLower: last.toLowerCase(),
      city,
      citySlug: city.replace(/[^\w]/g, '-').toLowerCase(),
      state,
      stateSlug: state.replace(/[^\w]/g, '-').toLowerCase(),
    };
    urls.push(renderTemplate(broker.searchUrl, ctx));
  }
  return [...new Set(urls)];
}

function task(channel, kind, payload) {
  return { id: `${kind}:${shortHash(channel, kind, payload.query || payload.url || '')}`, channel, kind, ...payload };
}

/**
 * @returns {Array<{id,channel,kind,query?,url?,purpose,selectorIds,priority}>}
 *   priority 1 = uniquely identifying, 3 = weak/noisy.
 */
export function buildQueryPlan(identity, selectors, { channels, brokers = [] } = {}) {
  const enabled = new Set(channels || identity.scan.channels);
  const byType = (t) => selectors.filter((s) => s.type === t);
  const tasks = [];
  const loc = primaryLocation(identity);

  const add = (t) => {
    if (!enabled.has(t.channel)) return;
    if (!tasks.some((x) => x.id === t.id)) tasks.push(t);
  };

  // --- Priority 1: selectors that identify exactly one person -------------
  for (const s of byType('email')) {
    add(task('web', 'search', { query: `"${s.value}"`, purpose: `email exposure: ${s.value}`, selectorIds: [s.id], priority: 1 }));
    add(task('github', 'search', { query: s.value, purpose: `email leaked in code/commits: ${s.value}`, selectorIds: [s.id], priority: 1 }));
  }
  for (const s of byType('phone')) {
    // Work from the last 10 digits so "+1 555 010 1234" and "5550101234" plan the
    // same queries; anything shorter is not a dialable US number and is left as-is.
    const raw = digits(s.value);
    const d = raw.length > 10 ? raw.slice(-10) : raw;
    const pretty = d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s.value;
    add(task('web', 'search', { query: `"${pretty}"`, purpose: `phone exposure: ${s.value}`, selectorIds: [s.id], priority: 1 }));
    if (d.length === 10) {
      add(task('web', 'search', { query: `"${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}"`, purpose: `phone exposure (dashed): ${s.value}`, selectorIds: [s.id], priority: 1 }));
    }
  }
  for (const s of byType('address')) {
    add(task('web', 'search', { query: `"${s.value}"`, purpose: `home address exposure`, selectorIds: [s.id], priority: 1 }));
  }

  // --- Priority 2: handles and name+place pairs ---------------------------
  for (const s of byType('username')) {
    add(task('web', 'search', { query: `"${s.value}"`, purpose: `handle reuse: ${s.value}`, selectorIds: [s.id], priority: 2 }));
    add(task('github', 'search', { query: s.value, purpose: `github presence: ${s.value}`, selectorIds: [s.id], priority: 2 }));
    add(task('twitter', 'search', { query: s.value, purpose: `twitter/x presence: ${s.value}`, selectorIds: [s.id], priority: 2 }));
    add(task('reddit', 'search', { query: s.value, purpose: `reddit presence: ${s.value}`, selectorIds: [s.id], priority: 2 }));
  }
  for (const n of byType('name')) {
    const anchors = [...byType('location'), ...byType('employer'), ...byType('school')];
    for (const a of anchors) {
      add(task('web', 'search', {
        query: `"${n.value}" "${a.value}"`,
        purpose: `name + ${a.type}: ${n.value} / ${a.value}`,
        selectorIds: [n.id, a.id],
        priority: 2,
      }));
    }
  }

  // --- Priority 3: broad sweeps that catch documents and aggregators ------
  for (const n of byType('name')) {
    const withLoc = loc ? `"${n.value}" "${loc}"` : `"${n.value}"`;
    add(task('web', 'search', { query: `${withLoc} (address OR phone OR "age")`, purpose: `people-search aggregators for ${n.value}`, selectorIds: [n.id], priority: 3 }));
    add(task('web', 'search', { query: `"${n.value}" (resume OR cv OR filetype:pdf)`, purpose: `documents naming ${n.value}`, selectorIds: [n.id], priority: 3 }));
  }
  for (const d of byType('domain')) {
    add(task('web', 'search', { query: `"${d.value}" -site:${d.value}`, purpose: `mentions of your domain elsewhere`, selectorIds: [d.id], priority: 3 }));
  }

  // --- Broker sweep: go straight at the sites that sell this data ---------
  if (enabled.has('brokers')) {
    for (const broker of brokers) {
      for (const url of brokerSearchUrls(broker, identity)) {
        tasks.push(
          task('brokers', 'fetch', {
            url,
            broker: broker.id,
            purpose: `${broker.name} people-search listing`,
            selectorIds: byType('name').map((s) => s.id),
            priority: 1,
          }),
        );
      }
    }
  }

  return tasks.sort((a, b) => a.priority - b.priority);
}
