/* Site Status dashboard */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const TYPE_LABEL = { wordpress: 'WordPress', nextjs: 'Next.js' };
const STATUS_LABEL = { up: 'Operational', degraded: 'Slow', partial: 'Partial outage', down: 'Down', blocked: 'Blocked', pending: 'Checking…', paused: 'Paused' };
const ORDER = { down: 0, partial: 1, blocked: 2, degraded: 3, pending: 4, up: 5, paused: 6 };
const EVENT_LABEL = { down: 'DOWN', up: 'UP', degraded: 'SLOW', blocked: 'BLOCKED', paused: 'PAUSED', resumed: 'RESUMED', 'check-fail': 'CHECK FAIL', 'check-pass': 'CHECK FIXED' };
const I = {
  check: '<svg class="i" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg class="i" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  alert: '<svg class="i" viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  q: '<svg class="i" viewBox="0 0 24 24"><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/></svg>',
  chev: '<svg class="i" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  ext: '<svg class="i" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>',
  refresh: '<svg class="i" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  pause: '<svg class="i" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
  play: '<svg class="i" viewBox="0 0 24 24"><path d="m6 3 14 9-14 9z"/></svg>',
  stetho: '<svg class="i" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  sun: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg class="i" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  globe: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>',
};

let data = null;
let filter = store.get('filter', 'all');
let sort = store.get('sort', 'status');
let query = '';
let evFilter = 'all';
let evLimit = 15;
let lastDown = null; // ids of down sites (null = first load, don't notify)
let openId = null;
let detail = null;

// ---------- helpers ----------
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
const typeKey = (t) => (t === 'wordpress' || t === 'nextjs' ? t : 'other');
const isProblem = (s) => ['down', 'partial', 'blocked', 'degraded'].includes(s.status) || healthCounts(s).fail > 0;
function healthCounts(s) {
  const c = { pass: 0, warn: 0, fail: 0, unknown: 0 };
  for (const i of s.health?.items || []) c[i.status] = (c[i.status] || 0) + 1;
  return c;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 3200);
}
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  if (r.status === 401) { location.href = '/login'; throw new Error('signed out'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ---------- tooltip (shared) ----------
const tip = $('#tip');
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.classList.add('show');
  const r = tip.getBoundingClientRect();
  let left = x + 12, top = y + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 12;
  if (top + r.height > innerHeight - 8) top = y - r.height - 12;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}
const hideTip = () => tip.classList.remove('show');
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el) showTip(el.dataset.tip, e.clientX, e.clientY);
});
document.addEventListener('mousemove', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el) showTip(el.dataset.tip, e.clientX, e.clientY);
  else if (!e.target.closest('.chart')) hideTip();
});

// ---------- theme ----------
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
const paintTheme = () => ($('#themeBtn').innerHTML = isDark() ? I.sun : I.moon);
$('#themeBtn').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set('theme', next);
  paintTheme();
  if (detail) renderDrawer(); // chart colors come from CSS, but redraw keeps it crisp
});
paintTheme();

// ---------- header / user menu ----------
const menu = $('#userMenu');
$('#userBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
  $('#userBtn').setAttribute('aria-expanded', String(!menu.hidden));
});
document.addEventListener('click', (e) => { if (!e.target.closest('.user')) menu.hidden = true; });
$('#signout').addEventListener('click', async (e) => {
  e.preventDefault();
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login';
});
$('#testMail').addEventListener('click', async () => {
  menu.hidden = true;
  toast('Sending test email…');
  try {
    const r = await api('/api/test-email', { method: 'POST' });
    toast(r.sent ? 'Test email sent ✔' : r.skipped ? 'Email is not configured — set the SMTP_* variables' : `Email failed: ${r.error}`);
  } catch (err) { toast(`Email failed: ${err.message}`); }
});
$('#copyIp').addEventListener('click', async () => {
  menu.hidden = true;
  try {
    const { ip } = await api('/api/outgoing-ip');
    if (!ip) return toast('Could not detect the outgoing IP');
    await navigator.clipboard.writeText(ip).catch(() => {});
    toast(`Outgoing IP ${ip} copied`);
  } catch (err) { toast(err.message); }
});
function paintNotify() {
  const n = 'Notification' in window ? Notification.permission : 'unsupported';
  $('#notifyText').textContent = n === 'granted' ? 'Desktop alerts are on' : n === 'denied' ? 'Desktop alerts blocked' : n === 'unsupported' ? 'Desktop alerts unavailable' : 'Enable desktop alerts';
}
$('#notifyBtn').addEventListener('click', async () => {
  if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  paintNotify();
});
paintNotify();
api('/api/me').then((me) => {
  $('#userName').textContent = me.user;
  $('#userBtn').textContent = (me.user || '?').slice(0, 1);
  if (!me.authEnabled) $('#signout').hidden = true;
}).catch(() => {});

