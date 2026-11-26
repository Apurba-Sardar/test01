// Storage for TMJ Dashboard.
//
//   <DATA_DIR>/state.json              live state: current status, last 24h of checks, 90 days of hourly
//                                      totals and daily totals kept forever (rewritten every 30 s)
//   <DATA_DIR>/checks/YYYY-MM-DD.ndjson every single check, one JSON line each (append-only, one file per
//                                      UTC day, kept for LOG_RETENTION_DAYS; 0 = forever)
//   <DATA_DIR>/incidents.ndjson        every event ever (down, recovered, blocked, health changes…), forever
//   <DATA_DIR>/health.ndjson           every health & SEO check run, forever
//   <DATA_DIR>/da.ndjson               every Domain Authority reading, forever
//
// Append-only files are never rewritten, so old data can't be lost by a crash mid-save, and they are
// easy to back up, download (see /api/export/*) or open in any tool.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const HISTORY_MS = 24 * 60 * 60 * 1000; // raw checks kept in memory (charts, last-60 bars)
const HOURLY_MS = 90 * 24 * 60 * 60 * 1000; // hourly totals kept in state.json
const MEM_INCIDENTS = 5000; // events kept in memory for the UI (the file keeps everything)
const HOUR = 3600 * 1000;
const day = (t) => new Date(t).toISOString().slice(0, 10); // UTC day

export class Store {
  constructor(dataDir, { retentionDays = 365 } = {}) {
    this.dir = path.resolve(dataDir);
    this.file = path.join(this.dir, 'state.json');
    this.checksDir = path.join(this.dir, 'checks');
    this.retentionDays = retentionDays;
    this.ok = true;
    try {
      fs.mkdirSync(this.checksDir, { recursive: true });
    } catch (err) {
      this.ok = false;
      console.error(`[store] cannot create ${this.dir}: ${err.message} — history will not be saved`);
    }
    this.sites = {}; // id -> runtime state
    this.incidents = []; // newest first (in memory)
    let legacyIncidents = [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.sites = raw.sites || {};
      legacyIncidents = raw.incidents || [];
    } catch {
      /* first run */
    }
    // Events: load the newest ones from the permanent log; migrate the old state.json list once.
    const incFile = path.join(this.dir, 'incidents.ndjson');
    if (fs.existsSync(incFile)) this.incidents = this.#tailJson(incFile, MEM_INCIDENTS).reverse();
    else if (legacyIncidents.length) {
      this.incidents = legacyIncidents.slice(0, MEM_INCIDENTS);
      this.#appendNow('incidents.ndjson', [...legacyIncidents].reverse());
    }
    // Back-fill daily totals from hourly data saved by older versions.
    for (const s of Object.values(this.sites)) if (!s.daily && s.hourly?.length) this.#rebuildDaily(s);

    this.buffer = new Map(); // file -> pending lines
    this.dirty = false;
    setInterval(() => this.flush(), 30_000).unref();
    setInterval(() => this.flushAppends(), 5_000).unref();
    this.pruneLogs();
    setInterval(() => this.pruneLogs(), 24 * HOUR).unref();
  }

  get(id) {
    if (!this.sites[id]) {
      this.sites[id] = {
        status: 'pending',
        lastCheck: null,
        lastChange: null,
        downSince: null,
        lastAlertAt: null,
        responseTime: null,
        statusCode: null,
        error: null,
        consecutiveFails: 0,
        ssl: null,
        sslAlertDay: null,
        history: [],
        hourly: [], // [{ h: hourStart, n: checks, ok: successes, ms: total ms of successes }]
        daily: [], // [{ d: 'YYYY-MM-DD', n, ok, ms }] — kept forever
        paused: false,
      };
    }
    return this.sites[id];
  }

  /** Record one check result for a site. `extra` is only written to the permanent check log. */
  record(id, result, extra = {}) {
    const s = this.get(id);
    s.history.push({ t: result.t, ok: result.ok, ms: result.ms, slow: !!result.slow });
    const cutoff = Date.now() - HISTORY_MS;
    while (s.history.length && s.history[0].t < cutoff) s.history.shift();

    if (result.ok !== null) {
      // hourly totals (90 days)
      s.hourly ||= [];
      const h = Math.floor(result.t / HOUR) * HOUR;
      let b = s.hourly[s.hourly.length - 1];
      if (!b || b.h !== h) s.hourly.push((b = { h, n: 0, ok: 0, ms: 0 }));
      b.n++;
      if (result.ok) { b.ok++; b.ms += result.ms; }
      const hCut = Date.now() - HOURLY_MS;
      while (s.hourly.length && s.hourly[0].h < hCut) s.hourly.shift();
      // daily totals (forever)
      s.daily ||= [];
      const d = day(result.t);
      let dd = s.daily[s.daily.length - 1];
      if (!dd || dd.d !== d) s.daily.push((dd = { d, n: 0, ok: 0, ms: 0 }));
      dd.n++;
      if (result.ok) { dd.ok++; dd.ms += result.ms; }
    }
    this.#append(`checks/${day(result.t)}.ndjson`, { t: result.t, site: id, ok: result.ok, ms: result.ms, slow: !!result.slow, ...extra });
    this.dirty = true;
  }

