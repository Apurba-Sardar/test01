import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { Store } from './store.js';
import { Monitor } from './monitor.js';
import { sendMail, mailEnabled } from './mailer.js';
import * as auth from './auth.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
// Files anyone may load (the login page needs them).
const PUBLIC_FILES = new Set(['/login.html', '/login.js', '/style.css', '/favicon.svg']);

// The public IP this server uses for outgoing requests: the one to allow in Cloudflare.
let cachedIp = null;
async function outgoingIp(refresh = false) {
  if (cachedIp && !refresh) return cachedIp;
  for (const u of ['https://api.ipify.org', 'https://icanhazip.com']) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
      if (r.ok) return (cachedIp = (await r.text()).trim());
    } catch {}
  }
  return null;
}

const store = new Store(config.dataDir);
const monitor = new Monitor(store);
const clients = new Set();

const snapshot = () => ({
  ...monitor.snapshot(),
  meta: {
    appName: config.appName,
    version: VERSION,
    authEnabled: auth.authEnabled(),
    mailEnabled: mailEnabled(),
    recipients: config.smtp.to.length,
    realertMinutes: config.realertMinutes,
    healthIntervalHours: config.healthIntervalHours,
    cronEnabled: !!config.cronToken,
    sslWarnDays: config.sslWarnDays,
    healthRunning: !!monitor.healthRunning,
    mozEnabled: !!config.mozToken,
    outgoingIp: cachedIp,
  },
});

monitor.on('update', () => {
  const payload = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(payload);
});

const json = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};
const redirect = (res, to, headers = {}) => {
  res.writeHead(302, { location: to, 'cache-control': 'no-store', ...headers });
  res.end();
};
async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw new Error('body too large');
  }
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