$('#checkAll').addEventListener('click', async () => {
  const b = $('#checkAll');
  b.classList.add('busy');
  try { await api('/api/check-all', { method: 'POST' }); toast('Checking all sites…'); }
  catch (err) { toast(err.message); }
  setTimeout(() => b.classList.remove('busy'), 2500);
});

// ---------- main render ----------
function render() {
  if (!data) return;
  const { sites, meta } = data;
  document.querySelectorAll('.app-name').forEach((el) => (el.textContent = meta.appName));
  const active = sites.filter((s) => !s.paused);
  const down = active.filter((s) => s.status === 'down');
  const partial = active.filter((s) => s.status === 'partial');
  const blocked = active.filter((s) => s.status === 'blocked');
  const slow = active.filter((s) => s.status === 'degraded');
  const up = active.filter((s) => ['up', 'degraded', 'partial'].includes(s.status));
  const paused = sites.filter((s) => s.paused);
  const healthFails = active.reduce((n, s) => n + healthCounts(s).fail, 0);
  const count = (t) => sites.filter((s) => typeKey(s.type) === t).length;
  const downOf = (t) => down.filter((s) => typeKey(s.type) === t).length;

  // hero
  const hero = $('#hero');
  const bad = down.length || partial.length;
  const warn = !bad && (blocked.length || slow.length || healthFails);
  hero.className = 'hero' + (bad ? ' down' : warn ? ' warn' : '');
  $('#heroIcon').innerHTML = bad ? I.x : warn ? I.alert : I.check;
  $('#heroTitle').textContent = !sites.length
    ? 'No sites configured yet'
    : down.length
    ? `${down.length} of ${active.length} site${active.length > 1 ? 's' : ''} down`
    : partial.length
    ? `${partial.length} site${partial.length > 1 ? 's have' : ' has'} a broken page`
    : blocked.length
    ? `${up.length} up · ${blocked.length} can't be checked`
    : slow.length
    ? `All sites up · ${slow.length} responding slowly`
    : healthFails
    ? `All sites up · ${healthFails} health check${healthFails > 1 ? 's' : ''} failing`
    : 'All systems operational';
  $('#heroSub').textContent = !sites.length
    ? 'Add your sites to sites.json — this page updates automatically.'
    : down.length || partial.length
    ? [...down, ...partial].map((s) => `${s.name}${s.status === 'partial' ? ' (' + (s.error || '').split(':')[0] + ')' : ''}`).join(' · ')
    : blocked.length
    ? `Blocked by Cloudflare: ${blocked.map((s) => s.name).join(', ')} — allow the monitor's IP (account menu → Copy outgoing IP)`
    : `${active.length} site${active.length === 1 ? '' : 's'} checked every ${meta.intervalSec || data.intervalSec}s${paused.length ? ` · ${paused.length} paused` : ''}`;
  const ups = active.map((s) => s.uptime24h).filter((v) => v != null);
  const overall = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null;
  const lastInc = data.incidents.find((i) => i.to === 'down');
  $('#heroStats').innerHTML = `<div><b>${pct(overall)}</b><span>Uptime · 24h</span></div><div><b>${lastInc ? ago(lastInc.t) : 'None'}</b><span>Last outage</span></div>`;

  document.title = bad ? `(${down.length + partial.length} issue${down.length + partial.length > 1 ? 's' : ''}) ${meta.appName}` : meta.appName;

  // tiles
  const times = active.filter((s) => s.responseTime != null && s.status !== 'down').map((s) => s.responseTime);
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
  const tile = (k, v, s, cls = '') => `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  const das = sites.map((s) => s.da?.value).filter((v) => typeof v === 'number');
  $('#tiles').innerHTML =
    tile('Total sites', sites.length, paused.length ? `${paused.length} paused` : count('other') ? `${count('other')} other` : 'all monitored') +
    tile('WordPress', count('wordpress'), downOf('wordpress') ? `<span class="bad">${downOf('wordpress')} down</span>` : 'all up') +
    tile('Next.js', count('nextjs'), downOf('nextjs') ? `<span class="bad">${downOf('nextjs')} down</span>` : 'all up') +
    tile('Up', up.length, slow.length ? `<span class="warn">${slow.length} slow</span>` : partial.length ? `<span class="warn">${partial.length} partial</span>` : 'healthy', 'good') +
    tile('Down', down.length, down.length ? '<span class="bad">needs attention</span>' : blocked.length ? `<span class="warn">${blocked.length} blocked</span>` : 'none', down.length ? 'bad' : '') +
    (das.length
      ? tile('Avg DA', Math.round(das.reduce((a, b) => a + b, 0) / das.length), `avg response ${avg ?? '—'} ms`)
      : tile('Avg response', avg == null ? '—' : `${avg}<small> ms</small>`, `${pct(overall)} uptime 24h`));

  // filters
  const fc = { all: sites.length, wordpress: count('wordpress'), nextjs: count('nextjs'), other: count('other'), problems: sites.filter(isProblem).length };
  document.querySelectorAll('#filters button').forEach((btn) => {
    const f = btn.dataset.f;
    btn.classList.toggle('on', f === filter);
    btn.innerHTML = `${{ all: 'All', wordpress: 'WordPress', nextjs: 'Next.js', other: 'Other', problems: 'Problems' }[f]}<span class="count">${fc[f]}</span>`;
    btn.hidden = f === 'other' && !fc.other;
  });
  $('#sort').value = sort;

  renderList();
  renderEvents();
  renderFooter();
  notifyNewOutages(down);
}

function renderList() {
  const q = query.toLowerCase();
  const by = {
    status: (a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    response: (a, b) => (b.responseTime ?? -1) - (a.responseTime ?? -1),
    uptime: (a, b) => (a.uptime24h ?? 101) - (b.uptime24h ?? 101),
    da: (a, b) => (b.da?.value ?? -1) - (a.da?.value ?? -1),
  }[sort];
  const shown = data.sites
    .filter((s) => filter === 'all' || (filter === 'problems' ? isProblem(s) : typeKey(s.type) === filter))
    .filter((s) => !q || `${s.name} ${s.url} ${s.group} ${s.type}`.toLowerCase().includes(q))
    .sort(by);

  const head = `<div class="row head"><span></span><span>Site</span><span class="c-type">Type</span><span class="c-bars">Last 60 checks</span><span class="cell-r">Response</span><span class="cell-r c-up">Uptime</span><span class="cell-r c-da">DA</span><span class="cell-r c-ssl">SSL</span><span></span></div>`;
  $('#list').innerHTML = shown.length
    ? head + shown.map(rowHtml).join('')
    : `<div class="empty">${data.sites.length ? 'No sites match this filter.' : 'Add your sites to <code>sites.json</code> — the page updates automatically.'}</div>`;
}

function rowHtml(s) {
  const hist = s.history || [];
  const pad = '<i class="e"></i>'.repeat(Math.max(0, 60 - hist.length));
  const bars = pad + hist.map((h) => {
    const cls = h.ok === null ? 'b' : h.ok ? (h.slow ? 's' : '') : 'f';
    const t = `<b>${esc(fmtTime(h.t))}</b><br>${h.ok === null ? 'Blocked by Cloudflare' : h.ok ? `${h.ms} ms${h.slow ? ' (slow)' : ''}` : 'Failed'}`;
    return `<i class="${cls}" data-tip="${esc(t)}"></i>`;
  }).join('');
  const hc = healthCounts(s);
  const chips = (s.pages || []).map((p) => {
    const st = p.status === 'up' ? 'up' : p.status === 'down' ? 'down' : p.status === 'blocked' ? 'blocked' : p.status === 'paused' ? 'paused' : '';
    const t = `<b>${esc(p.name)}</b><br>${esc(p.url || 'not found yet')}<br>${p.status === 'up' ? `${p.ms} ms · HTTP ${p.code}` : esc(p.error || STATUS_LABEL[p.status] || p.status)}`;
    return `<span class="chip ${p.status === 'down' ? 'bad' : ''}" data-tip="${esc(t)}"><i class="${st}"></i>${esc(p.name.replace(' page', ''))}${p.status === 'up' && p.ms != null ? ` ${p.ms}ms` : ''}</span>`;
  }).join('');
  const healthChip = s.health
    ? `<span class="chip ${hc.fail ? 'bad' : hc.warn ? 'warnc' : ''}" data-tip="${esc(`<b>Health checks</b><br>${hc.pass} passed · ${hc.warn} warnings · ${hc.fail} failed${hc.unknown ? ` · ${hc.unknown} unknown` : ''}`)}"><i class="${hc.fail ? 'down' : hc.warn ? 'warn' : 'up'}"></i>Checks ${hc.pass}/${s.health.items.length}</span>`
    : '';
  const sub = s.paused
    ? '<div class="err warn">Monitoring paused — no checks or alerts</div>'
    : s.status === 'down'
    ? `<div class="err" title="${esc(s.error)}">${esc(s.error)} · down ${dur(Date.now() - (s.downSince || Date.now()))}</div>`
    : s.status === 'partial'
    ? `<div class="err" title="${esc(s.error)}">${esc(s.error)}</div>`
    : s.status === 'blocked'
    ? `<div class="err warn" title="${esc(s.error)}">Blocked by Cloudflare — allow the monitor's IP</div>`
    : '';
  const ssl = s.ssl?.daysLeft != null
    ? `<span data-tip="${esc(`<b>SSL certificate</b><br>Expires ${new Date(s.ssl.validTo).toLocaleDateString()}${s.ssl.issuer ? '<br>' + esc(s.ssl.issuer) : ''}`)}" style="color:${s.ssl.daysLeft <= 14 ? 'var(--warn)' : 'inherit'}">${s.ssl.daysLeft}d</span>`
    : '—';
  const da = typeof s.da?.value === 'number' ? `<span class="da" data-tip="${esc(`<b>Moz Domain Authority</b><br>${s.da.domain}${s.da.prev != null && s.da.prev !== s.da.value ? `<br>Previously ${s.da.prev}` : ''}`)}">${s.da.value}</span>` : '<span class="muted">—</span>';
  return `<div class="row ${s.status === 'down' ? 'is-down' : ''}" data-id="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(s.name)} details">
    <span class="dot ${s.paused ? 'paused' : s.status}" data-tip="${esc(STATUS_LABEL[s.paused ? 'paused' : s.status])}"></span>
    <div style="min-width:0"><div class="name">${esc(s.name)}</div><span class="url">${esc(s.url.replace(/^https?:\/\//, ''))}</span><div class="chips">${chips}${healthChip}</div>${sub}</div>
    <span class="c-type"><span class="badge ${typeKey(s.type)}">${esc(TYPE_LABEL[s.type] || s.type)}</span></span>
    <div class="bars c-bars">${bars}</div>
    <div class="cell-r">${s.responseTime != null && !s.paused ? s.responseTime + ' ms' : '—'}<small>${ago(s.lastCheck)}</small></div>
    <div class="cell-r c-up">${pct(s.uptime24h)}<small>${pct(s.uptime30d)} · 30d</small></div>
    <div class="cell-r c-da">${da}</div>
    <div class="cell-r c-ssl">${ssl}</div>
    <span class="chev">${I.chev}</span>
  </div>`;
}

