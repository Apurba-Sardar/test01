import fs from 'node:fs';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { sendMail } from './mailer.js';

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
        };
      });
    this.store.prune(seen);
    console.log(`[config] monitoring ${this.sites.length} site(s)`);
    this.emit('update');
  }

  start() {
    this.runAll();
    this.timer = setInterval(() => this.runAll(), config.checkIntervalSec * 1000);
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
    const queue = [...this.sites];
    const events = [];
    const worker = async () => {
      while (queue.length) {
        const site = queue.shift();
        try {
          const ev = await this.checkSite(site);
          if (ev) events.push(ev);
        } catch (err) {
          console.error(`[check] ${site.name}: ${err.message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(config.concurrency, queue.length || 1) }, worker));
    this.running = false;
    this.emit('update');
    await this.sendAlerts(events);
  }

  async checkOne(id) {
    const site = this.sites.find((s) => s.id === id);
    if (!site) return null;
    const ev = await this.checkSite(site);
    this.emit('update');
    if (ev) await this.sendAlerts([ev]);
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

  async checkSite(site) {
    const s = this.store.get(site.id);
    const r = await this.probe(site);
    const now = Date.now();
    const slow = r.ok && r.ms > config.slowThresholdMs;

    s.lastCheck = now;
    s.responseTime = r.ms;
    s.statusCode = r.code;
    s.error = r.error;
    s.consecutiveFails = r.ok || r.blocked ? 0 : s.consecutiveFails + 1;
    this.store.record(site.id, { t: now, ok: r.blocked ? null : r.ok, ms: r.ms, slow });

    const prev = s.status;
    let next = prev;
    if (r.blocked) next = 'blocked'; // can't see the real site: neither up nor down, never alerts
    else if (r.ok) next = slow ? 'degraded' : 'up';
    else if (s.consecutiveFails >= config.failThreshold || prev === 'down') next = 'down';
    else if (prev === 'pending') next = 'pending';

    let event = null;
    if (next !== prev) {
      s.status = next;
      s.lastChange = now;
      if (next === 'down') {
        s.downSince = now;
        s.lastAlertAt = now;
        event = { kind: 'down', site, error: r.error };
      } else if (s.downSince && (next === 'up' || next === 'degraded')) {
        event = { kind: 'recovered', site, downtime: now - s.downSince };
        s.downSince = null;
      }
      if (event || next === 'blocked' || next === 'degraded' || (prev === 'degraded' && next === 'up')) {
        this.store.addIncident({
          t: now,
          siteId: site.id,
          name: site.name,
          from: prev,
          to: next,
          detail: next === 'down' || next === 'blocked' ? r.error : next === 'degraded' ? `Slow response: ${r.ms} ms` : event?.downtime ? `Down for ${fmtDur(event.downtime)}` : '',
        });
      }
    } else if (next === 'down' && config.realertMinutes > 0 && now - (s.lastAlertAt || 0) >= config.realertMinutes * 60000) {
      s.lastAlertAt = now;
      event = { kind: 'still-down', site, error: r.error, downtime: now - s.downSince };
    }

    // SSL certificate expiry (https only, every 6h)
    if (site.url.startsWith('https://') && (!s.ssl || now - s.ssl.checkedAt > SSL_CHECK_EVERY_MS)) {
      s.ssl = await this.checkSsl(site.url);
      const today = new Date().toISOString().slice(0, 10);
      if (s.ssl.daysLeft != null && s.ssl.daysLeft <= config.sslWarnDays && s.sslAlertDay !== today) {
        s.sslAlertDay = today;
        event = event || { kind: 'ssl', site, daysLeft: s.ssl.daysLeft, validTo: s.ssl.validTo };
      }
    }
    return event;
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
    const down = events.filter((e) => e.kind === 'down' || e.kind === 'still-down');
    const up = events.filter((e) => e.kind === 'recovered');
    const ssl = events.filter((e) => e.kind === 'ssl');
    const parts = [];
    if (down.length) parts.push(`${down.length} DOWN`);
    if (up.length) parts.push(`${up.length} recovered`);
    if (ssl.length) parts.push(`${ssl.length} SSL expiring`);
    const subject =
      events.length === 1
        ? {
            down: `🔴 DOWN: ${events[0].site.name}`,
            'still-down': `🔴 Still down (${fmtDur(events[0].downtime || 0)}): ${events[0].site.name}`,
            recovered: `✅ Recovered: ${events[0].site.name}`,
            ssl: `⚠️ SSL expires in ${events[0].daysLeft} days: ${events[0].site.name}`,
          }[events[0].kind]
        : `${down.length ? '🔴' : '✅'} Status alert: ${parts.join(', ')}`;

    const lines = [];
    for (const e of down)
      lines.push(`🔴 ${e.site.name} is ${e.kind === 'still-down' ? 'STILL DOWN' : 'DOWN'}`,
        { label: 'URL', value: e.site.url }, { label: 'Type', value: e.site.type },
        { label: 'Error', value: e.error }, ...(e.downtime ? [{ label: 'Down for', value: fmtDur(e.downtime) }] : []));
    for (const e of up)
      lines.push(`✅ ${e.site.name} is back UP`, { label: 'URL', value: e.site.url }, { label: 'Downtime', value: fmtDur(e.downtime) });
    for (const e of ssl)
      lines.push(`⚠️ ${e.site.name} SSL certificate expiring`, { label: 'URL', value: e.site.url },
        { label: 'Expires', value: `${e.validTo?.slice(0, 10)} (${e.daysLeft} days)` });
    lines.push({ label: 'Checked at', value: new Date().toUTCString() });
    await sendMail(subject, lines);
  }

  snapshot() {
    const sites = this.sites.map((site) => {
      const s = this.store.get(site.id);
      const h = s.history;
      const seen = h.filter((x) => x.ok !== null); // blocked checks don't count either way
      const okCount = seen.filter((x) => x.ok).length;
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
        uptime24h: seen.length ? (okCount / seen.length) * 100 : null,
        history: h.slice(-60),
      };
    });
    return {
      now: Date.now(),
      intervalSec: config.checkIntervalSec,
      checking: this.running,
      sites,
      incidents: this.store.incidents.slice(0, 50),
    };
  }
}