  addIncident(incident) {
    this.incidents.unshift(incident);
    if (this.incidents.length > MEM_INCIDENTS) this.incidents.length = MEM_INCIDENTS;
    this.#append('incidents.ndjson', incident);
    this.dirty = true;
  }

  logHealth(siteId, health) {
    this.#append('health.ndjson', { t: health.checkedAt, site: siteId, items: health.items.map((i) => ({ key: i.key, status: i.status, detail: i.detail })) });
  }

  logDa(siteId, da) {
    if (typeof da?.value === 'number') this.#append('da.ndjson', { t: da.checkedAt, site: siteId, da: da.value, spam: da.spamScore ?? null });
  }

  prune(validIds) {
    for (const id of Object.keys(this.sites)) if (!validIds.has(id)) delete this.sites[id];
  }

  // ---------------------------------------------------------------- reading old data

  /** Days that have a check log, oldest first. */
  logDays() {
    try {
      return fs.readdirSync(this.checksDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)).map((f) => f.slice(0, 10)).sort();
    } catch {
      return [];
    }
  }

  /** Stream check rows (oldest first) for a time range, optionally for one site. */
  async *readChecks({ from = 0, to = Date.now(), site = '' } = {}) {
    this.flushAppends();
    for (const d of this.logDays()) {
      if (d < day(from) || d > day(to)) continue;
      const rl = readline.createInterface({ input: fs.createReadStream(path.join(this.checksDir, `${d}.ndjson`)), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        if (row.t < from || row.t > to || (site && row.site !== site)) continue;
        yield row;
      }
    }
  }

  /** Stream every line of a permanent log (incidents / health / da), oldest first. */
  async *readLog(name) {
    this.flushAppends();
    const file = path.join(this.dir, name);
    if (!fs.existsSync(file)) return;
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      try { yield JSON.parse(line); } catch {}
    }
  }

  stats() {
    let bytes = 0, files = 0;
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else { bytes += fs.statSync(p).size; files++; }
      }
    };
    try { walk(this.dir); } catch {}
    const days = this.logDays();
    const firstDaily = Object.values(this.sites).map((s) => s.daily?.[0]?.d).filter(Boolean).sort()[0] || null;
    const countLines = (name) => {
      try { return fs.readFileSync(path.join(this.dir, name), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
    };
    return {
      dir: this.dir,
      writable: this.ok,
      bytes,
      files,
      retentionDays: this.retentionDays,
      logDays: days.length,
      oldestLog: days[0] || null,
      historySince: [firstDaily, days[0]].filter(Boolean).sort()[0] || null,
      incidents: countLines('incidents.ndjson'),
      healthRuns: countLines('health.ndjson'),
      daReadings: countLines('da.ndjson'),
    };
  }

  // ---------------------------------------------------------------- housekeeping

  /** Delete raw check logs older than the retention period (daily totals and events are kept forever). */
  pruneLogs() {
    if (!this.retentionDays) return;
    const cut = day(Date.now() - this.retentionDays * 86400000);
    for (const d of this.logDays()) {
      if (d >= cut) break;
      try { fs.unlinkSync(path.join(this.checksDir, `${d}.ndjson`)); } catch {}
    }
  }

  flush() {
    this.flushAppends();
    if (!this.dirty || !this.ok) return;
    this.dirty = false;
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 3, sites: this.sites }));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error(`[store] cannot save ${this.file}: ${err.message}`);
    }
  }

  flushAppends() {
    if (!this.buffer?.size) return;
    const pending = this.buffer;
    this.buffer = new Map();
    for (const [rel, lines] of pending) {
      try { fs.appendFileSync(path.join(this.dir, rel), lines.join('')); } catch (err) { console.error(`[store] cannot append ${rel}: ${err.message}`); }
    }
  }

  #append(rel, obj) {
    if (!this.ok) return;
    const list = this.buffer.get(rel) || [];
    list.push(JSON.stringify(obj) + '\n');
    this.buffer.set(rel, list);
  }

  #appendNow(rel, objs) {
    try { fs.appendFileSync(path.join(this.dir, rel), objs.map((o) => JSON.stringify(o) + '\n').join('')); } catch {}
  }

  #tailJson(file, n) {
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      return lines.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch {
      return [];
    }
  }

  #rebuildDaily(s) {
    const map = new Map();
    for (const b of s.hourly) {
      const d = day(b.h);
      const x = map.get(d) || { d, n: 0, ok: 0, ms: 0 };
      x.n += b.n; x.ok += b.ok; x.ms += b.ms;
      map.set(d, x);
    }
    s.daily = [...map.values()].sort((a, b) => a.d.localeCompare(b.d));
  }
}
