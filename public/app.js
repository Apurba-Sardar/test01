const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const TYPE_LABEL = { wordpress: 'WordPress', nextjs: 'Next.js' };
let data = null;
let filter = localStorage.getItem('filter') || 'all';
let query = '';
let lastDown = null; // skip notifications on first load

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
  if (m < 1) return 'less than a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 3000);
}
const typeKey = (t) => (t === 'wordpress' || t === 'nextjs' ? t : 'other');

function render() {
  if (!data) return;
  const sites = data.sites;
  const down = sites.filter((s) => s.status === 'down');
  const slow = sites.filter((s) => s.status === 'degraded');
  const blocked = sites.filter((s) => s.status === 'blocked');
  const up = sites.filter((s) => s.status === 'up' || s.status === 'degraded');
  const count = (t) => sites.filter((s) => typeKey(s.type) === t).length;
  const countDown = (t) => down.filter((s) => typeKey(s.type) === t).length;

  // banner
  const b = $('#banner');
  b.className = 'banner' + (down.length ? ' down' : slow.length || blocked.length ? ' warn' : '');
  $('#bannerTitle').textContent = !sites.length
    ? 'No sites configured yet — add them to sites.json'
    : down.length
    ? `${down.length} of ${sites.length} site${sites.length > 1 ? 's' : ''} down`
    : blocked.length
    ? `${up.length} up · ${blocked.length} can't be checked (blocked by Cloudflare)`
    : slow.length
    ? `All sites up · ${slow.length} responding slowly`
    : 'All systems operational';
  $('#bannerSub').textContent = down.length
    ? down.map((s) => s.name).join(', ')
    : blocked.length
    ? `Allow the monitor in Cloudflare for: ${blocked.map((s) => s.name).join(', ')} — see README`
    : `Checking every ${data.intervalSec}s · last update ${new Date(data.now).toLocaleTimeString()}`;
  document.title = down.length ? `(${down.length} down) Site Status` : 'Site Status';
  $('#favicon').href = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6' fill='${down.length ? '%23dc3b3b' : '%2322a06b'}'/></svg>`;

  // tiles
  const times = sites.filter((s) => s.responseTime != null && s.status !== 'down').map((s) => s.responseTime);
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
  const ups = sites.filter((s) => s.uptime24h != null).map((s) => s.uptime24h);
  const avgUp = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null;
  const tile = (k, v, s, cls = '') => `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  $('#tiles').innerHTML =
    tile('Total sites', sites.length, `${count('other')} other`) +
    tile('WordPress', count('wordpress'), countDown('wordpress') ? `<b style="color:var(--down)">${countDown('wordpress')} down</b>` : 'all up') +
    tile('Next.js', count('nextjs'), countDown('nextjs') ? `<b style="color:var(--down)">${countDown('nextjs')} down</b>` : 'all up') +
    tile('Up', up.length, slow.length ? `${slow.length} slow` : 'healthy', 'up') +
    tile('Down', down.length, down.length ? 'needs attention' : blocked.length ? `${blocked.length} blocked` : 'none', down.length ? 'down' : '') +
    tile('Avg response', avg == null ? '—' : `${avg}<small style="font-size:14px"> ms</small>`, avgUp == null ? '' : `${avgUp.toFixed(2)}% uptime 24h`);

  // filter counts
  const fc = { all: sites.length, wordpress: count('wordpress'), nextjs: count('nextjs'), other: count('other'), problems: down.length + slow.length + blocked.length };
  document.querySelectorAll('#filters button').forEach((btn) => {
    const f = btn.dataset.f;
    btn.classList.toggle('on', f === filter);
    btn.innerHTML = `${btn.textContent.replace(/\d+$/, '').trim()}<span class="count">${fc[f]}</span>`;
    btn.hidden = f === 'other' && !fc.other;
  });

  // list — problems first, then by name
  const order = { down: 0, blocked: 1, degraded: 2, pending: 3, up: 4 };
  const q = query.toLowerCase();
  const shown = sites
    .filter((s) => filter === 'all' || (filter === 'problems' ? ['down', 'degraded', 'blocked'].includes(s.status) : typeKey(s.type) === filter))
    .filter((s) => !q || (s.name + ' ' + s.url + ' ' + s.group).toLowerCase().includes(q))
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));

  const head = `<div class="row head"><span></span><span>Site</span><span class="c-type">Type</span><span class="c-bars">Last ${60} checks</span><span class="num">Response</span><span class="num c-up">Uptime 24h</span><span class="num c-ssl">SSL</span><span></span></div>`;
  $('#list').innerHTML = shown.length
    ? head +
      shown
        .map((s) => {
          const hist = s.history;
          const pad = Array(Math.max(0, 60 - hist.length)).fill('<i class="e"></i>').join('');
          const bars = pad + hist.map((h) => `<i class="${h.ok === null ? 'b' : h.ok ? (h.slow ? 's' : '') : 'f'}" title="${new Date(h.t).toLocaleString()} · ${h.ok === null ? 'blocked' : h.ok ? h.ms + ' ms' : 'failed'}"></i>`).join('');
          const ssl = s.ssl?.daysLeft != null ? `<span style="color:${s.ssl.daysLeft <= 14 ? 'var(--warn)' : 'inherit'}">${s.ssl.daysLeft}d</span>` : '—';
          const sub = s.status === 'down'
            ? `<div class="err" title="${esc(s.error)}">${esc(s.error)} · down ${dur(Date.now() - (s.downSince || Date.now()))}</div>`
            : s.status === 'blocked' ? `<div class="err warn" title="${esc(s.error)}">${esc(s.error)}</div>`
            : s.status === 'pending' && s.error ? `<div class="err">${esc(s.error)} (retrying)</div>` : '';
          return `<div class="row ${s.status === 'down' ? 'is-down' : ''}">
            <span class="dot ${s.status}" title="${s.status}"></span>
            <div style="min-width:0"><div class="name">${esc(s.name)}</div><a class="url" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>${sub}</div>
            <span class="c-type"><span class="badge ${typeKey(s.type)}">${esc(TYPE_LABEL[s.type] || s.type)}</span></span>
            <div class="bars c-bars">${bars}</div>
            <div class="num">${s.responseTime != null ? s.responseTime + ' ms' : '—'}<small>${ago(s.lastCheck)}</small></div>
            <div class="num c-up">${s.uptime24h == null ? '—' : s.uptime24h.toFixed(2) + '%'}</div>
            <div class="num c-ssl">${ssl}</div>
            <button class="recheck" data-id="${esc(s.id)}" title="Check now">↻</button>
          </div>`;
        })
        .join('')
    : `<div class="empty">${sites.length ? 'No sites match this filter.' : 'Add your sites to <code>sites.json</code> — the page updates automatically.'}</div>`;

  // incidents
  const lab = { down: 'DOWN', up: 'UP', degraded: 'SLOW', blocked: 'BLOCKED' };
  $('#incidents').innerHTML = data.incidents.length
    ? data.incidents
        .slice(0, 30)
        .map((i) => `<li><time>${new Date(i.t).toLocaleString()}</time><span class="tag ${i.to}">${lab[i.to] || i.to.toUpperCase()}</span><span><b>${esc(i.name)}</b> <span class="d">${esc(i.detail)}</span></span></li>`)
        .join('')
    : '<li class="d">No events yet.</li>';

  // browser notification on new outage
  const nowDown = new Set(down.map((s) => s.id));
  if (lastDown && 'Notification' in window && Notification.permission === 'granted')
    for (const s of down) if (!lastDown.has(s.id)) new Notification(`🔴 ${s.name} is down`, { body: s.error || s.url });
  lastDown = nowDown;
}

function connect() {
  const es = new EventSource('/api/events');
  let lost;
  es.onopen = () => { clearTimeout(lost); $('#live').classList.add('on'); $('#liveText').textContent = 'Live'; };
  es.onmessage = (e) => { data = JSON.parse(e.data); render(); };
  // the server recycles the stream every ~100 s; only show a problem if reconnecting takes a while
  es.onerror = () => {
    clearTimeout(lost);
    lost = setTimeout(() => { $('#live').classList.remove('on'); $('#liveText').textContent = 'Reconnecting…'; }, 5000);
  };
}

$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  filter = b.dataset.f;
  try { localStorage.setItem('filter', filter); } catch {}
  render();
});
$('#search').addEventListener('input', (e) => { query = e.target.value; render(); });
$('#list').addEventListener('click', async (e) => {
  const b = e.target.closest('.recheck');
  if (!b) return;
  b.classList.add('spin');
  try { await fetch(`/api/check/${b.dataset.id}`, { method: 'POST' }); } finally { b.classList.remove('spin'); }
});
$('#checkAll').addEventListener('click', async () => {
  await fetch('/api/check-all', { method: 'POST' });
  toast('Checking all sites…');
});
$('#testMail').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const r = await (await fetch('/api/test-email', { method: 'POST' })).json();
    toast(r.sent ? 'Test email sent ✔' : r.skipped ? 'Email not configured — set SMTP_* in .env' : `Email failed: ${r.error}`);
  } finally { e.target.disabled = false; }
});
document.addEventListener('click', () => { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }, { once: true });

setInterval(render, 5000); // refresh "x seconds ago" labels
connect();