function serveFile(res, rel) {
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': path.extname(file) === '.html' ? 'no-store' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      ...(path.extname(file) === '.html' ? { 'x-frame-options': 'DENY' } : {}),
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    if (p === '/healthz') return json(res, 200, { ok: true });

    // For an external scheduler (e.g. a Hostinger cron job). Protected by CRON_TOKEN, not the login.
    if (p === '/api/cron') {
      const token = url.searchParams.get('token') || req.headers['x-cron-token'];
      if (!config.cronToken || token !== config.cronToken) return json(res, 403, { error: 'bad or missing token' });
      await monitor.runAll();
      const sites = monitor.snapshot().sites;
      return json(res, 200, { checked: sites.length, down: sites.filter((s) => s.status === 'down').map((s) => s.name) });
    }

    // ---- login / logout ----
    if (p === '/login' || p === '/login.html') {
      if (auth.currentUser(req)) return redirect(res, '/');
      return serveFile(res, 'login.html');
    }
    if (req.method === 'POST' && p === '/api/login') {
      if (!auth.authEnabled()) return json(res, 200, { ok: true });
      const ip = auth.clientIp(req);
      const wait = auth.loginBlockedFor(ip);
      if (wait) return json(res, 429, { error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.` });
      const { username, password, remember } = await readJson(req);
      if (!auth.checkCredentials(String(username ?? ''), String(password ?? ''))) {
        auth.recordLoginFailure(ip);
        console.log(`[auth] failed login for "${String(username).slice(0, 40)}" from ${ip}`);
        return json(res, 401, { error: 'Incorrect username or password.' });
      }
      auth.clearLoginFailures(ip);
      return json(res, 200, { ok: true }, { 'set-cookie': auth.sessionCookie(req, username, !!remember) });
    }
    if (p === '/logout' || (req.method === 'POST' && p === '/api/logout')) {
      const cookie = { 'set-cookie': auth.clearCookie(req) };
      return p === '/logout' ? redirect(res, '/login', cookie) : json(res, 200, { ok: true }, cookie);
    }
    if (PUBLIC_FILES.has(p)) return serveFile(res, p.slice(1));

    // ---- everything below needs a signed-in user ----
    const user = auth.currentUser(req);
    if (!user) {
      if (p.startsWith('/api/')) return json(res, 401, { error: 'not signed in' });
      return redirect(res, '/login' + (p !== '/' ? `?next=${encodeURIComponent(p)}` : ''));
    }

    if (p === '/api/me') return json(res, 200, { user, authEnabled: auth.authEnabled() });
    if (p === '/api/status') return json(res, 200, snapshot());

    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`retry: 1000\ndata: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      // Hosts like Hostinger cut requests at 120 s; end the stream first, the browser reconnects in 1 s.
      const recycle = setTimeout(() => res.end(), 100_000);
      req.on('close', () => { clearInterval(ping); clearTimeout(recycle); clients.delete(res); });
      return;
    }

    if (req.method === 'POST' && p === '/api/check-all') {
      monitor.runAll(true);
      return json(res, 202, { started: true });
    }

    let m;
    if ((m = p.match(/^\/api\/sites\/([\w-]+)$/))) {
      const d = monitor.detail(m[1]);
      return d ? json(res, 200, d) : json(res, 404, { error: 'unknown site' });
    }
    if (req.method === 'POST' && ((m = p.match(/^\/api\/check\/([\w-]+)$/)) || (m = p.match(/^\/api\/sites\/([\w-]+)\/check$/)))) {
      const r = await monitor.checkOne(m[1]);
      return r ? json(res, 200, { ok: true }) : json(res, 404, { error: 'unknown site' });
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/sites\/([\w-]+)\/pause$/))) {
      const { paused } = await readJson(req);
      const r = await monitor.setPaused(m[1], !!paused);
      return r ? json(res, 200, { ok: true, paused: !!paused }) : json(res, 404, { error: 'unknown site' });
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/sites\/([\w-]+)\/health$/))) {
      const site = monitor.sites.find((s) => s.id === m[1]);
      if (!site) return json(res, 404, { error: 'unknown site' });
      return json(res, 200, await monitor.runHealth(site));
    }

    if (p === '/api/incidents') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 500, 500);
      return json(res, 200, { incidents: store.incidents.slice(0, limit), total: store.incidents.length });
    }
    if (req.method === 'POST' && p === '/api/health-all') {
      monitor.runHealthDue(true).catch((e) => console.error(`[health] ${e.message}`));
      return json(res, 202, { started: true });
    }

    if (p === '/api/outgoing-ip') return json(res, 200, { ip: await outgoingIp(true) });

    if (req.method === 'POST' && p === '/api/test-email') {
      const r = await sendMail('✅ Test email from your status monitor', [
        'Email alerts are configured correctly.',
        { label: 'Sites monitored', value: String(monitor.sites.length) },
        { label: 'Sent by', value: user },
      ]);
      return json(res, r.error ? 500 : 200, { ...r, mailEnabled: mailEnabled() });
    }

    if (p === '/' || p === '/index.html') return serveFile(res, 'index.html');
    return serveFile(res, p.slice(1));
  } catch (err) {
    console.error(`[http] ${req.method} ${p}: ${err.stack || err.message}`);
    if (!res.headersSent) json(res, 500, { error: 'internal error' });
  }
});

server.listen(config.port, () => {
  console.log(`Status dashboard on http://localhost:${config.port}`);
  console.log(`Email alerts: ${mailEnabled() ? 'enabled → ' + config.smtp.to.join(', ') : 'DISABLED (set SMTP_* and ALERT_EMAIL_TO)'}`);
  if (!config.dashboardUser) console.log('Warning: DASHBOARD_USER/DASHBOARD_PASS not set — dashboard is open to anyone who can reach it');
  if (!config.mozToken) console.log('Domain Authority: disabled (set MOZ_API_TOKEN to enable)');
  monitor.start();
  outgoingIp().then((ip) => console.log(`Outgoing IP (allow this in Cloudflare): ${ip ?? 'unknown'}`));
});

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => { store.dirty = true; store.flush(); process.exit(0); });
