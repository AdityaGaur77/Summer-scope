/**
 * Adapter over Agent Reach (https://github.com/Panniantong/agent-reach).
 *
 * Agent Reach is a router, not a fetcher: it installs and health-checks upstream
 * tools (Jina Reader, Exa via mcporter, `gh`, `twitter`, `opencli`, ...) and
 * reports which backend is live for each channel via `agent-reach doctor --json`.
 * This module speaks that model: ask the doctor what is up, dispatch to the
 * backend it names, and degrade down a documented chain when a backend is
 * missing rather than inventing commands.
 *
 * Everything here is read-only. Nothing in this file posts, comments, or logs in.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hostOf, hostThrottle, log, truncate } from './util.mjs';

const execFileAsync = promisify(execFile);

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Ported from agent_reach/channels/web.py -- Jina and Cloudflare challenge pages. */
function isAntibotPage(body = '') {
  const sample = body.slice(0, 4096).toLowerCase();
  const jinaCaptcha = sample.includes('warning:') && sample.includes('requiring captcha');
  const challenge = [
    'title: just a moment...',
    '## performing security verification',
    'title: attention required! | cloudflare',
  ].some((m) => sample.includes(m));
  const cloudflare =
    sample.includes('title: attention required! | cloudflare') &&
    (sample.includes('ray id') || sample.includes('/cdn-cgi/challenge-platform/'));
  return (jinaCaptcha && challenge) || cloudflare;
}

