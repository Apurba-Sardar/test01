/* TMJ Dashboard — office internal web-operations dashboard */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pref = {
  get(k, d) { try { return localStorage.getItem('tmj.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tmj.' + k, v); } catch {} },
};

// ---------------------------------------------------------------- constants
const TYPE_LABEL = { wordpress: 'WordPress', nextjs: 'Next.js' };
const STATUS_LABEL = { up: 'Operational', degraded: 'Slow', partial: 'Partial outage', down: 'Down', blocked: 'Blocked', pending: 'Checking', paused: 'Paused' };
const ORDER = { down: 0, partial: 1, blocked: 2, degraded: 3, pending: 4, up: 5, paused: 6 };
const EVENT_LABEL = { down: 'Down', up: 'Recovered', degraded: 'Slow', blocked: 'Blocked', paused: 'Paused', resumed: 'Resumed', 'check-fail': 'Check failed', 'check-pass': 'Check fixed' };
const CHECK_COLS = [
  ['https', 'HTTPS redirect'], ['ssl', 'SSL'], ['domain', 'Domain expiry'], ['robots', 'robots.txt'], ['sitemap', 'Sitemap'],
  ['index', 'Indexable'], ['meta', 'Title & meta'], ['assets', 'CSS / JS'], ['wpapi', 'WP REST API'], ['feed', 'RSS feed'],
  ['analytics', 'Analytics'], ['ads', 'Ad scripts'], ['adstxt', 'ads.txt'],
  ['mx', 'Email MX'], ['spf', 'SPF'], ['dmarc', 'DMARC'], ['dkim', 'DKIM'],
];
const CHECK_GROUPS = [
  ['Website', ['https', 'ssl', 'domain', 'assets', 'wpapi', 'feed']],
  ['SEO', ['robots', 'sitemap', 'index', 'meta']],
  ['Analytics & ads', ['analytics', 'ads', 'adstxt']],
  ['Domain email', ['mx', 'spf', 'dmarc', 'dkim']],
];
const AVATAR = ['#4f46e5', '#0891b2', '#db2777', '#ea580c', '#059669', '#7c3aed', '#ca8a04', '#2563eb'];
const svg = (d, extra = '') => `<svg class="i" viewBox="0 0 24 24" ${extra}>${d}</svg>`;
const I = {
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  alert: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
  q: svg('<path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>'),
  chev: svg('<path d="m9 18 6-6-6-6"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  ext: svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  pause: svg('<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'),
  play: svg('<path d="m6 3 14 9-14 9z"/>'),
  task: svg('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  globe: svg('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>'),
  pulse: svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  clock: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  lock: svg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  mail: svg('<path d="M4 4h16v16H4z"/><path d="m22 6-10 7L2 6"/>'),
  shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  trend: svg('<path d="m23 6-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>'),
  copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  plug: svg('<path d="M12 22v-5M9 8V2M15 8V2M18 8v4a6 6 0 0 1-12 0V8z"/>'),
  server: svg('<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
};

// ---------------------------------------------------------------- state
let data = null;          // live snapshot from /api/events
let me = { user: '—' };
let route = { name: 'overview' };
let view = null;          // current view object
let incidents = [];       // full incident history (Incidents view)

// ---------------------------------------------------------------- helpers
function ago(t) {
  if (!t) return '—';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function dur(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
const pct = (v, d = 2) => (v == null ? '—' : `${v >= 99.995 ? '100' : v.toFixed(d)}%`);
const fmtTime = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDate = (t) => new Date(t).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
const typeKey = (t) => (t === 'wordpress' || t === 'nextjs' ? t : 'other');
const statusOf = (s) => (s.paused ? 'paused' : s.status);
const isProblem = (s) => ['down', 'partial', 'blocked', 'degraded'].includes(statusOf(s)) || healthCounts(s).fail > 0;
function healthCounts(s) {
  const c = { pass: 0, warn: 0, fail: 0, unknown: 0 };
  for (const i of s.health?.items || []) c[i.status] = (c[i.status] || 0) + 1;
  return c;
}
const checkItem = (s, key) => (s.health?.items || []).find((i) => i.key === key);
function domainInfo(s) {
  const it = checkItem(s, 'domain');
  return it?.data ? { ...it.data, status: it.status } : null;
}
function initials(name) {
  const w = String(name).replace(/^the\s+/i, '').split(/[\s.\-_]+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w.length > 1 ? w[w.length - 1][0] : w[0]?.[1] || '')).toUpperCase();
}
function avatarColor(id) {
  // distinct color per website (by its position in the alphabetical list), hash as a fallback
  const ids = (data?.sites || []).map((s) => s.id).sort();
  const i = ids.indexOf(id);
  if (i >= 0) return AVATAR[i % AVATAR.length];
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}
const avatar = (s, cls = '') => `<span class="sq ${cls}" style="background:${avatarColor(s.id)}">${esc(initials(s.name))}</span>`;
const daysClass = (d, warn = 30, bad = 7) => (d == null ? '' : d <= bad ? 'bad' : d <= warn ? 'warn' : '');
const statusPill = (s) => `<span class="pill ${statusOf(s)}">${STATUS_LABEL[statusOf(s)]}</span>`;
const typeBadge = (t) => `<span class="badge ${typeKey(t)}">${esc(TYPE_LABEL[t] || t)}</span>`;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 3200);
}
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  if (r.status === 401) { location.href = '/login'; throw new Error('Signed out'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
async function busy(btn, fn, okMsg) {
  if (!btn) return fn();
  btn.disabled = true;
  btn.classList.add('busy');
  try { await fn(); if (okMsg) toast(okMsg); } catch (err) { toast(err.message); }
  btn.disabled = false;
  btn.classList.remove('busy');
}
function downloadCsv(name, rows) {
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- tooltip
const tip = $('#tip');
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.classList.add('show');
  const r = tip.getBoundingClientRect();
  let left = x + 14, top = y + 16;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > innerHeight - 8) top = y - r.height - 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}
const hideTip = () => tip.classList.remove('show');
document.addEventListener('mousemove', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (el) showTip(el.dataset.tip, e.clientX, e.clientY);
  else if (!e.target.closest?.('.chart')) hideTip();
});

// ---------------------------------------------------------------- shell: theme, sidebar, bell, search
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
const paintTheme = () => ($('#themeBtn').innerHTML = isDark() ? I.sun : I.moon);
$('#themeBtn').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
  paintTheme();
});
paintTheme();

const side = $('#side'), sideBg = $('#sideBg');
const closeSide = () => { side.classList.remove('open'); sideBg.classList.remove('open'); };
$('#menuBtn').addEventListener('click', () => { side.classList.add('open'); sideBg.classList.add('open'); });
sideBg.addEventListener('click', closeSide);
side.addEventListener('click', (e) => { if (e.target.closest('a')) closeSide(); });

$('#signout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login';
});
api('/api/me').then((m) => {
  me = m;
  $('#meName').textContent = m.user;
  $('#meAv').textContent = (m.user || '?').slice(0, 1);
  if (!m.authEnabled) $('#signout').hidden = true;
  if (view?.update && data) view.update();
}).catch(() => {});

async function checkAll(btn) {
  await busy(btn, () => api('/api/check-all', { method: 'POST' }), 'Checking all sites…');
}
$('#checkAllTop').addEventListener('click', (e) => checkAll(e.currentTarget));

// notifications bell
const bellPop = $('#bellPop');
function unseen() {
  const seen = Number(pref.get('seenAt', 0));
  return (data?.incidents || []).filter((i) => i.t > seen && ['down', 'check-fail', 'blocked'].includes(i.to));
}
function paintBell() {
  const n = unseen().length;
  $('#bellCount').hidden = !n;
  $('#bellCount').textContent = n > 9 ? '9+' : n;
  if (!bellPop.hidden) $('#bellList').innerHTML = (data?.incidents || []).slice(0, 10).map(feedItem).join('') || '<li><span class="d">No notifications yet.</span></li>';
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  $('#notifyPerm').textContent = perm === 'granted' ? 'Desktop alerts on' : perm === 'denied' ? 'Desktop alerts blocked' : perm === 'unsupported' ? '' : 'Enable desktop alerts';
}
$('#bellBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  bellPop.hidden = !bellPop.hidden;
  if (!bellPop.hidden) { pref.set('seenAt', Date.now()); paintBell(); }
});
$('#notifyPerm').addEventListener('click', async () => {
  if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  paintBell();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#bellPop') && !e.target.closest('#bellBtn')) bellPop.hidden = true;
  if (!e.target.closest('.gsearch')) $('#gresults').hidden = true;
});
$('#bellAll').addEventListener('click', () => (bellPop.hidden = true));

// global site search
const gs = $('#gsearch');
function paintResults() {
  const q = gs.value.trim().toLowerCase();
  const box = $('#gresults');
  if (!q || !data) { box.hidden = true; return; }
  const hits = data.sites.filter((s) => `${s.name} ${s.url} ${s.type}`.toLowerCase().includes(q)).slice(0, 8);
  box.innerHTML = hits.length
    ? hits.map((s, i) => `<a href="#/sites/${encodeURIComponent(s.id)}" class="${i === 0 ? 'on' : ''}">${avatar(s)}<span style="min-width:0;flex:1"><b style="display:block">${esc(s.name)}</b><span class="muted" style="font-size:12px">${esc(s.url.replace(/^https?:\/\//, ''))}</span></span>${statusPill(s)}</a>`).join('')
    : '<div class="none">No sites match “' + esc(q) + '”.</div>';
  box.hidden = false;
}
gs.addEventListener('input', paintResults);
gs.addEventListener('focus', paintResults);
gs.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const a = $('#gresults a'); if (a) { location.hash = a.getAttribute('href'); gs.value = ''; gs.blur(); $('#gresults').hidden = true; } }
  if (e.key === 'Escape') { gs.value = ''; gs.blur(); $('#gresults').hidden = true; }
});
$('#gresults').addEventListener('click', () => { gs.value = ''; $('#gresults').hidden = true; });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
    e.preventDefault();
    if (getComputedStyle($('.gsearch')).display !== 'none') gs.focus();
    else location.hash = '#/sites';
  }
});