function renderEvents() {
  const list = data.incidents.filter((i) =>
    evFilter === 'all' ? true : evFilter === 'outages' ? ['down', 'up', 'degraded', 'blocked'].includes(i.to) : i.to.startsWith('check')
  );
  $('#incidents').innerHTML = list.length
    ? list.slice(0, evLimit).map(eventHtml).join('')
    : '<li><span class="d">No events yet.</span></li>';
  $('#moreEvents').hidden = list.length <= evLimit;
  document.querySelectorAll('#evFilters button').forEach((b) => b.classList.toggle('on', b.dataset.e === evFilter));
}
const eventHtml = (i) =>
  `<li><time>${esc(fmtTime(i.t))}</time><span class="tag ${esc(i.to)}">${EVENT_LABEL[i.to] || esc(i.to.toUpperCase())}</span><span><b>${esc(i.name)}</b> <span class="d">${esc(i.detail)}</span></span></li>`;

function renderFooter() {
  const m = data.meta;
  $('#year').textContent = new Date().getFullYear();
  $('#fMon').innerHTML = [
    `Checks every <b>${data.intervalSec}s</b>`,
    `Down after <b>${data.failThreshold}</b> failed checks in a row`,
    `Slow above <b>${(data.slowThresholdMs / 1000).toFixed(1)}s</b>`,
    `Health &amp; SEO checks every <b>${m.healthIntervalHours}h</b>`,
  ].map((x) => `<li>${x}</li>`).join('');
  $('#fAlerts').innerHTML = [
    m.mailEnabled ? `<span class="on-dot"></span>Email alerts <b>on</b> · ${m.recipients} recipient${m.recipients === 1 ? '' : 's'}` : '<span class="off-dot"></span>Email alerts <b>off</b> — set SMTP_*',
    m.realertMinutes ? `Reminder every <b>${m.realertMinutes} min</b> while down` : 'No repeat reminders',
    m.mozEnabled ? '<span class="on-dot"></span>Domain Authority <b>on</b> (Moz)' : '<span class="off-dot"></span>Domain Authority off — set MOZ_API_TOKEN',
    `<button class="linkbtn" id="fTest">Send a test email</button>`,
  ].map((x) => `<li>${x}</li>`).join('');
  $('#fSys').innerHTML = [
    `Version <b>${esc(m.version)}</b>`,
    `Monitor running for <b>${data.startedAt ? dur(Date.now() - data.startedAt) : '—'}</b>`,
    `Last full check <b>${ago(data.lastRunAt)}</b>`,
    `Outgoing IP <b>${esc(m.outgoingIp || '—')}</b>`,
  ].map((x) => `<li>${x}</li>`).join('');
  $('#fTest').onclick = () => $('#testMail').click();
}