function stripHtml(html = '') {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Backends disagree on output shape (JSON, YAML, plain markdown) and that shape
 * drifts as Agent Reach re-routes. Try JSON, then fall back to harvesting links,
 * so a backend upgrade degrades the snippet quality instead of the whole scan.
 */
function parseResults(text, via) {
  const out = [];
  const seen = new Set();
  const push = (url, title, snippet) => {
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push({ url, title: truncate(title || '', 160), snippet: truncate(snippet || '', 300), via });
  };

  try {
    const data = JSON.parse(text);
    const rows = Array.isArray(data)
      ? data
      : data.results || data.data || data.items || data.hits || [];
    for (const row of Array.isArray(rows) ? rows : []) {
      if (typeof row === 'string') push(row, '', '');
      else push(row.url || row.link || row.href || row.permalink, row.title || row.name, row.snippet || row.text || row.description || row.summary);
    }
    if (out.length) return out;
  } catch {
    /* not JSON -- fall through to link harvesting */
  }

  // Markdown links first (Jina and most CLIs emit these), then bare URLs.
  for (const m of text.matchAll(/\[([^\]]{0,160})\]\((https?:\/\/[^\s)]+)\)/g)) push(m[2], m[1], '');
  for (const m of text.matchAll(/(?:^|\s)(https?:\/\/[^\s"'<>)\]]+)/g)) push(m[1], '', '');
  return out;
}

export class Reach {
  constructor({ timeoutMs = 45_000, minGapMs = 1500, offline = false } = {}) {
    this.timeoutMs = timeoutMs;
    this.offline = offline;
    this.throttle = hostThrottle(minGapMs);
    this._which = new Map();
    this._doctor = null;
  }

  async run(cmd, args, { timeout = this.timeoutMs } = {}) {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        timeout,
        maxBuffer: MAX_BODY_BYTES,
        encoding: 'utf8',
      });
      return { ok: true, stdout, stderr };
    } catch (err) {
      return { ok: false, stdout: err.stdout || '', stderr: err.stderr || String(err.message || err) };
    }
  }

  async has(cmd) {
    if (this._which.has(cmd)) return this._which.get(cmd);
    const { ok } = await this.run('which', [cmd], { timeout: 5000 });
    this._which.set(cmd, ok);
    return ok;
  }

  /**
   * `agent-reach doctor --json` returns a map of channel key -> {status, name,
   * active_backend}. A null active_backend is not "broken": the doctor skips live
   * probes that would touch browser cookies, so we treat the channel as
   * *possible* and let the actual command decide.
   */
  async doctor({ refresh = false } = {}) {
    if (this._doctor && !refresh) return this._doctor;
    const installed = await this.has('agent-reach');
    if (!installed) {
      this._doctor = { installed: false, channels: {} };
      return this._doctor;
    }
    const { ok, stdout } = await this.run('agent-reach', ['doctor', '--json'], { timeout: 60_000 });
    let channels = {};
    if (ok) {
      try {
        const parsed = JSON.parse(stdout);
        channels = parsed.channels || parsed.results || parsed;
      } catch {
        log.warn('agent-reach doctor returned unparseable JSON; treating channels as unknown');
      }
    }
    this._doctor = { installed: true, channels };
    return this._doctor;
  }

  async channelStatus(key) {
    const { channels } = await this.doctor();
    const row = channels?.[key];
    if (!row) return { status: 'unknown', backend: null };
    return { status: row.status || 'unknown', backend: row.active_backend || null, name: row.name };
  }

  /** Prefer curl when present: it is what Agent Reach documents, and it honours proxy env. */
  async httpGet(url, { headers = {}, timeout = this.timeoutMs } = {}) {
    if (this.offline) return { ok: false, status: 0, body: '', error: 'offline mode' };
    await this.throttle(hostOf(url));
    const hdrs = { 'User-Agent': UA, ...headers };
    if (await this.has('curl')) {
      const args = ['-sSL', '--compressed', '--max-time', String(Math.ceil(timeout / 1000)), '-w', '\n%{http_code}'];
      for (const [k, v] of Object.entries(hdrs)) args.push('-H', `${k}: ${v}`);
      args.push(url);
      const { ok, stdout, stderr } = await this.run('curl', args, { timeout: timeout + 5000 });
      if (!ok && !stdout) return { ok: false, status: 0, body: '', error: stderr.trim() };
      const idx = stdout.lastIndexOf('\n');
      const status = Number(stdout.slice(idx + 1).trim()) || 0;
      const body = stdout.slice(0, Math.max(0, idx));
      return { ok: status >= 200 && status < 400, status, body };
    }
    try {
      const res = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
      const body = (await res.text()).slice(0, MAX_BODY_BYTES);
      return { ok: res.ok, status: res.status, body };
    } catch (err) {
      return { ok: false, status: 0, body: '', error: String(err.message || err) };
    }
  }

  /** HEAD-ish liveness probe used by `registry --verify`. */
  async probe(url) {
    const res = await this.httpGet(url, { timeout: 20_000 });
    return { url, status: res.status, ok: res.ok, error: res.error || null };
  }

  // ---------------------------------------------------------------- reading

  /**
   * Read a page as text. Chain: Jina Reader (Agent Reach's `web` channel, always
   * available, no key) -> direct fetch with tags stripped.
   */
  async read(url) {
    const jina = await this.httpGet(`https://r.jina.ai/${url}`, { headers: { Accept: 'text/plain' } });
    if (jina.ok && jina.body && !isAntibotPage(jina.body)) {
      return { ok: true, text: jina.body, via: 'jina-reader', status: jina.status };
    }
    if (jina.ok && isAntibotPage(jina.body)) {
      log.detail(`anti-bot challenge via Jina for ${url}; trying direct`);
    }
    const direct = await this.httpGet(url, { headers: { Accept: 'text/html,*/*' } });
    if (direct.ok && direct.body) return { ok: true, text: stripHtml(direct.body), via: 'direct', status: direct.status };
    // The origin's own status is what `verify` needs: a 404/410 from the site is
    // evidence of removal, while a timeout is only evidence of a bad minute.
    return {
      ok: false,
      text: '',
      via: null,
      status: direct.status,
      error: direct.error || `jina:${jina.status} direct:${direct.status}`,
    };
  }

  // --------------------------------------------------------------- searching

  async searchWeb(query, limit) {
    if (await this.has('mcporter')) {
      const { ok, stdout } = await this.run('mcporter', [
        'call',
        'exa.web_search_exa',
        `query=${query}`,
        `numResults=${limit}`,
      ]);
      if (ok) {
        const rows = parseResults(stdout, 'exa');
        if (rows.length) return rows.slice(0, limit);
      }
    }

    const jina = await this.httpGet(`https://s.jina.ai/${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json' },
    });
    if (jina.ok && jina.body && !isAntibotPage(jina.body)) {
      const rows = parseResults(jina.body, 'jina-search');
      if (rows.length) return rows.slice(0, limit);
    }

    const ddg = await this.httpGet(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { Accept: 'text/html' } },
    );
    if (ddg.ok && ddg.body) {
      const rows = [];
      for (const m of ddg.body.matchAll(
        /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
      )) {
        let href = m[1].replace(/&amp;/g, '&');
        const wrapped = href.match(/[?&]uddg=([^&]+)/);
        if (wrapped) href = decodeURIComponent(wrapped[1]);
        rows.push({ url: href, title: truncate(stripHtml(m[2]), 160), snippet: '', via: 'duckduckgo' });
      }
      if (rows.length) return rows.slice(0, limit);
    }
    return [];
  }

  async searchGithub(query, limit) {
    if (await this.has('gh')) {
      const attempts = [
        ['search', 'users', query, '--limit', String(limit), '--json', 'login,url,name,bio'],
        ['search', 'code', query, '--limit', String(limit), '--json', 'path,repository,url'],
      ];
      const rows = [];
      for (const args of attempts) {
        const { ok, stdout } = await this.run('gh', args);
        if (!ok) continue;
        try {
          for (const row of JSON.parse(stdout)) {
            rows.push({
              url: row.url || (row.login ? `https://github.com/${row.login}` : ''),
              title: row.name || row.login || `${row.repository?.nameWithOwner || ''}/${row.path || ''}`,
              snippet: row.bio || row.path || '',
              via: 'gh',
            });
          }
        } catch {
          rows.push(...parseResults(stdout, 'gh'));
        }
      }
      if (rows.length) return rows.filter((r) => r.url).slice(0, limit);
    }
    return this.searchWeb(`site:github.com ${query}`, limit);
  }

  async searchTwitter(query, limit) {
    if (await this.has('twitter')) {
      const { ok, stdout } = await this.run('twitter', ['search', query, '-n', String(limit)]);
      if (ok) {
        const rows = parseResults(stdout, 'twitter-cli');
        if (rows.length) return rows.slice(0, limit);
      }
      log.detail('twitter-cli present but returned nothing; needs TWITTER_AUTH_TOKEN / TWITTER_CT0');
    }
    return this.searchWeb(`site:x.com OR site:twitter.com ${query}`, limit);
  }

  async searchReddit(query, limit) {
    if (await this.has('opencli')) {
      const { ok, stdout } = await this.run('opencli', ['reddit', 'search', query, '-f', 'yaml']);
      if (ok) {
        const rows = parseResults(stdout, 'opencli-reddit');
        if (rows.length) return rows.slice(0, limit);
      }
    }
    if (await this.has('rdt')) {
      const { ok, stdout } = await this.run('rdt', ['search', query, '--limit', String(limit)]);
      if (ok) {
        const rows = parseResults(stdout, 'rdt-cli');
        if (rows.length) return rows.slice(0, limit);
      }
    }
    return this.searchWeb(`site:reddit.com ${query}`, limit);
  }

  /** Single entry point used by the scanner. Unknown channels fall back to web. */
  async search(channel, query, { limit = 8 } = {}) {
    if (this.offline) return [];
    switch (channel) {
      case 'github':
        return this.searchGithub(query, limit);
      case 'twitter':
        return this.searchTwitter(query, limit);
      case 'reddit':
        return this.searchReddit(query, limit);
      case 'web':
      case 'brokers':
      default:
        return this.searchWeb(query, limit);
    }
  }

  /** Human-readable summary of what this run can actually reach. */
  async capabilities() {
    const doc = await this.doctor();
    const [mcporter, gh, twitter, opencli, rdt, curl] = await Promise.all([
      this.has('mcporter'),
      this.has('gh'),
      this.has('twitter'),
      this.has('opencli'),
      this.has('rdt'),
      this.has('curl'),
    ]);
    return {
      agentReach: doc.installed,
      channels: doc.channels,
      backends: { mcporter, gh, twitter, opencli, rdt, curl },
      webSearch: mcporter ? 'exa (via agent-reach/mcporter)' : 'jina-search -> duckduckgo fallback',
      webRead: 'jina-reader -> direct fetch',
    };
  }
}