function paintShell() {
  if (!data) return;
  const { sites, meta } = data;
  $$('.app-name').forEach((el) => (el.textContent = meta.appName));
  const active = sites.filter((s) => !s.paused);
  const issues = active.filter((s) => ['down', 'partial'].includes(s.status));
  const blocked = active.filter((s) => s.status === 'blocked');
  const hFail = active.reduce((n, s) => n + healthCounts(s).fail, 0);
  const expiring = sites.filter((s) => (s.ssl?.daysLeft ?? 999) <= (meta.sslWarnDays || 14) || (domainInfo(s)?.days ?? 999) <= 30).length;
  $('#nSites').textContent = sites.length;
  const setCnt = (el, n, cls) => { el.hidden = !n; el.textContent = n; el.className = 'cnt ' + (cls || ''); };
  setCnt($('#nInc'), issues.length, 'bad');
  setCnt($('#nHealth'), hFail, 'bad');
  setCnt($('#nDom'), expiring, 'warn');
  const label = issues.length ? `${issues.length} site${issues.length > 1 ? 's' : ''} need attention` : blocked.length ? `${blocked.length} blocked by Cloudflare` : 'All systems operational';
  $('#sideStatus').innerHTML = `<b><span class="dot ${issues.length ? 'down' : blocked.length ? 'warn' : 'up'}"></span>${label}</b>Last full check ${ago(data.lastRunAt)}`;
  document.title = issues.length ? `(${issues.length}) ${meta.appName}` : `${pageTitle()} · ${meta.appName}`;
  $('#year').textContent = new Date().getFullYear();
  $('#footInfo').innerHTML = `v${esc(meta.version)}<span class="sep">·</span>Checks every ${data.intervalSec}s<span class="sep">·</span>Outgoing IP ${esc(meta.outgoingIp || '—')}<span class="sep">·</span><a href="/healthz" target="_blank" rel="noopener">Health</a>`;
  paintBell();
  if (gs === document.activeElement) paintResults();
  notifyNewOutages(active.filter((s) => s.status === 'down'));
}
let lastDown = null;
function notifyNewOutages(down) {
  const now = new Set(down.map((s) => s.id));
  if (lastDown && 'Notification' in window && Notification.permission === 'granted')
    for (const s of down) if (!lastDown.has(s.id)) new Notification(`🔴 ${s.name} is down`, { body: s.error || s.url, icon: '/favicon.svg' });
  lastDown = now;
}
setInterval(() => {
  if (!data) return;
  const el = $('#nextCheck');
  if (data.checking) el.textContent = '· checking…';
  else if (data.nextRunAt) {
    const s = Math.max(0, Math.round((data.nextRunAt - Date.now()) / 1000));
    el.textContent = s ? `· next check ${s}s` : '· checking…';
  }
}, 1000);

// shared fragments
function feedItem(i) {
  const icon = { down: I.x, up: I.check, 'check-fail': I.alert, 'check-pass': I.check, blocked: I.shield, degraded: I.clock, paused: I.pause, resumed: I.play }[i.to] || I.info;
  return `<li><span class="f-ic ${esc(i.to)}">${icon}</span><div style="min-width:0"><b>${esc(i.name)}</b> <span class="tag ${esc(i.to)}">${EVENT_LABEL[i.to] || esc(i.to)}</span><span class="d">${esc(i.detail)}</span></div><time title="${esc(fmtTime(i.t))}">${ago(i.t)}</time></li>`;
}
function minibars(s) {
  const hist = s.history || [];
  return `<div class="minibars">${'<i class="e"></i>'.repeat(Math.max(0, 40 - Math.min(40, hist.length)))}${hist.slice(-40).map((h) => {
    const cls = h.ok === null ? 'b' : h.ok ? (h.slow ? 's' : '') : 'f';
    return `<i class="${cls}" data-tip="${esc(`<b>${esc(fmtTime(h.t))}</b><br>${h.ok === null ? 'Blocked by Cloudflare' : h.ok ? `${h.ms} ms${h.slow ? ' (slow)' : ''}` : 'Failed'}`)}"></i>`;
  }).join('')}</div>`;
}
function healthCell(s) {
  if (!s.health) return '<span class="muted">Pending</span>';
  const c = healthCounts(s);
  return `<span class="hc" data-tip="${esc(`<b>Health & SEO</b><br>${c.pass} passed · ${c.warn} warnings · ${c.fail} failed${c.unknown ? ` · ${c.unknown} unknown` : ''}`)}"><span><span class="dot up"></span>${c.pass}</span>${c.warn ? `<span><span class="dot warn"></span>${c.warn}</span>` : ''}${c.fail ? `<span><span class="dot down"></span>${c.fail}</span>` : ''}</span>`;
}
function pageChips(s) {
  return (s.pages || []).map((p) => {
    const st = p.status === 'up' ? 'up' : p.status === 'down' ? 'down' : p.status === 'blocked' ? 'warn' : p.status === 'paused' ? 'paused' : '';
    const t = `<b>${esc(p.name)}</b><br>${esc(p.url || 'not found yet')}<br>${p.status === 'up' ? `${p.ms} ms · HTTP ${p.code}` : esc(p.error || STATUS_LABEL[p.status] || p.status)}`;
    return `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:10px;white-space:nowrap;font-size:12.5px" data-tip="${esc(t)}"><span class="dot ${st}"></span>${esc(p.name.replace(' page', ''))}</span>`;
  }).join('');
}