function notifyNewOutages(down) {
  const now = new Set(down.map((s) => s.id));
  if (lastDown && 'Notification' in window && Notification.permission === 'granted')
    for (const s of down) if (!lastDown.has(s.id)) new Notification(`🔴 ${s.name} is down`, { body: s.error || s.url, icon: '/favicon.svg' });
  lastDown = now;
}

// countdown to the next scheduled check
setInterval(() => {
  if (!data) return;
  const el = $('#nextCheck');
  if (data.checking) el.textContent = 'checking…';
  else if (data.nextRunAt) {
    const s = Math.max(0, Math.round((data.nextRunAt - Date.now()) / 1000));
    el.textContent = s ? `next check in ${s}s` : 'checking…';
  } else el.textContent = '';
}, 1000);
setInterval(() => { if (data) { renderList(); renderFooter(); } }, 15000); // refresh relative times

// ---------- list interactions ----------
$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  filter = b.dataset.f;
  store.set('filter', filter);
  render();
});
$('#sort').addEventListener('change', (e) => { sort = e.target.value; store.set('sort', sort); renderList(); });
$('#search').addEventListener('input', (e) => { query = e.target.value; renderList(); });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); $('#search').focus(); }
  if (e.key === 'Escape') { if (openId) closeDrawer(); menu.hidden = true; }
  if (e.key === 'Enter' && document.activeElement.classList.contains('row') && document.activeElement.dataset.id) openDrawer(document.activeElement.dataset.id);
});
$('#list').addEventListener('click', (e) => {
  const row = e.target.closest('.row[data-id]');
  if (row) openDrawer(row.dataset.id);
});
$('#evFilters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  evFilter = b.dataset.e;
  evLimit = 15;
  renderEvents();
});
$('#moreEvents').addEventListener('click', () => { evLimit += 25; renderEvents(); });

