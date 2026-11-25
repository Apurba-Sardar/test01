import fs from 'node:fs';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { sendMail } from './mailer.js';
import { runHealthChecks, discoverArticle, fetchDomainAuthority } from './checks.js';

// Text that means a WordPress site is broken even if the server answers.
const WP_ERROR_MARKERS = [
  'Error establishing a database connection',
  'There has been a critical error on this website',
  'Briefly unavailable for scheduled maintenance',
];
const NEXT_ERROR_MARKERS = ['Application error: a server-side exception has occurred', 'Internal Server Error'];

// Cloudflare (or similar) bot protection answering instead of the real site.
const CHALLENGE_MARKERS = ['Attention Required! | Cloudflare', '<title>Just a moment...</title>', 'challenge-platform', 'cf-chl-'];
const isChallenge = (res, body) =>
  res.headers.get('cf-mitigated') === 'challenge' ||
  ([403, 429, 503].includes(res.status) && CHALLENGE_MARKERS.some((m) => body.includes(m)));

const SSL_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const fmtDur = (ms) => {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'under 1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
};
const slug = (s) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export class Monitor extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.sites = [];
    this.running = false;
    this.loadSites();
    fs.watchFile(config.sitesFile, { interval: 2000 }, () => {
      console.log('[config] sites file changed, reloading');
      this.loadSites();
      this.runAll();
    });
  }

  loadSites() {
    let list;
    try {
      list = JSON.parse(fs.readFileSync(config.sitesFile, 'utf8'));
      if (!Array.isArray(list)) list = list.sites;
      if (!Array.isArray(list)) throw new Error('expected an array of sites');
    } catch (err) {
      console.error(`[config] cannot read ${config.sitesFile}: ${err.message}`);
      return;
    }
    const seen = new Set();
    this.sites = list
      .filter((s) => s && s.url && s.enabled !== false)
      .map((s) => {
        let id = s.id || slug(s.name || s.url);
        while (seen.has(id)) id += '-2';
        seen.add(id);
        const type = String(s.type || 'other').toLowerCase().replace(/[^a-z]/g, '');
        return {
          id,
          name: s.name || s.url,
          url: s.url,
          type: type === 'wp' ? 'wordpress' : type === 'next' ? 'nextjs' : type,
          group: s.group || '',
          keyword: s.keyword || '',
          expectedStatus: s.expectedStatus || null,
          method: s.method || 'GET',
          headers: s.headers || {},
          timeoutMs: s.timeoutMs || config.timeoutMs,
          articleUrl: s.articleUrl === false ? false : s.articleUrl || '',
          pages: Array.isArray(s.pages) ? s.pages : [],
        };
      });
    this.store.prune(seen);
    console.log(`[config] monitoring ${this.sites.length} site(s)`);
    this.emit('update');
  }

  start() {
    this.startedAt = Date.now();
    this.runAll();
    this.nextRunAt = Date.now() + config.checkIntervalSec * 1000;
    this.timer = setInterval(() => {
      this.nextRunAt = Date.now() + config.checkIntervalSec * 1000;
      this.runAll();
    }, config.checkIntervalSec * 1000);
  }

  /** Maintenance mode: a paused site is not checked and never alerts. */
  async setPaused(id, paused) {
    const site = this.sites.find((s) => s.id === id);
    if (!site) return null;
    const s = this.store.get(id);
    if (s.paused === paused) return s;
    s.paused = paused;
    s.lastChange = Date.now();
    s.consecutiveFails = 0;
    s.downSince = null; // don't send a "recovered" mail for downtime that happened before the pause
    for (const ps of Object.values(s.pages || {})) Object.assign(ps, { status: 'pending', downSince: null, consecutiveFails: 0 });
    s.status = paused ? 'paused' : 'pending';
    this.store.addIncident({ t: Date.now(), siteId: id, name: site.name, from: '', to: paused ? 'paused' : 'resumed', detail: paused ? 'Monitoring paused' : 'Monitoring resumed' });
    this.emit('update');
    if (!paused) await this.checkOne(id);
    return s;
  }

  // force=false (timer / cron) skips the run if the last one finished less than half an
  // interval ago, so a cron job plus the built-in timer don't double-count failures.
  runAll(force = false) {
    if (this.current) return this.current;
    if (!force && this.lastRunAt && Date.now() - this.lastRunAt < (config.checkIntervalSec * 1000) / 2) return Promise.resolve();
    this.current = this.#runAll().finally(() => {
      this.current = null;
      this.lastRunAt = Date.now();
    });
    return this.current;
  }

  async #runAll() {
    this.running = true;
    const queue = this.sites.filter((s) => !this.store.get(s.id).paused);
    const events = [];
    const worker = async () => {
      while (queue.length) {
        const site = queue.shift();
        try {
          events.push(...(await this.checkSite(site)));
        } catch (err) {
          console.error(`[check] ${site.name}: ${err.message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(config.concurrency, queue.length || 1) }, worker));
    this.running = false;
    this.emit('update');
    await this.sendAlerts(events);
    this.runHealthDue().catch((e) => console.error(`[health] ${e.message}`));
  }

  async checkOne(id) {
    const site = this.sites.find((s) => s.id === id);
    if (!site) return null;
    if (this.store.get(id).paused) return this.store.get(id);
    const events = await this.checkSite(site);
    this.emit('update');
    await this.sendAlerts(events);
    return this.store.get(id);
  }

  async probe(site) {
    const start = performance.now();
    try {
      const res = await fetch(site.url, {
        method: site.method,
        redirect: 'follow',
        signal: AbortSignal.timeout(site.timeoutMs),
        headers: {
          'user-agent': 'InternalStatusMonitor/1.0',
          'cache-control': 'no-cache',
          ...(config.monitorToken ? { 'x-status-monitor': config.monitorToken } : {}),
          ...site.headers,
        },
      });
      const body = site.method === 'HEAD' ? '' : await res.text();
      const ms = Math.round(performance.now() - start);
      if (isChallenge(res, body))
        return { ok: false, blocked: true, ms, code: res.status, error: `Blocked by bot protection (HTTP ${res.status}) — allow the monitor in Cloudflare` };
      const okStatus = site.expectedStatus
        ? [].concat(site.expectedStatus).map(Number).includes(res.status)
        : res.status >= 200 && res.status < 400;
      if (!okStatus) return { ok: false, ms, code: res.status, error: `HTTP ${res.status} ${res.statusText}` };
      if (site.keyword && !body.includes(site.keyword))
        return { ok: false, ms, code: res.status, error: `Keyword "${site.keyword}" not found` };
      const markers = site.type === 'wordpress' ? WP_ERROR_MARKERS : site.type === 'nextjs' ? NEXT_ERROR_MARKERS : [];
      const hit = markers.find((m) => body.includes(m));
      if (hit) return { ok: false, ms, code: res.status, error: `Error page detected: "${hit}"` };
      return { ok: true, ms, code: res.status, error: null };
    } catch (err) {
      const ms = Math.round(performance.now() - start);
      const cause = err.cause?.code || err.cause?.message;
      const msg = err.name === 'TimeoutError' ? `Timeout after ${site.timeoutMs} ms` : cause ? `${err.message} (${cause})` : err.message;
      return { ok: false, ms, code: null, error: msg };
    }
  }

  /** The pages checked for a site: homepage, an article page, plus any extra "pages" from sites.json. */
  pagesFor(site, s) {
    const pages = [{ key: 'home', name: 'Homepage', url: site.url, keyword: site.keyword }];
    if (site.articleUrl !== false) pages.push({ key: 'article', name: 'Article page', url: site.articleUrl || s.article?.url || null, keyword: '' });
    (site.pages || []).forEach((p, i) => p?.url && pages.push({ key: `page${i}`, name: p.name || p.url, url: p.url, keyword: p.keyword || '' }));
    return pages;
  }

  async ensureArticle(site, s) {
    if (site.articleUrl || site.articleUrl === false) return;
    if (s.article && Date.now() - s.article.checkedAt < config.articleRefreshHours * 3600000 && s.article.url) return;
    if (s.article && !s.article.url && Date.now() - s.article.checkedAt < 3600000) return; // retry hourly when nothing was found
    try {
      s.article = { url: await discoverArticle(site), checkedAt: Date.now() };
    } catch (err) {
      s.article = { url: s.article?.url || null, checkedAt: Date.now(), error: err.message };
    }
  }

  async checkSite(site) {
    const s = this.store.get(site.id);
    await this.ensureArticle(site, s);
    const pages = this.pagesFor(site, s);
    const results = await Promise.all(pages.map((p) => (p.url ? this.probe({ ...site, url: p.url, keyword: p.keyword }) : null)));
    const now = Date.now();
    const events = [];
    s.pages ||= {};
    for (const k of Object.keys(s.pages)) if (!pages.some((p) => p.key === k)) delete s.pages[k];

    pages.forEach((p, i) => {
      const r = results[i];
      const ps = (s.pages[p.key] ||= { status: 'pending', consecutiveFails: 0 });
      ps.name = p.name;
      ps.url = p.url;
      if (!r) {
        ps.status = 'pending';
        ps.error = p.key === 'article' ? 'No article found yet — set "articleUrl" in sites.json' : 'No URL';
        return;
      }
      ps.lastCheck = now;
      ps.ms = r.ms;
      ps.code = r.code;
      ps.error = r.error;
      ps.consecutiveFails = r.ok || r.blocked ? 0 : (ps.consecutiveFails || 0) + 1;
      const prev = ps.status;
      let next = prev;
      if (r.blocked) next = 'blocked';
      else if (r.ok) next = 'up';
      else if (ps.consecutiveFails >= config.failThreshold || prev === 'down') next = 'down';
      else if (prev === 'pending') next = 'pending';
      const label = p.key === 'home' ? site.name : `${site.name} · ${p.name}`;
      if (next !== prev) {
        ps.status = next;
        ps.lastChange = now;
        if (next === 'down') {
          ps.downSince = now;
          ps.lastAlertAt = now;
          events.push({ kind: 'down', site, page: p, error: r.error });
          this.store.addIncident({ t: now, siteId: site.id, page: p.key, name: label, from: prev, to: 'down', detail: r.error });
        } else if (ps.downSince && next === 'up') {
          events.push({ kind: 'recovered', site, page: p, downtime: now - ps.downSince });
          this.store.addIncident({ t: now, siteId: site.id, page: p.key, name: label, from: prev, to: 'up', detail: `Down for ${fmtDur(now - ps.downSince)}` });
          ps.downSince = null;
        } else if (next === 'blocked' && now - (ps.lastBlockedLog || 0) > 6 * 3600000) {
          // Cloudflare often blocks some checks and not others; log it at most every 6 h per page
          ps.lastBlockedLog = now;
          this.store.addIncident({ t: now, siteId: site.id, page: p.key, name: label, from: prev, to: 'blocked', detail: r.error });
        }
      } else if (next === 'down' && config.realertMinutes > 0 && now - (ps.lastAlertAt || 0) >= config.realertMinutes * 60000) {
        ps.lastAlertAt = now;
        events.push({ kind: 'still-down', site, page: p, error: r.error, downtime: now - ps.downSince });
      }
    });

    // Site-level summary
    const home = s.pages.home;
    const hr = results[0];
    const others = pages.slice(1).map((p) => s.pages[p.key]).filter((x) => x && x.status !== 'pending');
    const slow = hr?.ok && hr.ms > config.slowThresholdMs;
    const counted = results.filter((r) => r && !r.blocked);
    this.store.record(site.id, { t: now, ok: counted.length ? counted.every((r) => r.ok) : null, ms: hr?.ms ?? null, slow });
    s.lastCheck = now;
    s.responseTime = hr?.ms ?? null;
    s.statusCode = hr?.code ?? null;
    const brokenPage = others.find((x) => x.status === 'down');
    s.error = home.status === 'up' && brokenPage ? `${brokenPage.name}: ${brokenPage.error}` : home.error;
    s.downSince = home.downSince || brokenPage?.downSince || null;

    let st;
    if (home.status === 'blocked') st = 'blocked';
    else if (home.status === 'down') st = 'down';
    else if (home.status === 'pending') st = 'pending';
    else if (brokenPage) st = 'partial';
    else if (slow) st = 'degraded';
    else st = 'up';
    if (st !== s.status) {
      if (st === 'degraded') this.store.addIncident({ t: now, siteId: site.id, name: site.name, from: s.status, to: 'degraded', detail: `Slow response: ${hr.ms} ms` });
      else if (s.status === 'degraded' && st === 'up') this.store.addIncident({ t: now, siteId: site.id, name: site.name, from: 'degraded', to: 'up', detail: 'Response time back to normal' });
      s.status = st;
      s.lastChange = now;
    }

    // SSL certificate expiry (https only, every 6h)
    if (site.url.startsWith('https://') && (!s.ssl || now - s.ssl.checkedAt > SSL_CHECK_EVERY_MS)) {
      s.ssl = await this.checkSsl(site.url);
      const today = new Date().toISOString().slice(0, 10);
      if (s.ssl.daysLeft != null && s.ssl.daysLeft <= config.sslWarnDays && s.sslAlertDay !== today) {
        s.sslAlertDay = today;
        events.push({ kind: 'ssl', site, daysLeft: s.ssl.daysLeft, validTo: s.ssl.validTo });
      }
    }
    return events;
  }

  /** Run the slower health checks (and DA) for sites that are due. Runs in the background. */
  async runHealthDue(force = false) {
    if (this.healthRunning) return;
    this.healthRunning = true;
    try {
      for (const site of this.sites) {
        const s = this.store.get(site.id);
        if (s.paused) continue;
        if (force || !s.health || Date.now() - s.health.checkedAt > config.healthIntervalHours * 3600000) await this.runHealth(site, false);
        // refresh DA weekly; retry failures after 6 h; fetch at once when a token was just added
        const daAge = s.da ? Date.now() - s.da.checkedAt : Infinity;
        const daDue = !s.da || (s.da.noToken && config.mozToken) || daAge > (s.da.error ? 6 * 3600000 : config.daRefreshDays * 86400000);
        if (daDue) {
          try { s.da = { ...(await fetchDomainAuthority(site.url)), prev: s.da?.value ?? s.da?.prev ?? null }; } catch (e) { s.da = { ...s.da, error: e.message, checkedAt: Date.now() }; }
          this.store.dirty = true;
          this.emit('update');
        }
      }
    } finally {
      this.healthRunning = false;
    }
  }

  async runHealth(site, emit = true) {
    const s = this.store.get(site.id);
    const before = new Map((s.health?.items || []).map((i) => [i.key, i.status]));
    s.health = await runHealthChecks(site, s.ssl);
    this.store.dirty = true;
    const newlyFailed = s.health.items.filter((i) => i.status === 'fail' && before.has(i.key) && before.get(i.key) !== 'fail');
    const fixed = s.health.items.filter((i) => i.status === 'pass' && before.get(i.key) === 'fail');
    for (const i of newlyFailed) this.store.addIncident({ t: Date.now(), siteId: site.id, name: site.name, from: '', to: 'check-fail', detail: `${i.name}: ${i.detail}` });
    for (const i of fixed) this.store.addIncident({ t: Date.now(), siteId: site.id, name: site.name, from: '', to: 'check-pass', detail: `${i.name} fixed` });
    if (newlyFailed.length) await this.sendAlerts(newlyFailed.map((i) => ({ kind: 'health', site, item: i })));
    this.emit('update');
    return s.health;
  }

  checkSsl(url) {
    return new Promise((resolve) => {
      const { hostname, port } = new URL(url);
      const done = (v) => resolve({ ...v, checkedAt: Date.now() });
      const sock = tls.connect({ host: hostname, port: Number(port) || 443, servername: hostname, timeout: 10000 }, () => {
        const cert = sock.getPeerCertificate();
        sock.end();
        if (!cert?.valid_to) return done({ daysLeft: null, error: 'No certificate' });
        const validTo = new Date(cert.valid_to);
        done({ validTo: validTo.toISOString(), daysLeft: Math.floor((validTo - Date.now()) / 86400000), issuer: cert.issuer?.O || '' });
      });
      sock.on('error', (e) => done({ daysLeft: null, error: e.message }));
      sock.on('timeout', () => { sock.destroy(); done({ daysLeft: null, error: 'timeout' }); });
    });
  }

  // One email per check cycle, so a whole server going down doesn't send 30 emails.
  async sendAlerts(events) {
    if (!events.length) return;
    const label = (e) => (!e.page || e.page.key === 'home' ? e.site.name : `${e.site.name} (${e.page.name})`);
    const down = events.filter((e) => e.kind === 'down' || e.kind === 'still-down');
    const up = events.filter((e) => e.kind === 'recovered');
    const ssl = events.filter((e) => e.kind === 'ssl');
    const health = events.filter((e) => e.kind === 'health');
    const parts = [];
    if (down.length) parts.push(`${down.length} DOWN`);
    if (up.length) parts.push(`${up.length} recovered`);
    if (ssl.length) parts.push(`${ssl.length} SSL expiring`);
    if (health.length) parts.push(`${health.length} check(s) failing`);
    const e0 = events[0];
    const subject =
      events.length === 1
        ? {
            down: `🔴 DOWN: ${label(e0)}`,
            'still-down': `🔴 Still down (${fmtDur(e0.downtime || 0)}): ${label(e0)}`,
            recovered: `✅ Recovered: ${label(e0)}`,
            ssl: `⚠️ SSL expires in ${e0.daysLeft} days: ${e0.site.name}`,
            health: `⚠️ ${e0.site.name}: ${e0.item?.name} failing`,
          }[e0.kind]
        : `${down.length ? '🔴' : up.length && !health.length ? '✅' : '⚠️'} Status alert: ${parts.join(', ')}`;

    const lines = [];
    for (const e of down)
      lines.push(`🔴 ${label(e)} is ${e.kind === 'still-down' ? 'STILL DOWN' : 'DOWN'}`,
        { label: 'URL', value: e.page?.url || e.site.url }, { label: 'Type', value: e.site.type },
        { label: 'Error', value: e.error }, ...(e.downtime ? [{ label: 'Down for', value: fmtDur(e.downtime) }] : []));
    for (const e of up)
      lines.push(`✅ ${label(e)} is back UP`, { label: 'URL', value: e.page?.url || e.site.url }, { label: 'Downtime', value: fmtDur(e.downtime) });
    for (const e of ssl)
      lines.push(`⚠️ ${e.site.name} SSL certificate expiring`, { label: 'URL', value: e.site.url },
        { label: 'Expires', value: `${e.validTo?.slice(0, 10)} (${e.daysLeft} days)` });
    for (const e of health)
      lines.push(`⚠️ ${e.site.name}: ${e.item.name}`, { label: 'URL', value: e.site.url }, { label: 'Problem', value: e.item.detail });
    lines.push({ label: 'Checked at', value: new Date().toUTCString() });
    await sendMail(subject, lines);
  }

  siteView(site) {
    const s = this.store.get(site.id);
    const h = s.history;
    const seen = h.filter((x) => x.ok !== null); // blocked checks don't count either way
    const okCount = seen.filter((x) => x.ok).length;
    const okMs = seen.filter((x) => x.ok).map((x) => x.ms);
    const fromHourly = (days) => {
      const cut = Date.now() - days * 86400000;
      let n = 0, ok = 0;
      for (const b of s.hourly || []) if (b.h >= cut) { n += b.n; ok += b.ok; }
      return n ? (ok / n) * 100 : null;
    };
    return {
        ...site,
        headers: undefined,
        status: s.status,
        lastCheck: s.lastCheck,
        lastChange: s.lastChange,
        downSince: s.downSince,
        responseTime: s.responseTime,
        statusCode: s.statusCode,
        error: s.error,
        ssl: s.ssl,
        paused: !!s.paused,
        pages: this.pagesFor(site, s).map((p) => {
          const ps = s.pages?.[p.key] || {};
          return { key: p.key, name: p.name, url: p.url, status: s.paused ? 'paused' : ps.status || 'pending', ms: ps.ms ?? null, code: ps.code ?? null, error: ps.error || null, lastCheck: ps.lastCheck || null, downSince: ps.downSince || null };
        }),
        health: s.health || null,
        da: s.da || null,
        uptime24h: seen.length ? (okCount / seen.length) * 100 : null,
        uptime7d: fromHourly(7),
        uptime30d: fromHourly(30),
        avgResponse24h: okMs.length ? Math.round(okMs.reduce((a, b) => a + b, 0) / okMs.length) : null,
        history: h.slice(-60),
    };
  }

  /** Everything the site detail panel needs. */
  detail(id) {
    const site = this.sites.find((s) => s.id === id);
    if (!site) return null;
    const s = this.store.get(id);
    return {
      ...this.siteView(site),
      history: s.history,
      hourly: s.hourly || [],
      incidents: this.store.incidents.filter((i) => i.siteId === id).slice(0, 50),
    };
  }

  snapshot() {
    const sites = this.sites.map((site) => this.siteView(site));
    return {
      now: Date.now(),
      intervalSec: config.checkIntervalSec,
      checking: this.running,
      startedAt: this.startedAt,
      lastRunAt: this.lastRunAt || null,
      nextRunAt: this.nextRunAt || null,
      failThreshold: config.failThreshold,
      slowThresholdMs: config.slowThresholdMs,
      sites,
      incidents: this.store.incidents.slice(0, 50),
    };
  }
}