// ---------------------------------------------------------------- router
const VIEWS = {};
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'sites' && b) return { name: 'site', id: decodeURIComponent(b) };
  return { name: ['sites', 'incidents', 'health', 'domains', 'reports', 'settings'].includes(a) ? a : 'overview' };
}
function pageTitle() {
  if (route.name === 'site') return data?.sites.find((s) => s.id === route.id)?.name || 'Site';
  return { overview: 'Overview', sites: 'Sites', incidents: 'Incidents', health: 'Health & SEO', domains: 'Domains & SSL', reports: 'Reports & history', settings: 'Settings & alerts' }[route.name];
}
function go() {
  route = parseRoute();
  view = VIEWS[route.name];
  $$('.nav a[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (route.name === 'site' ? 'sites' : route.name)));
  $('#pageTitle').textContent = pageTitle();
  $('#pageSub').textContent = route.name === 'site' ? 'Sites / Record' : view.sub;
  hideTip();
  $('#view').innerHTML = view.mount();
  view.bind?.();
  if (data) view.update();
  scrollTo(0, 0);
}
addEventListener('hashchange', go);

// =================================================================== OVERVIEW
VIEWS.overview = {
  sub: 'Web operations at a glance',
  mount() {
    const h = new Date().getHours();
    const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    return `
      <div class="page-head">
        <div><h2>${hello}, <span id="ovName">${esc(me.user)}</span> 👋</h2><p>Here’s what’s happening across TMJ websites today · ${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p></div>
        <div class="acts"><button class="btn" id="ovHealth">${I.task}Run health checks</button><a class="btn primary" href="#/sites">${I.globe}All sites</a></div>
      </div>
      <div id="ovBanner"></div>
      <div class="kpis" id="ovKpis"></div>
      <div class="grid g-2-1">
        <section class="card"><div class="card-h"><h3>Sites at a glance</h3><a class="link-more" href="#/sites">View all ${I.chev}</a></div><div class="card-b flush tbl-wrap" id="ovSites"></div></section>
        <section class="card"><div class="card-h"><h3>Needs attention</h3><span class="sub" id="ovAttnN"></span></div><ul class="attn" id="ovAttn"></ul></section>
      </div>
      <div class="grid g-3">
        <section class="card"><div class="card-h"><h3>Response time by site</h3><span class="sub">avg · 24h</span></div><div class="card-b"><div class="hbars" id="ovResp"></div></div></section>
        <section class="card"><div class="card-h"><h3>Status &amp; platforms</h3><span class="sub">now</span></div><div class="card-b" id="ovStatus"></div></section>
        <section class="card"><div class="card-h"><h3>Upcoming renewals</h3><a class="link-more" href="#/domains">Details ${I.chev}</a></div><ul class="renew" id="ovRenew"></ul></section>
      </div>
      <section class="card"><div class="card-h"><h3>Live activity</h3><a class="link-more" href="#/incidents">All incidents ${I.chev}</a></div><ul class="feed" id="ovFeed"></ul></section>`;
  },
  bind() {
    $('#ovHealth').onclick = (e) => busy(e.currentTarget, () => api('/api/health-all', { method: 'POST' }), 'Health checks started — results appear in a minute');
  },
  update() {
    const { sites, meta } = data;
    $('#ovName').textContent = me.user;
    const active = sites.filter((s) => !s.paused);
    const down = active.filter((s) => s.status === 'down');
    const partial = active.filter((s) => s.status === 'partial');
    const blocked = active.filter((s) => s.status === 'blocked');
    const slow = active.filter((s) => s.status === 'degraded');
    const up = active.filter((s) => ['up', 'degraded', 'partial'].includes(s.status));
    const paused = sites.filter((s) => s.paused);
    const count = (t) => sites.filter((s) => typeKey(s.type) === t).length;

    // banner
    const bad = down.length + partial.length;
    $('#ovBanner').innerHTML = bad
      ? `<div class="banner bad"><span class="b-ic">${I.x}</span><div><b>${bad} site${bad > 1 ? 's' : ''} need${bad > 1 ? '' : 's'} attention</b><span>${[...down, ...partial].map((s) => esc(s.name) + (s.status === 'partial' ? ' (' + esc((s.error || '').split(':')[0]) + ')' : '')).join(' · ')}</span></div></div>`
      : blocked.length
      ? `<div class="banner warn"><span class="b-ic">${I.shield}</span><div><b>${up.length} up · ${blocked.length} can’t be checked</b><span>Cloudflare is blocking the monitor on ${blocked.map((s) => esc(s.name)).join(', ')}. Allow IP <b style="display:inline">${esc(meta.outgoingIp || '—')}</b> in Cloudflare.</span></div></div>`
      : `<div class="banner ok"><span class="b-ic">${I.check}</span><div><b>All systems operational</b><span>${active.length} websites checked every ${data.intervalSec}s${paused.length ? ` · ${paused.length} paused` : ''}</span></div></div>`;

    // KPIs
    const ups = active.map((s) => s.uptime30d ?? s.uptime24h).filter((v) => v != null);
    const up30 = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null;
    const times = active.map((s) => s.avgResponse24h ?? s.responseTime).filter((v) => v != null);
    const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
    const das = sites.map((s) => s.da?.value).filter((v) => typeof v === 'number');
    const since = Date.now() - 86400000;
    const outages24 = data.incidents.filter((i) => i.to === 'down' && i.t > since).length;
    const kpi = (label, value, sub, icon, tone = '') => `<div class="kpi"><div class="kpi-top"><span>${label}</span><span class="kpi-ic ${tone}">${icon}</span></div><div class="kpi-v">${value}</div><div class="kpi-s">${sub}</div></div>`;
    $('#ovKpis').innerHTML =
      kpi('Total websites', sites.length, `${count('wordpress')} WordPress · ${count('nextjs')} Next.js`, I.globe) +
      kpi('Operational', up.length, slow.length ? `<span class="warn">${slow.length} slow</span>` : `<span class="good">of ${active.length} active</span>`, I.check, 'g') +
      kpi('Issues', bad, bad ? '<span class="bad">needs attention</span>' : blocked.length ? `<span class="warn">${blocked.length} blocked</span>` : 'none right now', I.alert, bad ? 'r' : blocked.length ? 'y' : '') +
      kpi('Avg response', avg == null ? '—' : `${avg}<small> ms</small>`, 'last 24 hours', I.clock) +
      kpi('Uptime', pct(up30), `${outages24} outage${outages24 === 1 ? '' : 's'} in 24h`, I.trend, 'g') +
      kpi('Avg Domain Authority', das.length ? Math.round(das.reduce((a, b) => a + b, 0) / das.length) : '—', das.length ? `Moz · ${das.length} sites` : '<a href="#/settings">Connect Moz</a>', I.shield);

    // sites at a glance
    const sorted = [...sites].sort((a, b) => ORDER[statusOf(a)] - ORDER[statusOf(b)] || a.name.localeCompare(b.name));
    $('#ovSites').innerHTML = `<table class="tbl"><thead><tr><th>Website</th><th>Status</th><th class="r hide-sm">Response</th><th class="r hide-sm">Uptime 24h</th><th class="r hide-sm">DA</th><th></th></tr></thead><tbody>${sorted.slice(0, 8).map((s) => `
      <tr class="click ${s.status === 'down' ? 'is-down' : ''}" data-href="#/sites/${encodeURIComponent(s.id)}">
        <td><div class="ent">${avatar(s)}<div><b>${esc(s.name)}</b><span class="u">${typeKey(s.type) === 'other' ? esc(s.type) : TYPE_LABEL[s.type]} · ${esc(s.url.replace(/^https?:\/\/(www\.)?/, ''))}</span></div></div></td>
        <td>${statusPill(s)}</td>
        <td class="r num hide-sm">${s.responseTime != null && !s.paused ? s.responseTime + ' ms' : '—'}</td>
        <td class="r num hide-sm">${pct(s.uptime24h)}</td>
        <td class="r num hide-sm">${typeof s.da?.value === 'number' ? s.da.value : '—'}</td>
        <td class="r muted">${I.chev}</td></tr>`).join('')}</tbody></table>`;

    // needs attention
    const items = [];
    for (const s of down) items.push(['r', I.x, `${s.name} is down`, `${s.error || ''} · ${dur(Date.now() - (s.downSince || Date.now()))}`, s.id]);
    for (const s of partial) items.push(['r', I.alert, `${s.name}: page broken`, s.error, s.id]);
    for (const s of active) for (const i of s.health?.items || []) if (i.status === 'fail') items.push(['r', I.task, `${s.name}: ${i.name}`, i.detail, s.id]);
    for (const s of blocked) items.push(['y', I.shield, `${s.name} blocked by Cloudflare`, `Allow ${meta.outgoingIp || 'the monitor IP'} in Cloudflare → Security → WAF`, s.id]);
    for (const s of slow) items.push(['y', I.clock, `${s.name} is slow`, `${s.responseTime} ms response`, s.id]);
    for (const s of sites) if (s.ssl?.daysLeft != null && s.ssl.daysLeft <= (meta.sslWarnDays || 14)) items.push(['y', I.lock, `${s.name}: SSL expires in ${s.ssl.daysLeft} days`, fmtDate(s.ssl.validTo), s.id]);
    for (const s of sites) { const d = domainInfo(s); if (d && d.days <= 30) items.push(['y', I.globe, `${d.domain} expires in ${d.days} days`, 'Renew the domain', s.id]); }
    const ml = meta.mail || {};
    if (!meta.mailEnabled) items.push(['b', I.mail, 'Email alerts are off', 'Set the SMTP_* variables in Hostinger', null, '#/settings']);
    else if (ml.verified === false) items.unshift(['r', I.mail, 'Alert emails can’t be sent', `Gmail login failed: ${ml.verifyError}`, null, '#/settings']);
    else if (ml.last && !ml.last.ok) items.unshift(['r', I.mail, 'Last alert email failed', `${ml.last.error} · ${ago(ml.last.t)}`, null, '#/settings']);
    if (!meta.mozEnabled) items.push(['b', I.plug, 'Domain Authority not connected', 'Add MOZ_API_TOKEN to show DA scores', null, '#/settings']);
    $('#ovAttnN').textContent = items.length ? `${items.length} item${items.length > 1 ? 's' : ''}` : '';
    $('#ovAttn').innerHTML = items.length
      ? items.slice(0, 7).map(([tone, ic, title, sub, id, href]) => `<li class="click" style="cursor:pointer" data-href="${href || '#/sites/' + encodeURIComponent(id)}"><span class="a-ic ${tone}">${ic}</span><div style="min-width:0"><b>${esc(title)}</b><span>${esc(sub)}</span></div></li>`).join('') + (items.length > 7 ? `<li><span class="a-ic b">${I.info}</span><div><b>+${items.length - 7} more</b><span>See Health &amp; SEO and Domains</span></div></li>` : '')
      : `<li><span class="a-ic g">${I.check}</span><div><b>Nothing needs attention</b><span>All sites, pages and checks look good.</span></div></li>`;

    // response time by site
    const rows = active.map((s) => ({ s, v: s.avgResponse24h ?? s.responseTime })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
    const max = Math.max(...rows.map((r) => r.v), 1);
    $('#ovResp').innerHTML = rows.length
      ? rows.map(({ s, v }) => `<div class="hbar" data-tip="${esc(`<b>${esc(s.name)}</b><br>Avg ${v} ms · now ${s.responseTime ?? '—'} ms`)}"><span class="n">${esc(s.name)}</span><span class="t"><i class="${v > data.slowThresholdMs ? 'slow' : ''}" style="width:${Math.max(3, (v / max) * 100)}%"></i></span><span class="v">${v} ms</span></div>`).join('')
      : '<p class="muted" style="margin:0">No data yet.</p>';

    // status & platforms
    const seg = [
      ['Operational', active.filter((s) => s.status === 'up').length, 'var(--up-bar)'],
      ['Slow', slow.length, 'var(--warn)'],
      ['Down / partial', bad, 'var(--down)'],
      ['Blocked', blocked.length, 'color-mix(in srgb, var(--warn) 45%, var(--panel))'],
      ['Paused / checking', paused.length + active.filter((s) => s.status === 'pending').length, 'var(--pending)'],
    ];
    $('#ovStatus').innerHTML = `<div class="stack">${seg.filter((x) => x[1]).map(([l, n, c]) => `<i style="flex:${n};background:${c}" data-tip="${esc(`<b>${l}</b><br>${n} site${n === 1 ? '' : 's'}`)}"></i>`).join('')}</div>
      <div class="legend">${seg.map(([l, n, c]) => `<div><i style="background:${c}"></i>${l}<b>${n}</b></div>`).join('')}</div>
      <div class="split"><div><b>${count('wordpress')}</b><span>WordPress sites</span></div><div><b>${count('nextjs')}</b><span>Next.js sites</span></div></div>`;

    // renewals
    const ren = [];
    for (const s of sites) {
      if (s.ssl?.daysLeft != null) ren.push({ s, what: 'SSL certificate', days: s.ssl.daysLeft, date: s.ssl.validTo, warn: meta.sslWarnDays || 14 });
      const d = domainInfo(s);
      if (d) ren.push({ s, what: `Domain ${d.domain}`, days: d.days, date: d.expires, warn: 30 });
    }
    ren.sort((a, b) => a.days - b.days);
    $('#ovRenew').innerHTML = ren.length
      ? ren.slice(0, 6).map((r) => `<li><div><b>${esc(r.s.name)}</b><span style="display:block">${esc(r.what)} · ${esc(fmtDate(r.date))}</span></div><span class="days ${daysClass(r.days, r.warn)}">${r.days} days</span></li>`).join('')
      : '<li><span class="muted">Available after the first health checks.</span></li>';

    // activity
    $('#ovFeed').innerHTML = data.incidents.slice(0, 8).map(feedItem).join('') || '<li><span class="d">No activity yet.</span></li>';
  },
};

// =================================================================== SITES
const siteState = { filter: pref.get('filter', 'all'), sort: pref.get('sort', 'status'), q: '' };
VIEWS.sites = {
  sub: 'All monitored websites',
  mount() {
    return `
      <div class="page-head">
        <div><h2>Websites</h2><p id="sitesSub">Every TMJ website, its pages and its health.</p></div>
        <div class="acts"><button class="btn" id="sitesCsv">${I.download}Export CSV</button><button class="btn primary" id="sitesCheck">${I.refresh}Check all now</button></div>
      </div>
      <section class="card">
        <div class="card-h">
          <div class="tabs" id="sitesTabs">
            ${['all', 'wordpress', 'nextjs', 'other', 'problems'].map((f) => `<button data-f="${f}">${{ all: 'All', wordpress: 'WordPress', nextjs: 'Next.js', other: 'Other', problems: 'Problems' }[f]}<span class="count"></span></button>`).join('')}
          </div>
          <div class="toolbar">
            <select class="field-s" id="sitesSort" aria-label="Sort">
              <option value="status">Sort: Status</option><option value="name">Sort: Name</option><option value="response">Sort: Response time</option>
              <option value="uptime">Sort: Uptime</option><option value="da">Sort: Domain Authority</option><option value="ssl">Sort: SSL expiry</option>
            </select>
            <input class="field-s" id="sitesQ" type="search" placeholder="Filter websites…" aria-label="Filter websites" value="${esc(siteState.q)}" />
          </div>
        </div>
        <div class="card-b flush tbl-wrap" id="sitesTbl"></div>
      </section>`;
  },
  bind() {
    $('#sitesSort').value = siteState.sort;
    $('#sitesTabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; siteState.filter = b.dataset.f; pref.set('filter', siteState.filter); this.update(); };
    $('#sitesSort').onchange = (e) => { siteState.sort = e.target.value; pref.set('sort', siteState.sort); this.update(); };
    $('#sitesQ').oninput = (e) => { siteState.q = e.target.value; this.update(); };
    $('#sitesCheck').onclick = (e) => checkAll(e.currentTarget);
    $('#sitesCsv').onclick = () => downloadCsv(`tmj-sites-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Name', 'URL', 'Platform', 'Status', 'Response ms', 'Avg 24h ms', 'Uptime 24h %', 'Uptime 30d %', 'DA', 'SSL days', 'Domain expires', 'Health pass', 'Health warn', 'Health fail', 'Article URL'],
      ...data.sites.map((s) => { const c = healthCounts(s), d = domainInfo(s); return [s.name, s.url, TYPE_LABEL[s.type] || s.type, STATUS_LABEL[statusOf(s)], s.responseTime, s.avgResponse24h, s.uptime24h?.toFixed(2), s.uptime30d?.toFixed(2), s.da?.value, s.ssl?.daysLeft, d?.expires?.slice(0, 10), c.pass, c.warn, c.fail, s.pages?.find((p) => p.key === 'article')?.url]; }),
    ]);
  },
  update() {
    const { sites } = data;
    const fc = { all: sites.length, wordpress: 0, nextjs: 0, other: 0, problems: sites.filter(isProblem).length };
    sites.forEach((s) => fc[typeKey(s.type)]++);
    $$('#sitesTabs button').forEach((b) => { b.classList.toggle('on', b.dataset.f === siteState.filter); b.querySelector('.count').textContent = fc[b.dataset.f]; b.hidden = b.dataset.f === 'other' && !fc.other; });
    $('#sitesSub').textContent = `${sites.length} websites · ${fc.wordpress} WordPress · ${fc.nextjs} Next.js${fc.problems ? ` · ${fc.problems} with problems` : ''}`;
    const by = {
      status: (a, b) => ORDER[statusOf(a)] - ORDER[statusOf(b)] || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      response: (a, b) => (b.responseTime ?? -1) - (a.responseTime ?? -1),
      uptime: (a, b) => (a.uptime24h ?? 101) - (b.uptime24h ?? 101),
      da: (a, b) => (b.da?.value ?? -1) - (a.da?.value ?? -1),
      ssl: (a, b) => (a.ssl?.daysLeft ?? 9999) - (b.ssl?.daysLeft ?? 9999),
    }[siteState.sort];
    const q = siteState.q.toLowerCase();
    const shown = sites
      .filter((s) => siteState.filter === 'all' || (siteState.filter === 'problems' ? isProblem(s) : typeKey(s.type) === siteState.filter))
      .filter((s) => !q || `${s.name} ${s.url} ${s.type} ${s.group}`.toLowerCase().includes(q))
      .sort(by);
    $('#sitesTbl').innerHTML = shown.length ? `<table class="tbl"><thead><tr>
        <th>Website</th><th>Platform</th><th>Status &amp; pages</th><th class="hide-md">Recent checks</th>
        <th class="r">Response</th><th class="r">Uptime</th><th class="r">DA</th><th class="r hide-md">SSL</th><th class="hide-md">Health</th><th></th></tr></thead><tbody>
      ${shown.map((s) => {
        const sub = s.paused ? '<span class="err warn">Paused for maintenance</span>'
          : ['down', 'partial'].includes(s.status) ? `<span class="err" title="${esc(s.error)}">${esc(s.error)}</span>`
          : s.status === 'blocked' ? '<span class="err warn">Blocked by Cloudflare</span>' : '';
        return `<tr class="click ${s.status === 'down' ? 'is-down' : ''}" data-href="#/sites/${encodeURIComponent(s.id)}">
          <td><div class="ent">${avatar(s)}<div style="min-width:0"><b>${esc(s.name)}</b><span class="u">${esc(s.url.replace(/^https?:\/\//, ''))}</span></div></div></td>
          <td>${typeBadge(s.type)}</td>
          <td>${statusPill(s)}${sub}<div style="margin-top:5px">${pageChips(s)}</div></td>
          <td class="hide-md">${minibars(s)}</td>
          <td class="r num">${s.responseTime != null && !s.paused ? s.responseTime + ' ms' : '—'}<span class="sub">${ago(s.lastCheck)}</span></td>
          <td class="r num" style="white-space:nowrap">${pct(s.uptime24h)}<span class="sub">30d ${pct(s.uptime30d)}</span></td>
          <td class="r num"><b>${typeof s.da?.value === 'number' ? s.da.value : '<span class="muted">—</span>'}</b></td>
          <td class="r num hide-md">${s.ssl?.daysLeft != null ? `<span class="days ${daysClass(s.ssl.daysLeft, data.meta.sslWarnDays || 14, 3)}">${s.ssl.daysLeft}d</span>` : '—'}</td>
          <td class="hide-md">${healthCell(s)}</td>
          <td class="r muted">${I.chev}</td></tr>`;
      }).join('')}</tbody></table>` : `<div class="empty">${sites.length ? 'No websites match this filter.' : 'No websites configured yet — add them to sites.json.'}</div>`;
  },
};

// =================================================================== SITE RECORD
let detail = null, recTab = 'overview', detailTimer = null;
VIEWS.site = {
  sub: '',
  mount() {
    detail = null;
    recTab = 'overview';
    return `<a class="back" href="#/sites">${I.back}All websites</a><div id="rec"><div class="card"><div class="rec"><h2>Loading…</h2></div></div></div>`;
  },
  update() {
    clearTimeout(detailTimer);
    detailTimer = setTimeout(loadDetail, detail ? 400 : 0);
  },
};
async function loadDetail() {
  if (route.name !== 'site') return;
  try {
    detail = await api(`/api/sites/${encodeURIComponent(route.id)}`);
    $('#pageTitle').textContent = detail.name;
    renderRecord();
  } catch (err) {
    $('#rec').innerHTML = `<div class="card"><div class="empty">Could not load this website: ${esc(err.message)}</div></div>`;
  }
}
function renderRecord() {
  const s = detail;
  if (!s || !$('#rec')) return;
  const st = statusOf(s), c = healthCounts(s), d = domainInfo(s);
  const stat = (k, v, sub = '') => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  $('#rec').innerHTML = `
    <section class="card" style="margin-bottom:18px">
      <div class="rec">
        ${avatar(s, 'lg')}
        <div style="min-width:0">
          <h2>${esc(s.name)} ${statusPill(s)}</h2>
          <div class="meta"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>${typeBadge(s.type)}${s.group ? `<span class="badge">${esc(s.group)}</span>` : ''}<span>Last checked ${ago(s.lastCheck)}</span></div>
        </div>
        <div class="acts">
          <button class="btn primary" id="rCheck" ${s.paused ? 'disabled' : ''}>${I.refresh}Check now</button>
          <button class="btn" id="rHealth" ${s.paused ? 'disabled' : ''}>${I.task}Run health checks</button>
          <button class="btn ${s.paused ? '' : 'danger'}" id="rPause">${s.paused ? I.play + 'Resume' : I.pause + 'Pause'}</button>
          <a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener">${I.ext}Visit</a>
        </div>
      </div>
      <div class="rec-tabs" id="recTabs">
        <button data-t="overview">Overview</button>
        <button data-t="health">Health &amp; SEO<span class="count">${s.health ? `${c.pass}/${s.health.items.length}` : '—'}</span></button>
        <button data-t="activity">Activity<span class="count">${(s.incidents || []).length}</span></button>
        <button data-t="config">Configuration</button>
      </div>
    </section>
    ${['down', 'partial'].includes(s.status) && !s.paused ? `<div class="alert-card"><b>${s.status === 'down' ? 'This website is down' : 'A page on this website is broken'}</b><div>${esc(s.error)}</div>${s.downSince ? `<div class="muted">Since ${esc(fmtTime(s.downSince))} · ${dur(Date.now() - s.downSince)}</div>` : ''}</div>` : ''}
    <div id="recBody"></div>`;
  $$('#recTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === recTab));
  $('#recTabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; recTab = b.dataset.t; renderRecord(); };
  $('#rCheck').onclick = (e) => busy(e.currentTarget, () => api(`/api/sites/${s.id}/check`, { method: 'POST' }).then(loadDetail), 'Checked ✔');
  $('#rHealth').onclick = (e) => busy(e.currentTarget, () => api(`/api/sites/${s.id}/health`, { method: 'POST' }).then(loadDetail), 'Health checks finished');
  $('#rPause').onclick = (e) => {
    if (!s.paused && !confirm(`Pause monitoring for ${s.name}?\n\nNo checks run and no alerts are sent until you resume.`)) return;
    busy(e.currentTarget, () => api(`/api/sites/${s.id}/pause`, { method: 'POST', body: JSON.stringify({ paused: !s.paused }) }).then(loadDetail), s.paused ? 'Monitoring resumed' : 'Monitoring paused');
  };

  const body = $('#recBody');
  if (recTab === 'overview') {
    body.innerHTML = `
      <section class="card" style="margin-bottom:18px"><div class="stats">
        ${stat('Response', s.responseTime != null ? `${s.responseTime}<small> ms</small>` : '—', s.statusCode ? `HTTP ${s.statusCode}` : '')}
        ${stat('Avg 24h', s.avgResponse24h != null ? `${s.avgResponse24h}<small> ms</small>` : '—', 'successful checks')}
        ${stat('Uptime 24h', pct(s.uptime24h), `7 days ${pct(s.uptime7d)}`)}
        ${stat('Uptime 30d', pct(s.uptime30d), `${(s.hourly || []).reduce((n, b) => n + b.n, 0)} checks`)}
        ${stat('SSL certificate', s.ssl?.daysLeft != null ? `${s.ssl.daysLeft}<small> days</small>` : '—', s.ssl?.validTo ? `until ${fmtDate(s.ssl.validTo)}` : esc(s.ssl?.error || ''))}
        ${stat('Domain', d ? `${d.days}<small> days</small>` : '—', d ? `renews by ${fmtDate(d.expires)}` : 'after health checks')}
        ${stat('Domain Authority', typeof s.da?.value === 'number' ? s.da.value : '—', typeof s.da?.value === 'number' ? `${s.da.spamScore != null ? `Spam ${s.da.spamScore}% · ` : ''}${s.da.prev != null && s.da.prev !== s.da.value ? `was ${s.da.prev}` : ago(s.da.checkedAt)}` : esc(s.da?.error || 'not checked'))}
        ${stat('Health & SEO', s.health ? `${c.pass}/${s.health.items.length}` : '—', s.health ? `${c.fail} failed · ${c.warn} warnings` : 'running soon')}
      </div></section>
      <div class="grid g-2-1">
        <section class="card"><div class="card-h"><h3 id="rtTitle">Response time</h3><span class="legend-inline"><span><i style="background:var(--chart-line)"></i>Homepage</span><span><i style="background:var(--down);border-radius:50%"></i>Failed check</span></span></div><div class="card-b"><div class="chart" id="rtChart"></div></div></section>
        <section class="card"><div class="card-h"><h3>Pages monitored</h3><span class="sub">every ${data?.intervalSec || 60}s</span></div><ul class="attn">${(s.pages || []).map((p) => `
          <li><span class="a-ic ${p.status === 'up' ? 'g' : p.status === 'down' ? 'r' : 'y'}">${p.status === 'up' ? I.check : p.status === 'down' ? I.x : I.q}</span>
            <div style="min-width:0"><b>${esc(p.name)} <span class="muted" style="font-weight:500">${p.ms != null ? `· ${p.ms} ms` : ''}${p.code ? ` · HTTP ${p.code}` : ''}</span></b>
            <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url.replace(/^https?:\/\//, ''))}</a>` : 'Not found yet'}</span>
            ${p.status !== 'up' && p.error ? `<span style="display:block;color:${p.status === 'down' ? 'var(--down)' : 'var(--warn)'}">${esc(p.error)}</span>` : ''}</div></li>`).join('')}</ul></section>
      </div>
      <section class="card"><div class="card-h"><h3>Uptime · last 30 days</h3><span class="legend-inline"><span><i style="background:var(--up-bar)"></i>≥ 99.9%</span><span><i style="background:var(--warn)"></i>≥ 99%</span><span><i style="background:var(--down)"></i>&lt; 99%</span><span><i style="background:var(--border)"></i>No data</span></span></div>
        <div class="card-b"><div class="strip" id="strip"></div><div class="strip-legend"><span>30 days ago</span><span>${pct(s.uptime30d)} overall</span><span>Today</span></div></div></section>
      ${trackingCard(s)}`;
    drawChart(s);
    drawStrip(s);
  } else if (recTab === 'health') {
    body.innerHTML = `<section class="card"><div class="card-h"><h3>Health &amp; SEO checks</h3><span class="sub">${s.health ? `Last run ${ago(s.health.checkedAt)} · every ${data.meta.healthIntervalHours}h` : 'Not run yet'}</span></div>
      ${s.health ? CHECK_GROUPS.map(([g, keys]) => {
          const list = s.health.items.filter((i) => keys.includes(i.key));
          return list.length ? `<div class="grp-h">${g}</div><ul class="checks">${list.map((i) => `<li><span class="hic ${i.status}">${{ pass: I.check, warn: I.alert, fail: I.x, unknown: I.q }[i.status]}</span><span class="cn">${esc(i.name.replace(/^Email: /, ''))}</span><span class="cd">${esc(i.detail)}</span></li>`).join('')}</ul>` : '';
        }).join('')
        : '<div class="empty">Health checks run shortly after startup and then every hour. Click “Run health checks” to run them now.</div>'}</section>`;
  } else if (recTab === 'activity') {
    body.innerHTML = `<section class="card"><div class="card-h"><h3>Activity</h3><span class="sub">outages, recoveries, health changes</span></div><ul class="feed">${(s.incidents || []).length ? s.incidents.map(feedItem).join('') : '<li><span class="d">No activity yet.</span></li>'}</ul></section>`;
  } else {
    const art = s.pages?.find((p) => p.key === 'article');
    body.innerHTML = `<section class="card"><div class="card-h"><h3>Configuration</h3><span class="sub">from sites.json</span></div><div class="kv">
      <div class="k">Website ID</div><div><span class="code">${esc(s.id)}</span></div>
      <div class="k">Homepage URL</div><div><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a></div>
      <div class="k">Platform</div><div>${typeBadge(s.type)}</div>
      <div class="k">Article page</div><div>${art?.url ? `<a href="${esc(art.url)}" target="_blank" rel="noopener">${esc(art.url)}</a> <span class="muted">${s.articleUrl ? '(set in sites.json)' : '(found automatically)'}</span>` : '<span class="muted">Not found yet — set "articleUrl" in sites.json</span>'}</div>
      <div class="k">Required keyword</div><div>${s.keyword ? `<span class="code">${esc(s.keyword)}</span>` : '<span class="muted">None</span>'}</div>
      <div class="k">Monitoring</div><div>${s.paused ? '<span class="pill paused">Paused</span>' : '<span class="pill up">Active</span>'}</div>
      <div class="k">Edit</div><div>Change sites in <a href="https://github.com/Apurba-Sardar/test01/blob/main/sites.json" target="_blank" rel="noopener">sites.json on GitHub</a> — Hostinger redeploys automatically.</div>
    </div></section>`;
  }
}

function trackingCard(s) {
  const t = s.health?.tags;
  const get = (k) => checkItem(s, k);
  const row = (label, it, body) => `<li><span class="a-ic ${!it ? '' : it.status === 'pass' ? 'g' : it.status === 'fail' ? 'r' : 'y'}">${!it ? I.q : it.status === 'pass' ? I.check : it.status === 'fail' ? I.x : I.alert}</span><div style="min-width:0"><b>${label}</b><span style="display:block">${body}</span></div></li>`;
  const email = ['mx', 'spf', 'dmarc', 'dkim'].map(get).filter(Boolean);
  const emailWorst = email.find((i) => i.status === 'fail') || email.find((i) => i.status === 'warn') || email[0];
  return `<div class="grid g-2" style="margin-top:18px">
    <section class="card"><div class="card-h"><h3>Analytics &amp; ads</h3><span class="sub">${t ? `checked ${ago(t.checkedAt)}` : 'after health checks'}</span></div><ul class="attn">
      ${row('Google Analytics / Tag Manager', get('analytics'), t ? (t.ga4.length || t.gtm.length ? [...t.ga4, ...t.gtm].map((x) => `<span class="code">${esc(x)}</span>`).join(' ') : esc(get('analytics')?.detail || 'None found')) : esc(get('analytics')?.detail || 'Pending'))}
      ${row('Ad networks', get('ads'), t ? (t.ads.length ? t.ads.map(esc).join(', ') + (t.pubIds.length ? ` · <span class="code">${esc(t.pubIds.join(', '))}</span>` : '') : 'None on this site') : esc(get('ads')?.detail || 'Pending'))}
      ${get('adstxt') ? row('ads.txt', get('adstxt'), esc(get('adstxt').detail)) : ''}
      ${['analytics', 'ads'].map(get).filter((i) => i && i.status === 'fail').map((i) => `<li><span class="a-ic r">${I.alert}</span><div><b>Problem</b><span style="display:block;color:var(--down)">${esc(i.detail)}</span></div></li>`).join('')}
    </ul></section>
    <section class="card"><div class="card-h"><h3>Domain email</h3><span class="sub">MX · SPF · DMARC · DKIM</span></div><ul class="attn">
      ${email.length ? email.map((i) => row(i.name.replace(/^Email: /, ''), i, esc(i.detail))).join('') : row('Email setup', null, 'Pending — runs with the health checks')}
    </ul></section>
  </div>`;
}

// ---------------------------------------------------------------- response-time chart (single series, hover crosshair)
function niceMax(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}
function drawChart(s) {
  const el = $('#rtChart');
  if (!el) return;
  const hist = (s.history || []).filter((h) => h.ms != null || h.ok === false);
  if (hist.length < 2) { el.innerHTML = '<p class="muted" style="margin:0">Not enough data yet — the chart fills in as checks run.</p>'; return; }
  const W = Math.max(320, el.clientWidth || 640), H = 220, L = 46, R = 10, T = 10, B = 26;
  const t1 = Date.now(), t0 = Math.max(t1 - 24 * 3600000, Math.min(hist[0].t, t1 - 3600000));
  const span = t1 - t0;
  $('#rtTitle').textContent = `Response time · last ${span > 23 * 3600000 ? '24 hours' : span >= 7200000 ? Math.round(span / 3600000) + ' hours' : Math.round(span / 60000) + ' min'}`;
  const okPts = hist.filter((h) => h.ok);
  const maxMs = niceMax(Math.max(...okPts.map((h) => h.ms), 100) * 1.1);
  const x = (t) => L + ((t - t0) / span) * (W - L - R);
  const y = (ms) => T + (1 - ms / maxMs) * (H - T - B);
  const gap = (data?.intervalSec || 60) * 1000 * 4;
  let d = '', area = '', prevT = null, seg = [];
  const flush = () => {
    if (seg.length > 1) area += `M${seg[0][0]},${H - B} ` + seg.map(([a, b]) => `L${a},${b}`).join(' ') + ` L${seg[seg.length - 1][0]},${H - B} Z `;
    seg = [];
  };
  for (const h of hist) {
    if (!h.ok) { prevT = null; flush(); continue; }
    const cont = prevT && h.t - prevT < gap;
    const px = x(h.t).toFixed(1), py = y(h.ms).toFixed(1);
    if (!cont) flush();
    d += `${cont ? 'L' : 'M'}${px},${py} `;
    seg.push([px, py]);
    prevT = h.t;
  }
  flush();
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxMs * f));
  const step = [600000, 1800000, 3600000, 3 * 3600000, 6 * 3600000].find((st) => span / st <= 6) || 6 * 3600000;
  const xt = [];
  for (let h = Math.ceil(t0 / step) * step; h <= t1; h += step) xt.push(h);
  const slow = data?.slowThresholdMs;
  const fails = hist.filter((h) => h.ok === false);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Homepage response time">
    <g class="grid">${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>
    <g class="axis">${ticks.map((v) => `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 's' : v + 'ms'}</text>`).join('')}
      ${xt.map((t) => `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</text>`).join('')}</g>
    ${slow && slow < maxMs ? `<line class="slowline" x1="${L}" x2="${W - R}" y1="${y(slow)}" y2="${y(slow)}"/><text class="slowlabel" x="${W - R}" y="${y(slow) - 4}" text-anchor="end">slow (${slow / 1000}s)</text>` : ''}
    <path class="area" d="${area}"/><path class="line" d="${d}"/>
    ${fails.map((h) => `<circle class="fail" cx="${x(h.t)}" cy="${H - B}" r="4.5"/>`).join('')}
    <line class="xhair" id="xh" y1="${T}" y2="${H - B}" visibility="hidden"/><circle class="hdot" id="hd" r="4.5" visibility="hidden"/>
    <rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/>
  </svg>`;
  const sv = el.querySelector('svg'), xh = sv.querySelector('#xh'), hd = sv.querySelector('#hd');
  sv.addEventListener('mousemove', (e) => {
    const r = sv.getBoundingClientRect();
    const t = t0 + ((((e.clientX - r.left) / r.width) * W - L) / (W - L - R)) * span;
    let best = hist[0];
    for (const h of hist) if (Math.abs(h.t - t) < Math.abs(best.t - t)) best = h;
    const bx = x(best.t);
    xh.setAttribute('x1', bx); xh.setAttribute('x2', bx); xh.setAttribute('visibility', 'visible');
    if (best.ok) { hd.setAttribute('cx', bx); hd.setAttribute('cy', y(best.ms)); hd.setAttribute('visibility', 'visible'); } else hd.setAttribute('visibility', 'hidden');
    showTip(`<b>${esc(fmtTime(best.t))}</b><br>${best.ok ? `${best.ms} ms${best.slow ? ' · slow' : ''}` : best.ok === null ? 'Blocked by Cloudflare' : 'Failed check'}`, e.clientX, e.clientY);
  });
  sv.addEventListener('mouseleave', () => { xh.setAttribute('visibility', 'hidden'); hd.setAttribute('visibility', 'hidden'); hideTip(); });
}
function drawStrip(s) {
  const el = $('#strip');
  if (!el) return;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 29; i >= 0; i--) days.push({ start: today.getTime() - i * 86400000, n: 0, ok: 0 });
  for (const b of s.hourly || []) { const d = days.find((x) => b.h >= x.start && b.h < x.start + 86400000); if (d) { d.n += b.n; d.ok += b.ok; } }
  el.innerHTML = days.map((d) => {
    const u = d.n ? (d.ok / d.n) * 100 : null;
    const label = new Date(d.start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return `<i class="${u == null ? '' : u >= 99.9 ? 'g' : u >= 99 ? 'w' : 'c'}" data-tip="${esc(`<b>${label}</b><br>${u == null ? 'No data' : `${pct(u)} uptime · ${d.n} checks${d.n - d.ok ? ` · ${d.n - d.ok} failed` : ''}`}`)}"></i>`;
  }).join('');
}
addEventListener('resize', () => { if (route.name === 'site' && detail && recTab === 'overview') drawChart(detail); });

// =================================================================== INCIDENTS
const incState = { f: 'all', site: '', q: '' };
let incTimer = null;
VIEWS.incidents = {
  sub: 'Outages, recoveries and health changes',
  mount() {
    return `
      <div class="page-head">
        <div><h2>Incidents &amp; activity</h2><p>Every outage, recovery and health change across TMJ websites.</p></div>
        <div class="acts"><button class="btn" id="incCsv">${I.download}Export CSV</button></div>
      </div>
      <div class="kpis k4" id="incKpis"></div>
      <section class="card">
        <div class="card-h">
          <div class="tabs" id="incTabs">
            ${[['all', 'All'], ['down', 'Outages'], ['up', 'Recoveries'], ['blocked', 'Blocked'], ['check', 'Health checks'], ['maint', 'Maintenance']].map(([k, l]) => `<button data-f="${k}">${l}</button>`).join('')}
          </div>
          <div class="toolbar"><select class="field-s" id="incSite" aria-label="Website"><option value="">All websites</option></select><input class="field-s" id="incQ" type="search" placeholder="Search details…" aria-label="Search incidents" /></div>
        </div>
        <div class="card-b flush tbl-wrap" id="incTbl"></div>
      </section>`;
  },
  bind() {
    $('#incTabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; incState.f = b.dataset.f; this.paint(); };
    $('#incSite').onchange = (e) => { incState.site = e.target.value; this.paint(); };
    $('#incQ').oninput = (e) => { incState.q = e.target.value; this.paint(); };
    $('#incCsv').onclick = () => downloadCsv(`tmj-incidents-${new Date().toISOString().slice(0, 10)}.csv`, [['Time', 'Website', 'Event', 'Details'], ...this.filtered().map((i) => [new Date(i.t).toISOString(), i.name, EVENT_LABEL[i.to] || i.to, i.detail])]);
    incidents = data?.incidents || [];
    this.fetch();
  },
  async fetch() {
    try { incidents = (await api('/api/incidents?limit=500')).incidents; if (route.name === 'incidents') this.render(); } catch {}
  },
  filtered() {
    const q = incState.q.toLowerCase();
    return incidents.filter((i) =>
      (incState.f === 'all' || (incState.f === 'check' ? i.to.startsWith('check') : incState.f === 'maint' ? ['paused', 'resumed'].includes(i.to) : i.to === incState.f)) &&
      (!incState.site || i.siteId === incState.site) &&
      (!q || `${i.name} ${i.detail}`.toLowerCase().includes(q)));
  },
  update() {
    // new live data → refresh the long history shortly after (debounced)
    clearTimeout(incTimer);
    incTimer = setTimeout(() => this.fetch(), 3000);
    this.render();
  },
  render() {
    if (!data || !$('#incKpis')) return;
    const sel = $('#incSite');
    if (sel && sel.options.length <= 1) sel.innerHTML = '<option value="">All websites</option>' + data.sites.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    const now = Date.now();
    const downs = incidents.filter((i) => i.to === 'down');
    const ups = incidents.filter((i) => i.to === 'up' && /Down for/.test(i.detail || ''));
    const ongoing = data.sites.filter((s) => !s.paused && ['down', 'partial'].includes(s.status)).length;
    const kpi = (label, value, sub, icon, tone = '') => `<div class="kpi"><div class="kpi-top"><span>${label}</span><span class="kpi-ic ${tone}">${icon}</span></div><div class="kpi-v">${value}</div><div class="kpi-s">${sub}</div></div>`;
    $('#incKpis').innerHTML =
      kpi('Ongoing issues', ongoing, ongoing ? '<span class="bad">open now</span>' : '<span class="good">all clear</span>', I.alert, ongoing ? 'r' : 'g') +
      kpi('Outages · 24h', downs.filter((i) => i.t > now - 86400000).length, `${downs.filter((i) => i.t > now - 7 * 86400000).length} in the last 7 days`, I.x, 'r') +
      kpi('Recoveries', ups.length, ups[0] ? `last ${ago(ups[0].t)}` : 'none yet', I.check, 'g') +
      kpi('Last outage', downs[0] ? ago(downs[0].t).replace(' ago', '') : 'None', downs[0] ? esc(downs[0].name) : 'in the recorded history', I.clock);
    this.paint();
  },
  paint() {
    $$('#incTabs button').forEach((b) => b.classList.toggle('on', b.dataset.f === incState.f));
    const list = this.filtered();
    $('#incTbl').innerHTML = list.length ? `<table class="tbl"><thead><tr><th>When</th><th>Website</th><th>Event</th><th>Details</th></tr></thead><tbody>
      ${list.slice(0, 300).map((i) => {
        const s = data?.sites.find((x) => x.id === i.siteId);
        return `<tr ${s ? `class="click" data-href="#/sites/${encodeURIComponent(s.id)}"` : ''}>
          <td class="num" style="white-space:nowrap">${esc(fmtTime(i.t))}<span class="sub">${ago(i.t)}</span></td>
          <td><div class="ent" style="min-width:160px">${s ? avatar(s) : ''}<div><b>${esc(i.name)}</b></div></div></td>
          <td><span class="tag ${esc(i.to)}">${EVENT_LABEL[i.to] || esc(i.to)}</span></td>
          <td class="muted" style="min-width:240px">${esc(i.detail)}</td></tr>`;
      }).join('')}</tbody></table>` : '<div class="empty">No incidents match these filters.</div>';
  },
};

// =================================================================== HEALTH & SEO
VIEWS.health = {
  sub: 'SEO and configuration checks',
  mount() {
    return `
      <div class="page-head">
        <div><h2>Health &amp; SEO</h2><p id="hSub">Checks that don’t take a site offline but quietly hurt it.</p></div>
        <div class="acts"><button class="btn primary" id="hRun">${I.task}Run all health checks</button></div>
      </div>
      <div class="kpis k4" id="hKpis"></div>
      <section class="card" style="margin-bottom:18px"><div class="card-h"><h3>Check matrix</h3><span class="legend-inline"><span><i style="background:var(--up)"></i>Pass</span><span><i style="background:var(--warn)"></i>Warning</span><span><i style="background:var(--down)"></i>Fail</span><span><i style="background:var(--pending)"></i>Unknown / blocked</span></span></div><div class="card-b flush tbl-wrap" id="hMatrix"></div></section>
      <section class="card"><div class="card-h"><h3>Issues to fix</h3><span class="sub" id="hIssuesN"></span></div><div class="card-b flush tbl-wrap" id="hIssues"></div></section>`;
  },
  bind() {
    $('#hRun').onclick = (e) => busy(e.currentTarget, () => api('/api/health-all', { method: 'POST' }), 'Health checks started — results appear as each site finishes');
  },
  update() {
    const sites = data.sites;
    const tot = { pass: 0, warn: 0, fail: 0, unknown: 0 };
    sites.forEach((s) => { const c = healthCounts(s); for (const k in tot) tot[k] += c[k]; });
    const last = Math.max(0, ...sites.map((s) => s.health?.checkedAt || 0));
    $('#hSub').textContent = `Runs every ${data.meta.healthIntervalHours} hours${last ? ` · last result ${ago(last)}` : ''}${data.meta.healthRunning ? ' · running now…' : ''}`;
    const all = tot.pass + tot.warn + tot.fail + tot.unknown;
    const kpi = (label, value, sub, icon, tone = '') => `<div class="kpi"><div class="kpi-top"><span>${label}</span><span class="kpi-ic ${tone}">${icon}</span></div><div class="kpi-v">${value}</div><div class="kpi-s">${sub}</div></div>`;
    $('#hKpis').innerHTML =
      kpi('Passing', tot.pass, all ? `${Math.round((tot.pass / all) * 100)}% of ${all} checks` : 'no results yet', I.check, 'g') +
      kpi('Warnings', tot.warn, 'worth a look', I.alert, tot.warn ? 'y' : '') +
      kpi('Failing', tot.fail, tot.fail ? '<span class="bad">fix these first</span>' : '<span class="good">none</span>', I.x, tot.fail ? 'r' : '') +
      kpi('Unknown', tot.unknown, 'blocked or unreachable', I.q);
    const label = Object.fromEntries(CHECK_COLS);
    const groups = CHECK_GROUPS.map(([g, keys]) => [g, keys.filter((k) => sites.some((s) => checkItem(s, k)))]).filter(([, k]) => k.length);
    const cols = groups.flatMap(([, keys]) => keys.map((k) => [k, label[k] || k]));
    $('#hMatrix').innerHTML = `<table class="tbl matrix"><thead>
      <tr class="grp"><th></th>${groups.map(([g, keys]) => `<th class="c" colspan="${keys.length}">${g}</th>`).join('')}</tr>
      <tr><th>Website</th>${cols.map(([, l]) => `<th class="c">${l}</th>`).join('')}</tr></thead><tbody>
      ${sites.map((s) => `<tr class="click" data-href="#/sites/${encodeURIComponent(s.id)}"><td><div class="ent">${avatar(s)}<div><b>${esc(s.name)}</b><span class="u">${s.health ? `checked ${ago(s.health.checkedAt)}` : 'pending'}</span></div></div></td>
        ${cols.map(([k, l]) => {
          const it = checkItem(s, k);
          if (!it) return `<td class="c"><span class="hic na" data-tip="${esc(`<b>${l}</b><br>Not applicable`)}">–</span></td>`;
          return `<td class="c"><span class="hic ${it.status}" data-tip="${esc(`<b>${esc(s.name)} · ${esc(it.name)}</b><br>${esc(it.detail)}`)}">${{ pass: I.check, warn: I.alert, fail: I.x, unknown: I.q }[it.status]}</span></td>`;
        }).join('')}</tr>`).join('')}</tbody></table>`;
    const issues = [];
    for (const s of sites) for (const i of s.health?.items || []) if (i.status === 'fail' || i.status === 'warn') issues.push({ s, i });
    issues.sort((a, b) => (a.i.status === 'fail' ? 0 : 1) - (b.i.status === 'fail' ? 0 : 1));
    $('#hIssuesN').textContent = issues.length ? `${issues.length} open` : '';
    $('#hIssues').innerHTML = issues.length ? `<table class="tbl"><thead><tr><th>Severity</th><th>Website</th><th>Check</th><th>Details</th></tr></thead><tbody>
      ${issues.map(({ s, i }) => `<tr class="click" data-href="#/sites/${encodeURIComponent(s.id)}"><td><span class="pill ${i.status === 'fail' ? 'down' : 'degraded'}">${i.status === 'fail' ? 'Fail' : 'Warning'}</span></td><td><b>${esc(s.name)}</b></td><td>${esc(i.name)}</td><td class="muted">${esc(i.detail)}</td></tr>`).join('')}
      </tbody></table>` : `<div class="empty">${sites.some((s) => s.health) ? '🎉 No failing or warning checks.' : 'Health checks haven’t run yet.'}</div>`;
  },
};

// =================================================================== DOMAINS & SSL
VIEWS.domains = {
  sub: 'Renewals, certificates and authority',
  mount() {
    return `
      <div class="page-head"><div><h2>Domains, SSL &amp; authority</h2><p>Know what needs renewing before it breaks.</p></div>
        <div class="acts"><button class="btn" id="dCsv">${I.download}Export CSV</button></div></div>
      <div class="kpis k4" id="dKpis"></div>
      <section class="card"><div class="card-h"><h3>Renewal schedule</h3><span class="sub">sorted by the soonest expiry</span></div><div class="card-b flush tbl-wrap" id="dTbl"></div></section>`;
  },
  rows() {
    return data.sites.map((s) => {
      const d = domainInfo(s);
      const soon = Math.min(s.ssl?.daysLeft ?? 9999, d?.days ?? 9999);
      return { s, d, soon };
    }).sort((a, b) => a.soon - b.soon);
  },
  bind() {
    $('#dCsv').onclick = () => downloadCsv(`tmj-domains-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Website', 'Domain', 'Domain expires', 'Domain days left', 'SSL expires', 'SSL days left', 'SSL issuer', 'DA', 'Spam score'],
      ...this.rows().map(({ s, d }) => [s.name, d?.domain || new URL(s.url).hostname, d?.expires?.slice(0, 10), d?.days, s.ssl?.validTo?.slice(0, 10), s.ssl?.daysLeft, s.ssl?.issuer, s.da?.value, s.da?.spamScore]),
    ]);
  },
  update() {
    const rows = this.rows();
    const warn = data.meta.sslWarnDays || 14;
    const sslSoon = rows.filter((r) => (r.s.ssl?.daysLeft ?? 999) <= 30).length;
    const domSoon = rows.filter((r) => (r.d?.days ?? 999) <= 60).length;
    const das = rows.map((r) => r.s.da?.value).filter((v) => typeof v === 'number');
    const next = rows[0];
    const kpi = (label, value, sub, icon, tone = '') => `<div class="kpi"><div class="kpi-top"><span>${label}</span><span class="kpi-ic ${tone}">${icon}</span></div><div class="kpi-v">${value}</div><div class="kpi-s">${sub}</div></div>`;
    $('#dKpis').innerHTML =
      kpi('Next renewal', next && next.soon < 9999 ? `${next.soon}<small> days</small>` : '—', next && next.soon < 9999 ? esc(next.s.name) : 'after health checks', I.clock, next && next.soon <= 14 ? 'y' : '') +
      kpi('SSL expiring ≤ 30d', sslSoon, 'certificates', I.lock, sslSoon ? 'y' : 'g') +
      kpi('Domains expiring ≤ 60d', domSoon, 'registrations', I.globe, domSoon ? 'y' : 'g') +
      kpi('Avg Domain Authority', das.length ? Math.round(das.reduce((a, b) => a + b, 0) / das.length) : '—', data.meta.mozEnabled ? `Moz · refreshed weekly` : '<a href="#/settings">Connect Moz</a>', I.shield);
    $('#dTbl').innerHTML = `<table class="tbl"><thead><tr><th>Website</th><th>Domain registration</th><th>SSL certificate</th><th class="hide-md">Issuer</th><th class="r">DA</th><th class="r hide-md">Spam score</th></tr></thead><tbody>
      ${rows.map(({ s, d }) => `<tr class="click" data-href="#/sites/${encodeURIComponent(s.id)}">
        <td><div class="ent">${avatar(s)}<div><b>${esc(s.name)}</b><span class="u">${esc(d?.domain || new URL(s.url).hostname)}</span></div></div></td>
        <td>${d ? `<span class="days ${daysClass(d.days, 60, 14)}">${d.days} days</span><span class="sub">${esc(fmtDate(d.expires))}</span>` : `<span class="muted">${esc(checkItem(s, 'domain')?.detail || 'Pending')}</span>`}</td>
        <td>${s.ssl?.daysLeft != null ? `<span class="days ${daysClass(s.ssl.daysLeft, warn, 3)}">${s.ssl.daysLeft} days</span><span class="sub">${esc(fmtDate(s.ssl.validTo))}</span>` : `<span class="muted">${esc(s.ssl?.error || 'Pending')}</span>`}</td>
        <td class="hide-md muted">${esc(s.ssl?.issuer || '—')}</td>
        <td class="r num"><b>${typeof s.da?.value === 'number' ? s.da.value : '—'}</b>${s.da?.prev != null && typeof s.da?.value === 'number' && s.da.prev !== s.da.value ? `<span class="sub">${s.da.value > s.da.prev ? '▲' : '▼'} from ${s.da.prev}</span>` : ''}</td>
        <td class="r num hide-md">${s.da?.spamScore != null ? s.da.spamScore + '%' : '—'}</td></tr>`).join('')}</tbody></table>`;
  },
};

// =================================================================== REPORTS & HISTORY
const repState = { months: Number(pref.get('repMonths', 12)), metric: pref.get('repMetric', 'uptime') };
let report = null;
const fmtMonth = (k) => new Date(k + '-01T00:00:00Z').toLocaleDateString([], { month: 'short', year: '2-digit', timeZone: 'UTC' });
const fmtMin = (m) => (m == null ? '—' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`);
VIEWS.reports = {
  sub: 'Long-term uptime and performance',
  mount() {
    return `
      <div class="page-head">
        <div><h2>Reports &amp; history</h2><p id="repSub">Monthly uptime, speed and outages for every website — kept permanently.</p></div>
        <div class="acts">
          <select class="field-s" id="repMonths" aria-label="Period"><option value="6">Last 6 months</option><option value="12">Last 12 months</option><option value="24">Last 24 months</option><option value="36">Last 36 months</option></select>
          <button class="btn" id="repCsv">${I.download}Export report</button>
        </div>
      </div>
      <div class="kpis k4" id="repKpis"></div>
      <section class="card">
        <div class="card-h">
          <div class="tabs" id="repTabs">
            <button data-m="uptime">Uptime</button><button data-m="avgMs">Avg response</button><button data-m="outages">Outages</button><button data-m="downMinutes">Downtime</button>
          </div>
          <span class="legend-inline" id="repLegend"></span>
        </div>
        <div class="card-b flush tbl-wrap" id="repTbl"><div class="empty">Loading history…</div></div>
      </section>`;
  },
  bind() {
    $('#repMonths').value = String(repState.months);
    $('#repMonths').onchange = (e) => { repState.months = Number(e.target.value); pref.set('repMonths', repState.months); this.load(); };
    $('#repTabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; repState.metric = b.dataset.m; pref.set('repMetric', repState.metric); this.paint(); };
    $('#repCsv').onclick = () => {
      if (!report) return;
      downloadCsv(`tmj-monthly-report-${new Date().toISOString().slice(0, 10)}.csv`, [
        ['Website', 'Month', 'Uptime %', 'Avg response ms', 'Outages', 'Downtime minutes', 'Checks', 'Failed checks'],
        ...report.sites.flatMap((s) => report.months.map((k) => { const m = s.months[k]; return [s.name, k, m.uptime?.toFixed(3), m.avgMs, m.outages, m.downMinutes, m.checks, m.failed]; })),
      ]);
    };
    this.load();
  },
  async load() {
    try { report = await api(`/api/reports/monthly?months=${repState.months}`); this.paint(); }
    catch (err) { $('#repTbl').innerHTML = `<div class="empty">Could not load the report: ${esc(err.message)}</div>`; }
  },
  update() {
    clearTimeout(this.t);
    this.t = setTimeout(() => this.load(), 5000); // live data changes this month's numbers
  },
  paint() {
    if (!report || !$('#repTbl')) return;
    const { months, sites } = report;
    const cur = months[months.length - 1];
    const agg = (k) => {
      let n = 0, ok = 0, out = 0, down = 0;
      for (const s of sites) { const m = s.months[k]; n += m.checks; ok += m.checks - m.failed; out += m.outages; down += m.downMinutes; }
      return { up: n ? (ok / n) * 100 : null, out, down };
    };
    const a = agg(cur);
    const kpi = (label, value, sub, icon, tone = '') => `<div class="kpi"><div class="kpi-top"><span>${label}</span><span class="kpi-ic ${tone}">${icon}</span></div><div class="kpi-v">${value}</div><div class="kpi-s">${sub}</div></div>`;
    $('#repKpis').innerHTML =
      kpi('History since', report.since ? new Date(report.since + 'T00:00:00Z').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—', report.since ? `${Math.max(1, Math.round((Date.now() - Date.parse(report.since)) / 86400000))} days recorded` : 'starts with the first check', I.clock) +
      kpi(`Uptime · ${fmtMonth(cur)}`, pct(a.up), 'all websites, this month', I.trend, 'g') +
      kpi(`Outages · ${fmtMonth(cur)}`, a.out, a.out ? '<span class="bad">this month</span>' : '<span class="good">none this month</span>', I.x, a.out ? 'r' : '') +
      kpi(`Downtime · ${fmtMonth(cur)}`, fmtMin(a.down), 'estimated from failed checks', I.alert, a.down ? 'y' : '');
    $$('#repTabs button').forEach((b) => b.classList.toggle('on', b.dataset.m === repState.metric));
    const metric = repState.metric;
    $('#repLegend').innerHTML = metric === 'uptime'
      ? '<span><i style="background:var(--up-soft);border:1px solid var(--up)"></i>≥ 99.9%</span><span><i style="background:var(--warn-soft);border:1px solid var(--warn)"></i>≥ 99%</span><span><i style="background:var(--down-soft);border:1px solid var(--down)"></i>&lt; 99%</span><span>— no data</span>'
      : metric === 'avgMs' ? `<span><i style="background:var(--warn-soft);border:1px solid var(--warn)"></i>slower than ${(data?.slowThresholdMs || 5000) / 1000}s</span><span>— no data</span>`
      : '<span><i style="background:var(--down-soft);border:1px solid var(--down)"></i>any outage / downtime</span>';
    const cell = (m) => {
      if (!m.checks) return '<td class="c muted">—</td>';
      const tipTxt = `<b>${pct(m.uptime, 3)} uptime</b><br>${m.checks} checks · ${m.failed} failed<br>${m.outages} outage${m.outages === 1 ? '' : 's'} · ~${fmtMin(m.downMinutes)} down<br>Avg response ${m.avgMs ?? '—'} ms`;
      let txt, bg = '', fg = '';
      if (metric === 'uptime') {
        txt = pct(m.uptime, m.uptime >= 99.995 ? 0 : 2);
        [bg, fg] = m.uptime >= 99.9 ? ['var(--up-soft)', 'var(--up)'] : m.uptime >= 99 ? ['var(--warn-soft)', 'var(--warn)'] : ['var(--down-soft)', 'var(--down)'];
      } else if (metric === 'avgMs') {
        txt = m.avgMs != null ? `${m.avgMs} ms` : '—';
        if (m.avgMs > (data?.slowThresholdMs || 5000)) [bg, fg] = ['var(--warn-soft)', 'var(--warn)'];
      } else if (metric === 'outages') {
        txt = String(m.outages);
        if (m.outages) [bg, fg] = ['var(--down-soft)', 'var(--down)'];
      } else {
        txt = fmtMin(m.downMinutes);
        if (m.downMinutes) [bg, fg] = ['var(--down-soft)', 'var(--down)'];
      }
      return `<td class="c num" data-tip="${esc(tipTxt)}"><span style="display:inline-block;min-width:62px;padding:4px 6px;border-radius:7px;font-weight:650;background:${bg};color:${fg || 'var(--text)'}">${txt}</span></td>`;
    };
    const total = (s) => {
      let n = 0, ok = 0, ms = 0, out = 0, down = 0;
      for (const k of months) { const m = s.months[k]; n += m.checks; ok += m.checks - m.failed; ms += (m.avgMs || 0) * (m.checks - m.failed); out += m.outages; down += m.downMinutes; }
      return metric === 'uptime' ? pct(n ? (ok / n) * 100 : null) : metric === 'avgMs' ? (ok ? `${Math.round(ms / ok)} ms` : '—') : metric === 'outages' ? out : fmtMin(down);
    };
    $('#repTbl').innerHTML = `<table class="tbl"><thead><tr><th>Website</th>${months.map((k) => `<th class="c">${fmtMonth(k)}</th>`).join('')}<th class="r">Period</th></tr></thead><tbody>
      ${sites.map((s) => `<tr class="click" data-href="#/sites/${encodeURIComponent(s.id)}"><td><div class="ent">${avatar(s)}<div><b>${esc(s.name)}</b><span class="u">${s.since ? 'since ' + esc(s.since) : 'no history yet'}</span></div></div></td>${months.map((k) => cell(s.months[k])).join('')}<td class="r num"><b>${total(s)}</b></td></tr>`).join('')}
      </tbody></table>`;
    $('#repSub').textContent = `Monthly ${({ uptime: 'uptime', avgMs: 'average response time', outages: 'outages', downMinutes: 'downtime' })[metric]} for every website · daily totals are kept permanently`;
  },
};

// =================================================================== SETTINGS
VIEWS.settings = {
  sub: 'Configuration and integrations',
  mount() {
    return `
      <div class="page-head"><div><h2>Settings &amp; alerts</h2><p>How TMJ Dashboard is configured. Values come from environment variables in Hostinger.</p></div>
        <div class="acts"><button class="btn" id="sIp">${I.copy}Copy outgoing IP</button><button class="btn" id="sVerify">${I.refresh}Check Gmail login</button><button class="btn primary" id="sMail">${I.mail}Send test email</button></div></div>
      <div class="grid g-2">
        <section class="card"><div class="card-h"><h3>${I.pulse}Monitoring</h3></div><div class="kv" id="sMon"></div></section>
        <section class="card"><div class="card-h"><h3>${I.mail}Email alerts</h3></div><div class="kv" id="sMailKv"></div></section>
        <section class="card"><div class="card-h"><h3>${I.plug}Integrations</h3></div><div class="kv" id="sInt"></div></section>
        <section class="card"><div class="card-h"><h3>${I.server}System</h3></div><div class="kv" id="sSys"></div></section>
      </div>
      <section class="card" style="margin-bottom:18px"><div class="card-h"><h3>${I.server}Data &amp; storage</h3><span class="sub">history is kept on the server and survives redeploys</span></div>
        <div class="kv" id="sStore"><div class="k">Loading…</div><div></div></div>
        <div class="card-b" style="border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <select class="field-s" id="dlDays" aria-label="Check log period"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 365 days</option><option value="0">Everything</option></select>
          <a class="btn" id="dlChecks" href="/api/export/checks.csv?days=30" download>${I.download}Check log (CSV)</a>
          <a class="btn" href="/api/export/daily.csv" download>${I.download}Daily uptime (CSV)</a>
          <a class="btn" href="/api/export/incidents.csv" download>${I.download}All incidents (CSV)</a>
          <a class="btn" href="/api/export/health.csv" download>${I.download}Health history (CSV)</a>
          <a class="btn" href="/api/export/da.csv" download>${I.download}DA history (CSV)</a>
          <a class="btn" href="/api/export/mail.csv" download>${I.download}Email log (CSV)</a>
        </div>
      </section>
      <section class="card"><div class="card-h"><h3>${I.info}How to change settings</h3></div><div class="card-b" style="color:var(--text-2)">
        <p style="margin-top:0">In hPanel, open the website → <b>Environment variables</b>, edit a value and save. Hostinger redeploys automatically.</p>
        <p>Common variables: <span class="code">DASHBOARD_USER</span> <span class="code">DASHBOARD_PASS</span> <span class="code">ALERT_EMAIL_TO</span> <span class="code">SMTP_USER</span> <span class="code">SMTP_PASS</span> <span class="code">CHECK_INTERVAL_SECONDS</span> <span class="code">FAIL_THRESHOLD</span> <span class="code">REALERT_MINUTES</span> <span class="code">MOZ_API_TOKEN</span> <span class="code">APP_NAME</span></p>
        <p style="margin-bottom:0">To add, remove or rename websites, edit <a href="https://github.com/Apurba-Sardar/test01/blob/main/sites.json" target="_blank" rel="noopener">sites.json on GitHub</a>. Full guide: <a href="https://github.com/Apurba-Sardar/test01#readme" target="_blank" rel="noopener">README</a>.</p>
      </div></section>`;
  },
  bind() {
    $('#sMail').onclick = (e) => busy(e.currentTarget, async () => {
      const r = await api('/api/test-email', { method: 'POST' });
      toast(r.sent ? 'Test email sent ✔' : r.skipped ? 'Email is not configured — set the SMTP_* variables' : `Email failed: ${r.error}`);
    });
    $('#sVerify').onclick = (e) => busy(e.currentTarget, async () => {
      const r = await api('/api/mail/verify', { method: 'POST' });
      toast(r.verified ? 'Gmail login OK ✔' : r.verifyError ? `Login failed: ${r.verifyError}` : 'Email is not configured');
    });
    $('#dlDays').onchange = (e) => ($('#dlChecks').href = `/api/export/checks.csv?days=${e.target.value}`);
    api('/api/storage').then((st) => {
      const size = st.bytes > 1048576 ? `${(st.bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(st.bytes / 1024))} KB`;
      const fmtD = (d) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
      const deployWarn = /hbuilds/.test(st.dir);
      $('#sStore').innerHTML = [
        ['Storage folder', `<span class="code">${esc(st.dir)}</span> ${st.writable ? '<span class="pill up">Writable</span>' : '<span class="pill down">Not writable</span>'}${deployWarn ? ' <span class="pill degraded">Inside deploy folder</span>' : ''}`],
        ['Size on disk', `${size} · ${st.files} files`],
        ['History since', fmtD(st.historySince)],
        ['Detailed check log', `${st.logDays} day${st.logDays === 1 ? '' : 's'} stored${st.oldestLog ? ` (from ${fmtD(st.oldestLog)})` : ''} · kept ${st.retentionDays ? st.retentionDays + ' days' : 'forever'} <span class="muted">(LOG_RETENTION_DAYS)</span>`],
        ['Kept forever', `Daily uptime totals · ${st.incidents} events · ${st.healthRuns} health runs · ${st.daReadings} DA readings · ${st.emails || 0} emails`],
      ].map(([k, v]) => `<div class="k">${k}</div><div>${v}</div>`).join('');
    }).catch((err) => ($('#sStore').innerHTML = `<div class="k">Storage</div><div class="muted">${esc(err.message)}</div>`));
    $('#sIp').onclick = (e) => busy(e.currentTarget, async () => {
      const { ip } = await api('/api/outgoing-ip');
      if (!ip) return toast('Could not detect the outgoing IP');
      await navigator.clipboard?.writeText(ip).catch(() => {});
      toast(`Outgoing IP ${ip} copied`);
    });
  },
  update() {
    const m = data.meta;
    const on = (b, yes = 'On', no = 'Off') => `<span class="pill ${b ? 'up' : 'paused'}">${b ? yes : no}</span>`;
    const kv = (rows) => rows.map(([k, v]) => `<div class="k">${k}</div><div>${v}</div>`).join('');
    $('#sMon').innerHTML = kv([
      ['Websites', `${data.sites.length} (${data.sites.filter((s) => s.paused).length} paused)`],
      ['Check interval', `Every <b>${data.intervalSec}s</b> · homepage + article page`],
      ['Marked down after', `<b>${data.failThreshold}</b> failed checks in a row`],
      ['Slow threshold', `<b>${(data.slowThresholdMs / 1000).toFixed(1)}s</b>`],
      ['Health & SEO checks', `Every <b>${m.healthIntervalHours}h</b>`],
    ]);
    const ml = m.mail || {};
    const smtp = !m.mailEnabled ? '<span class="pill paused">Not configured</span> <span class="muted">set SMTP_* and ALERT_EMAIL_TO</span>'
      : ml.verified === true ? `<span class="pill up">Login OK</span> <span class="muted">checked ${ago(ml.verifiedAt)}</span>`
      : ml.verified === false ? `<span class="pill down">Login failed</span> <span class="muted">${esc(ml.verifyError)}</span>`
      : '<span class="pill paused">Checking…</span>';
    const lastLine = (x, okTxt) => (x ? `${x.ok ? `<span class="pill up">${okTxt}</span>` : '<span class="pill down">Failed</span>'} ${ago(x.t)} · <span class="muted">${esc(x.subject)}</span>${x.ok ? '' : `<br><span style="color:var(--down)">${esc(x.error)}</span>`}` : '<span class="muted">No emails yet</span>');
    $('#sMailKv').innerHTML = kv([
      ['Gmail / SMTP', `${smtp}${ml.from ? `<br><span class="muted">from ${esc(ml.from)}${ml.host ? ' via ' + esc(ml.host) : ''}</span>` : ''}`],
      ['Last email', lastLine(ml.last, 'Sent')],
      ['Last 30 days', `<b>${ml.sent30 || 0}</b> sent · <b style="color:${ml.failed30 ? 'var(--down)' : 'inherit'}">${ml.failed30 || 0}</b> failed`],
      ['Recipients', m.recipients ? `${m.recipients} address${m.recipients > 1 ? 'es' : ''}` : '—'],
      ['Reminders', m.realertMinutes ? `Every <b>${m.realertMinutes} min</b> while down` : 'Off'],
      ['Sent for', 'Down · still down · recovered · SSL expiring · health check failing'],
      ['Grouping', 'One email per check cycle'],
    ]) + `<div class="k">Recent emails</div><div>${(ml.recent || []).length ? `<ul class="mini-log">${ml.recent.map((x) => `<li><span class="dot ${x.ok ? 'up' : 'down'}"></span><span class="t">${esc(fmtTime(x.t))}</span><span class="s">${esc(x.subject)}</span></li>`).join('')}</ul>` : '<span class="muted">None yet</span>'}</div>`;
    $('#sInt').innerHTML = kv([
      ['Moz Domain Authority', `${on(m.mozEnabled, 'Connected', 'Not connected')}${m.mozEnabled ? '' : ' <span class="muted">— set MOZ_API_TOKEN</span>'}`],
      ['Hostinger cron job', `${on(m.cronEnabled, 'Token set', 'No token')} <span class="muted">/api/cron?token=…</span>`],
      ['Cloudflare allow-list', `Allow <span class="code">${esc(m.outgoingIp || 'unknown')}</span> in each zone`],
      ['Login', on(m.authEnabled, 'Protected', 'Open — set DASHBOARD_USER')],
    ]);
    $('#sSys').innerHTML = kv([
      ['Version', `TMJ Dashboard <b>${esc(m.version)}</b>`],
      ['Running for', data.startedAt ? dur(Date.now() - data.startedAt) : '—'],
      ['Last full check', ago(data.lastRunAt)],
      ['Signed in as', `<b>${esc(me.user)}</b> · Administrator`],
      ['Live connection', $('#live').classList.contains('on') ? on(true, 'Connected') : on(false, '', 'Reconnecting')],
    ]);
  },
};

// ---------------------------------------------------------------- row navigation (tables, lists)
document.addEventListener('click', (e) => {
  const row = e.target.closest('[data-href]');
  if (row && !e.target.closest('a, button')) location.hash = row.dataset.href;
});

// ---------------------------------------------------------------- live data
function connect() {
  const es = new EventSource('/api/events');
  let lost;
  es.onopen = () => { clearTimeout(lost); $('#live').classList.add('on'); $('#liveText').textContent = 'Live'; };
  es.onmessage = (e) => {
    data = JSON.parse(e.data);
    paintShell();
    view?.update();
  };
  // the server recycles the stream every ~100 s; only show a problem if reconnecting takes a while
  es.onerror = () => {
    clearTimeout(lost);
    lost = setTimeout(async () => {
      $('#live').classList.remove('on');
      $('#liveText').textContent = 'Reconnecting';
      const r = await fetch('/api/me').catch(() => null);
      if (r && r.status === 401) location.href = '/login';
    }, 5000);
  };
}
setInterval(() => { if (data && route.name !== 'site') { paintShell(); view?.update(); } }, 30000); // refresh "x ago" labels

go();
connect();
