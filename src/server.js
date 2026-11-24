import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { Store } from './store.js';
import { Monitor } from './monitor.js';
import { sendMail, mailEnabled } from './mailer.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const store = new Store(config.dataDir);
const monitor = new Monitor(store);
const clients = new Set();

monitor.on('update', () => {
  const payload = `data: ${JSON.stringify(monitor.snapshot())}\n\n`;
  for (const res of clients) res.write(payload);
});

function authorized(req) {
  if (!config.dashboardUser) return true;
  const [scheme, value] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !value) return false;
  const [u, ...p] = Buffer.from(value, 'base64').toString().split(':');
  return u === config.dashboardUser && p.join(':') === config.dashboardPass;
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/healthz') return json(res, 200, { ok: true });

  // For an external scheduler (e.g. a Hostinger cron job) — keeps checks running even if the
  // host pauses or restarts the app. Protected by CRON_TOKEN instead of the dashboard login.
  if (url.pathname === '/api/cron') {
    const token = url.searchParams.get('token') || req.headers['x-cron-token'];
    if (!config.cronToken || token !== config.cronToken) return json(res, 403, { error: 'bad or missing token' });
    await monitor.runAll();
    const sites = monitor.snapshot().sites;
    return json(res, 200, { checked: sites.length, down: sites.filter((s) => s.status === 'down').map((s) => s.name) });
  }

  if (!authorized(req)) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="Status"' });
    return res.end('Authentication required');
  }

  if (url.pathname === '/api/status') return json(res, 200, monitor.snapshot());

  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`retry: 1000\ndata: ${JSON.stringify(monitor.snapshot())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    // Hosts like Hostinger cut requests at 120 s; end the stream first, the browser reconnects in 1 s.
    const recycle = setTimeout(() => res.end(), 100_000);
    req.on('close', () => { clearInterval(ping); clearTimeout(recycle); clients.delete(res); });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/check-all') {
    monitor.runAll(true);
    return json(res, 202, { started: true });
  }

  const m = url.pathname.match(/^\/api\/check\/([\w-]+)$/);
  if (req.method === 'POST' && m) {
    const r = await monitor.checkOne(m[1]);
    return r ? json(res, 200, r) : json(res, 404, { error: 'unknown site' });
  }

  if (req.method === 'POST' && url.pathname === '/api/test-email') {
    const r = await sendMail('✅ Test email from your status monitor', [
      'Email alerts are configured correctly.',
      { label: 'Sites monitored', value: String(monitor.sites.length) },
    ]);
    return json(res, r.error ? 500 : 200, { ...r, mailEnabled: mailEnabled() });
  }

  // static files
  const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(config.port, () => {
  console.log(`Status dashboard on http://localhost:${config.port}`);
  console.log(`Email alerts: ${mailEnabled() ? 'enabled → ' + config.smtp.to.join(', ') : 'DISABLED (set SMTP_* and ALERT_EMAIL_TO)'}`);
  if (!config.dashboardUser) console.log('Warning: DASHBOARD_USER/DASHBOARD_PASS not set — dashboard is open to anyone who can reach it');
  monitor.start();
});

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => { store.dirty = true; store.flush(); process.exit(0); });
