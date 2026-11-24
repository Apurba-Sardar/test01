// In-memory state with periodic persistence to data/state.json so history survives restarts.
import fs from 'node:fs';
import path from 'node:path';

const HISTORY_MS = 24 * 60 * 60 * 1000; // keep 24h of check results per site
const MAX_INCIDENTS = 300;

export class Store {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'state.json');
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (err) {
      console.error(`[store] cannot create ${dataDir}: ${err.message} — history will not be saved`);
    }
    this.sites = {}; // id -> runtime state
    this.incidents = []; // newest first
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.sites = raw.sites || {};
      this.incidents = raw.incidents || [];
    } catch {
      /* first run */
    }
    this.dirty = false;
    setInterval(() => this.flush(), 30_000).unref();
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
      };
    }
    return this.sites[id];
  }

  record(id, result) {
    const s = this.get(id);
    s.history.push({ t: result.t, ok: result.ok, ms: result.ms, slow: !!result.slow });
    const cutoff = Date.now() - HISTORY_MS;
    while (s.history.length && s.history[0].t < cutoff) s.history.shift();
    this.dirty = true;
  }

  addIncident(incident) {
    this.incidents.unshift(incident);
    if (this.incidents.length > MAX_INCIDENTS) this.incidents.length = MAX_INCIDENTS;
    this.dirty = true;
  }

  prune(validIds) {
    for (const id of Object.keys(this.sites)) if (!validIds.has(id)) delete this.sites[id];
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ sites: this.sites, incidents: this.incidents }));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error(`[store] cannot save ${this.file}: ${err.message}`);
    }
  }
}