// ---------- drawer ----------
async function openDrawer(id) {
  openId = id;
  hideTip();
  $('#drawer').hidden = false;
  document.body.style.overflow = 'hidden';
  if (!detail || detail.id !== id) $('#drawerPanel').innerHTML = '<div class="d-head"><div class="d-title"><h3 id="dTitle">Loading…</h3></div></div>';
  history.replaceState(null, '', `#site=${encodeURIComponent(id)}`);
  await loadDetail();
}
function closeDrawer() {
  openId = null;
  detail = null;
  $('#drawer').hidden = true;
  document.body.style.overflow = '';
  hideTip();
  history.replaceState(null, '', location.pathname);
}
$('#drawerBg').addEventListener('click', closeDrawer);
async function loadDetail() {
  if (!openId) return;
  try {
    detail = await api(`/api/sites/${encodeURIComponent(openId)}`);
    renderDrawer();
  } catch (err) {
    if (openId) $('#drawerPanel').innerHTML = `<div class="d-head"><h3 id="dTitle">Could not load site</h3><p class="muted">${esc(err.message)}</p></div>`;
  }
}

function renderDrawer() {
  const s = detail;
  if (!s) return;
  const st = s.paused ? 'paused' : s.status;
  const hc = healthCounts(s);
  const scroll = $('#drawerPanel').scrollTop;
  const stat = (k, v, sub = '') => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  const daVal = typeof s.da?.value === 'number' ? s.da.value : '—';
  const daSub = typeof s.da?.value === 'number'
    ? `${s.da.spamScore != null ? `Spam score ${s.da.spamScore}% · ` : ''}${ago(s.da.checkedAt)}`
    : esc(s.da?.error || 'Not checked yet');

  $('#drawerPanel').innerHTML = `
    <div class="d-head">
      <div class="d-title">
        <span class="dot ${st}"></span>
        <h3 id="dTitle">${esc(s.name)}</h3>
        <span class="pill ${st}">${STATUS_LABEL[st]}</span>
        <button class="icon-btn" id="dClose" aria-label="Close">${I.x}</button>
      </div>
      <div class="d-sub">
        <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>
        <span class="badge ${typeKey(s.type)}">${esc(TYPE_LABEL[s.type] || s.type)}</span>
        ${s.group ? `<span class="badge">${esc(s.group)}</span>` : ''}
      </div>
      <div class="d-actions">
        <button class="btn primary" id="dCheck" ${s.paused ? 'disabled' : ''}>${I.refresh}Check now</button>
        <button class="btn" id="dHealth" ${s.paused ? 'disabled' : ''}>${I.stetho}Run health checks</button>
        <button class="btn ${s.paused ? '' : 'danger'}" id="dPause">${s.paused ? I.play + 'Resume monitoring' : I.pause + 'Pause (maintenance)'}</button>
        <a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener">${I.ext}Open site</a>
      </div>
    </div>
    <div class="d-body">
      ${s.status === 'down' || s.status === 'partial' ? `<div class="card" style="border-color:color-mix(in srgb,var(--down) 35%,transparent);background:var(--down-soft)"><b style="color:var(--down)">${s.status === 'down' ? 'Site is down' : 'A page is broken'}</b><div style="margin-top:4px">${esc(s.error)}</div>${s.downSince ? `<div class="muted" style="margin-top:2px">Since ${esc(fmtTime(s.downSince))} (${dur(Date.now() - s.downSince)})</div>` : ''}</div>` : ''}
      <div class="stats">
        ${stat('Response', s.responseTime != null ? `${s.responseTime}<small style="font-size:12px"> ms</small>` : '—', s.statusCode ? `HTTP ${s.statusCode} · ${ago(s.lastCheck)}` : ago(s.lastCheck))}
        ${stat('Avg 24h', s.avgResponse24h != null ? `${s.avgResponse24h}<small style="font-size:12px"> ms</small>` : '—', 'successful checks')}
        ${stat('Uptime 24h', pct(s.uptime24h), `7d ${pct(s.uptime7d)}`)}
        ${stat('Uptime 30d', pct(s.uptime30d), `${(s.hourly || []).reduce((n, b) => n + b.n, 0)} checks`)}
        ${stat('SSL', s.ssl?.daysLeft != null ? `${s.ssl.daysLeft}<small style="font-size:12px"> days</small>` : '—', s.ssl?.validTo ? `until ${new Date(s.ssl.validTo).toLocaleDateString()}` : esc(s.ssl?.error || ''))}
        ${stat('Domain Authority', daVal, daSub)}
        ${stat('Health checks', s.health ? `${hc.pass}/${s.health.items.length}` : '—', s.health ? `${hc.fail} failed · ${hc.warn} warnings` : 'running soon')}
        ${stat('Status since', s.lastChange ? ago(s.lastChange).replace(' ago', '') : '—', s.lastChange ? esc(fmtTime(s.lastChange)) : '')}
      </div>

      <div class="card">
        <h4>Pages checked <span>every ${data?.intervalSec || 60}s</span></h4>
        <div class="plist">${(s.pages || []).map((p) => `
          <div class="prow">
            <span class="dot ${p.status}" data-tip="${esc(STATUS_LABEL[p.status] || p.status)}" style="width:10px;height:10px"></span>
            <b>${esc(p.name)}</b>
            <span class="u">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url.replace(/^https?:\/\//, ''))}</a>` : '<span class="muted">Not found yet</span>'}</span>
            <span class="num muted">${p.ms != null ? `${p.ms} ms` : ''}${p.code ? ` · ${p.code}` : ''}</span>
            ${p.status !== 'up' && p.error ? `<span class="e">${esc(p.error)}</span>` : ''}
          </div>`).join('')}
        </div>
      </div>

      <div class="card">
        <h4><span style="text-transform:uppercase;letter-spacing:.05em;font-weight:700" id="rtTitle">Response time</span> <span class="legend-inline"><span><i style="background:var(--chart-line)"></i>Homepage response</span><span><i style="background:var(--down);border-radius:50%"></i>Failed check</span></span></h4>
        <div class="chart" id="rtChart"></div>
      </div>

      <div class="card">
        <h4>Uptime · last 30 days <span class="legend-inline"><span><i style="background:var(--up-bar)"></i>≥ 99.9%</span><span><i style="background:var(--warn)"></i>≥ 99%</span><span><i style="background:var(--down)"></i>&lt; 99%</span></span></h4>
        <div class="strip" id="strip"></div>
        <div class="strip-legend"><span>30 days ago</span><span>${pct(s.uptime30d)} overall</span><span>Today</span></div>
      </div>

      <div class="card">
        <h4>Health &amp; SEO checks <span>${s.health ? `last run ${ago(s.health.checkedAt)}` : 'not run yet'}</span></h4>
        ${s.health ? `<ul class="checks">${s.health.items.map((i) => `
          <li><span class="ic ${i.status}">${{ pass: I.check, warn: I.alert, fail: I.x, unknown: I.q }[i.status]}</span><span class="cn">${esc(i.name)}</span><span class="cd">${esc(i.detail)}</span></li>`).join('')}</ul>`
          : '<p class="muted" style="margin:0">Health checks run a few minutes after startup, then every few hours. Click “Run health checks” to run them now.</p>'}
      </div>

      <div class="card">
        <h4>Events for this site</h4>
        <ul class="events" style="margin:-4px -16px -16px">${(s.incidents || []).length ? s.incidents.slice(0, 25).map(eventHtml).join('') : '<li><span class="d">No events yet.</span></li>'}</ul>
      </div>
    </div>`;
  $('#drawerPanel').scrollTop = scroll;

  $('#dClose').onclick = closeDrawer;
  $('#dCheck').onclick = (e) => busy(e.currentTarget, () => api(`/api/sites/${s.id}/check`, { method: 'POST' }).then(loadDetail), 'Checked ✔');
  $('#dHealth').onclick = (e) => busy(e.currentTarget, () => api(`/api/sites/${s.id}/health`, { method: 'POST' }).then(loadDetail), 'Health checks finished');
  $('#dPause').onclick = (e) => {
    if (!s.paused && !confirm(`Pause monitoring for ${s.name}?\n\nNo checks will run and no alerts will be sent until you resume.`)) return;
    busy(e.currentTarget, () => api(`/api/sites/${s.id}/pause`, { method: 'POST', body: JSON.stringify({ paused: !s.paused }) }).then(loadDetail), s.paused ? 'Monitoring resumed' : 'Monitoring paused');
  };
  drawChart(s);
  drawStrip(s);
}

async function busy(btn, fn, okMsg) {
  btn.disabled = true;
  btn.classList.add('busy');
  try { await fn(); toast(okMsg); } catch (err) { toast(err.message); }
  btn.disabled = false;
  btn.classList.remove('busy');
}

// ---------- response time chart ----------
function niceMax(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}
function drawChart(s) {
  const el = $('#rtChart');
  const hist = (s.history || []).filter((h) => h.ms != null || h.ok === false);
  if (hist.length < 2) { el.innerHTML = '<p class="muted" style="margin:0">Not enough data yet — the chart fills in as checks run.</p>'; return; }
  const W = Math.max(320, el.clientWidth || 640), H = 200, L = 46, R = 10, T = 10, B = 26;
  // x range: the data we have, at least 1 hour, at most 24 hours
  const t1 = Date.now(), t0 = Math.max(t1 - 24 * 3600000, Math.min(hist[0].t, t1 - 3600000));
  const span = t1 - t0;
  const rt = $('#rtTitle');
  if (rt) rt.textContent = `Response time · last ${span > 23 * 3600000 ? '24 hours' : span >= 7200000 ? Math.round(span / 3600000) + ' hours' : Math.round(span / 60000) + ' min'}`;
  const okPts = hist.filter((h) => h.ok);
  const maxMs = niceMax(Math.max(...okPts.map((h) => h.ms), 100) * 1.1);
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (ms) => T + (1 - ms / maxMs) * (H - T - B);
  const gap = (data?.intervalSec || 60) * 1000 * 4;

  // line broken at failures / blocked checks / long gaps
  let d = '', area = '', prevT = null, seg = [];
  const flush = () => {
    if (seg.length > 1) area += `M${seg[0][0]},${H - B} ` + seg.map(([a, b]) => `L${a},${b}`).join(' ') + ` L${seg[seg.length - 1][0]},${H - B} Z `;
    seg = [];
  };
  for (const h of hist) {
    if (!h.ok) { prevT = null; flush(); continue; }
    const px = x(h.t).toFixed(1), py = y(h.ms).toFixed(1);
    d += `${prevT && h.t - prevT < gap ? 'L' : 'M'}${px},${py} `;
    if (!(prevT && h.t - prevT < gap)) flush();
    seg.push([px, py]);
    prevT = h.t;
  }
  flush();
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxMs * f));
  const step = [600000, 1800000, 3600000, 3 * 3600000, 6 * 3600000].find((s) => span / s <= 6) || 6 * 3600000;
  const xt = [];
  for (let h = Math.ceil(t0 / step) * step; h <= t1; h += step) xt.push(h);
  const slow = data?.slowThresholdMs;
  const fails = hist.filter((h) => h.ok === false);

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Response time over the last 24 hours">
    <g class="grid">${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>
    <g class="axis">${ticks.map((v) => `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 's' : v + 'ms'}</text>`).join('')}
      ${xt.map((t) => `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</text>`).join('')}</g>
    ${slow && slow < maxMs ? `<line class="slowline" x1="${L}" x2="${W - R}" y1="${y(slow)}" y2="${y(slow)}"/><text class="slowlabel" x="${W - R}" y="${y(slow) - 4}" text-anchor="end">slow (${slow / 1000}s)</text>` : ''}
    <path class="area" d="${area}"/>
    <path class="line" d="${d}"/>
    ${fails.map((h) => `<circle class="fail" cx="${x(h.t)}" cy="${H - B}" r="4.5"/>`).join('')}
    <line class="xhair" id="xh" y1="${T}" y2="${H - B}" visibility="hidden"/>
    <circle class="hdot" id="hd" r="4.5" visibility="hidden"/>
    <rect id="hit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/>
  </svg>`;

  const svg = el.querySelector('svg'), xh = svg.querySelector('#xh'), hd = svg.querySelector('#hd');
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = t0 + ((px - L) / (W - L - R)) * (t1 - t0);
    let best = hist[0];
    for (const h of hist) if (Math.abs(h.t - t) < Math.abs(best.t - t)) best = h;
    const bx = x(best.t);
    xh.setAttribute('x1', bx); xh.setAttribute('x2', bx); xh.setAttribute('visibility', 'visible');
    if (best.ok) { hd.setAttribute('cx', bx); hd.setAttribute('cy', y(best.ms)); hd.setAttribute('visibility', 'visible'); }
    else hd.setAttribute('visibility', 'hidden');
    showTip(`<b>${esc(fmtTime(best.t))}</b><br>${best.ok ? `${best.ms} ms${best.slow ? ' · slow' : ''}` : best.ok === null ? 'Blocked by Cloudflare' : 'Failed check'}`, e.clientX, e.clientY);
  };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('mouseleave', () => { xh.setAttribute('visibility', 'hidden'); hd.setAttribute('visibility', 'hidden'); hideTip(); });
}

function drawStrip(s) {
  const days = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 29; i >= 0; i--) days.push({ start: today.getTime() - i * 86400000, n: 0, ok: 0 });
  for (const b of s.hourly || []) {
    const d = days.find((x) => b.h >= x.start && b.h < x.start + 86400000);
    if (d) { d.n += b.n; d.ok += b.ok; }
  }
  $('#strip').innerHTML = days.map((d) => {
    const u = d.n ? (d.ok / d.n) * 100 : null;
    const cls = u == null ? '' : u >= 99.9 ? 'g' : u >= 99 ? 'w' : 'c';
    const label = new Date(d.start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return `<i class="${cls}" data-tip="${esc(`<b>${label}</b><br>${u == null ? 'No data' : `${pct(u)} uptime · ${d.n} checks${d.n - d.ok ? ` · ${d.n - d.ok} failed` : ''}`}`)}"></i>`;
  }).join('');
}
addEventListener('resize', () => { if (detail) drawChart(detail); });

// ---------- live connection ----------
function connect() {
  const es = new EventSource('/api/events');
  let lost;
  es.onopen = () => { clearTimeout(lost); $('#live').classList.add('on'); $('#liveText').textContent = 'Live'; };
  es.onmessage = (e) => {
    data = JSON.parse(e.data);
    render();
    if (openId) { clearTimeout(connect.t); connect.t = setTimeout(loadDetail, 400); }
  };
  // the server recycles the stream every ~100 s; only show a problem if reconnecting takes a while
  es.onerror = () => {
    clearTimeout(lost);
    lost = setTimeout(async () => {
      $('#live').classList.remove('on');
      $('#liveText').textContent = 'Reconnecting…';
      const r = await fetch('/api/me').catch(() => null);
      if (r && r.status === 401) location.href = '/login';
    }, 5000);
  };
}
connect();
const m = location.hash.match(/^#site=(.+)$/);
if (m) openDrawer(decodeURIComponent(m[1]));
