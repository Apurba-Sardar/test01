// Slower "health" checks that run every few hours per site (SEO / config problems that
// don't take a site offline but quietly hurt it), plus article discovery and Moz DA.
import crypto from 'node:crypto';
import { config } from './config.js';

const UA = 'InternalStatusMonitor/1.0';

const CHALLENGE = ['Attention Required! | Cloudflare', '<title>Just a moment...</title>', 'challenge-platform', 'cf-chl-'];
const challenged = (res, body = '') =>
  res.headers.get('cf-mitigated') === 'challenge' || ([403, 429, 503].includes(res.status) && CHALLENGE.some((m) => body.includes(m)));

async function get(url, { redirect = 'follow', timeout = 15000, method = 'GET' } = {}) {
  const res = await fetch(url, {
    method,
    redirect,
    signal: AbortSignal.timeout(timeout),
    headers: { 'user-agent': UA, ...(config.monitorToken ? { 'x-status-monitor': config.monitorToken } : {}) },
  });
  const body = method === 'HEAD' || redirect === 'manual' ? '' : await res.text();
  return { res, body, blocked: challenged(res, body) };
}

const origin = (u) => new URL(u).origin;
/** Naive registrable domain (last two labels). Fine for .com/.help/.family etc. */
export const rootDomain = (u) => new URL(u).hostname.split('.').slice(-2).join('.');

const item = (key, name, status, detail) => ({ key, name, status, detail });
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[e]);
const BLOCKED = 'Blocked by bot protection — allow the monitor in Cloudflare';

// ---------- article discovery ----------

/** Find a recent article URL: WordPress REST API, then sitemap, then a link on the homepage. */
export async function discoverArticle(site) {
  const base = origin(site.url);
  if (site.type === 'wordpress') {
    try {
      const { res, body } = await get(`${base}/wp-json/wp/v2/posts?per_page=1&_fields=link`);
      if (res.ok) {
        const link = JSON.parse(body)?.[0]?.link;
        if (link) return link;
      }
    } catch {}
  }
  try {
    const url = await sitemapArticle(base);
    if (url) return url;
  } catch {}
  try {
    const { res, body } = await get(site.url);
    if (res.ok) {
      const links = [...body.matchAll(/href="([^"#?]+)"/g)].map((m) => {
        try { return new URL(m[1], site.url); } catch { return null; }
      });
      const pick = links.find((l) => l && l.origin === new URL(res.url).origin && /\/[a-z0-9]+(-[a-z0-9]+){2,}\/?$/i.test(l.pathname));
      if (pick) return pick.href;
    }
  } catch {}
  return null;
}

async function sitemapArticle(base) {
  const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>(?:[\s\S]*?<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => ({ loc: m[1], mod: m[2] || '' }));
  for (const path of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']) {
    const { res, body } = await get(base + path);
    if (!res.ok) continue;
    if (body.includes('<sitemapindex')) {
      const children = locs(body);
      const child = children.find((c) => /post|article|blog|news/i.test(c.loc)) || children[0];
      if (!child) continue;
      const r2 = await get(child.loc);
      if (!r2.res.ok) continue;
      return newestPage(locs(r2.body), base);
    }
    if (body.includes('<urlset')) return newestPage(locs(body), base);
  }
  return null;
}

function newestPage(list, base) {
  const SKIP = /\/(privacy|terms|cookie|polic(y|ies)|refund|shipping|imprint|contact|about|login|sign-?in|sign-?up|register|cart|checkout|account|tag|category|author|search|faq|pricing|disclaimer|legal|sitemap)(\/|-|$)/i;
  const pages = list.filter((x) => { try { const p = new URL(x.loc).pathname; return p.length > 1 && !SKIP.test(p); } catch { return false; } });
  const score = (x) => (/(\/blog\/|\/article|\/post|\/news\/|\/\d{4}\/)/i.test(x.loc) ? 2 : 0) + (/[a-z0-9]+(-[a-z0-9]+){2,}\/?$/i.test(x.loc) ? 1 : 0);
  pages.sort((a, b) => score(b) - score(a) || (b.mod || '').localeCompare(a.mod || ''));
  return pages[0]?.loc || null;
}

// ---------- robots.txt (Google-style: merge groups for the agent, longest match wins, tie → allow) ----------
function robotsRulesFor(body, agent) {
  const rules = [];
  let agents = [], inRules = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase(), val = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (inRules) { agents = []; inRules = false; }
      agents.push(val.toLowerCase());
    } else if (key === 'allow' || key === 'disallow') {
      inRules = true;
      if (agents.includes(agent) && !(key === 'disallow' && val === '')) rules.push({ allow: key === 'allow', path: val });
    }
  }
  return rules;
}
function robotsAllows(rules, path) {
  let best = null;
  for (const r of rules) {
    const re = new RegExp('^' + r.path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$|\$$/, '$'));
    if (!re.test(path)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}

// ---------- RDAP (domain expiry) via the IANA bootstrap registry ----------
let rdapBootstrap = null;
const domainCache = new Map();
async function rdapBase(domain) {
  if (!rdapBootstrap || Date.now() - rdapBootstrap.at > 86400000) {
    try {
      const r = await fetch('https://data.iana.org/rdap/dns.json', { signal: AbortSignal.timeout(15000) });
      if (r.ok) rdapBootstrap = { at: Date.now(), services: (await r.json()).services };
    } catch {}
  }
  const tld = domain.split('.').pop();
  const svc = rdapBootstrap?.services.find((s) => s[0].includes(tld));
  return svc?.[1]?.[0] || 'https://rdap.org/';
}

// ---------- health checks ----------

export async function runHealthChecks(site, sslInfo) {
  const base = origin(site.url);
  const items = [];
  const safe = async (fn) => { try { await fn(); } catch (e) { /* recorded by fn when possible */ } };

  // Homepage HTML (used by several checks)
  let home = null;
  try { home = await get(site.url); } catch {}
  const homeBlocked = !home || home.blocked;

  // 1. HTTPS redirect
  await safe(async () => {
    try {
      const { res } = await get(site.url.replace(/^https:/, 'http:'), { redirect: 'manual' });
      const loc = res.headers.get('location') || '';
      if (res.headers.get('cf-mitigated') || ([403, 503].includes(res.status) && /cloudflare/i.test(res.headers.get('server') || '')))
        return items.push(item('https', 'HTTP → HTTPS redirect', 'unknown', BLOCKED));
      if (res.status >= 300 && res.status < 400 && loc.startsWith('https:')) items.push(item('https', 'HTTP → HTTPS redirect', 'pass', `${res.status} to HTTPS`));
      else if (res.status >= 300 && res.status < 400) items.push(item('https', 'HTTP → HTTPS redirect', 'warn', `Redirects to ${loc || 'unknown'}`));
      else items.push(item('https', 'HTTP → HTTPS redirect', 'warn', `HTTP version answers ${res.status} without redirecting`));
    } catch (e) { items.push(item('https', 'HTTP → HTTPS redirect', 'unknown', e.message)); }
  });

  // 2. SSL certificate (data from the main check)
  if (site.url.startsWith('https://')) {
    const d = sslInfo?.daysLeft;
    items.push(
      d == null ? item('ssl', 'SSL certificate', 'unknown', sslInfo?.error || 'Not checked yet')
      : d <= 3 ? item('ssl', 'SSL certificate', 'fail', `Expires in ${d} days`)
      : d <= config.sslWarnDays ? item('ssl', 'SSL certificate', 'warn', `Expires in ${d} days`)
      : item('ssl', 'SSL certificate', 'pass', `Valid for ${d} more days${sslInfo.issuer ? ' · ' + sslInfo.issuer : ''}`)
    );
  }

  // 3. Domain expiry (RDAP) — cached for a day per domain
  await safe(async () => {
    const domain = rootDomain(site.url);
    const cached = domainCache.get(domain);
    if (cached && Date.now() - cached.at < 86400000) return items.push(cached.item);
    let res = null, lastErr = '';
    for (const base of [await rdapBase(domain), 'https://rdap.org/']) {
      try {
        const r = await fetch(`${base.replace(/\/?$/, '/')}domain/${domain}`, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/rdap+json', 'user-agent': UA } });
        if (r.ok) { res = await r.json(); break; }
        lastErr = `HTTP ${r.status} from ${new URL(base).hostname}`;
      } catch (e) { lastErr = e.message; }
    }
    if (!res) return items.push(item('domain', 'Domain expiry', 'unknown', `Registry lookup failed (${lastErr})`));
    const exp = (res.events || []).find((e) => e.eventAction === 'expiration')?.eventDate;
    if (!exp) return items.push(item('domain', 'Domain expiry', 'unknown', 'Registry does not publish an expiry date'));
    const days = Math.floor((new Date(exp) - Date.now()) / 86400000);
    const it = item('domain', 'Domain expiry', days <= 7 ? 'fail' : days <= 30 ? 'warn' : 'pass', `${domain} expires ${exp.slice(0, 10)} (${days} days)`);
    domainCache.set(domain, { at: Date.now(), item: it });
    items.push(it);
  });

  // 4. robots.txt
  let sitemapsFromRobots = [];
  await safe(async () => {
    try {
      const { res, body, blocked } = await get(base + '/robots.txt');
      if (blocked) return items.push(item('robots', 'robots.txt', 'unknown', BLOCKED));
      if (res.status === 404) return items.push(item('robots', 'robots.txt', 'warn', 'No robots.txt found'));
      if (!res.ok) return items.push(item('robots', 'robots.txt', 'warn', `HTTP ${res.status}`));
      sitemapsFromRobots = [...body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
      const rules = robotsRulesFor(body, '*');
      const homePath = new URL(home?.res?.url || site.url).pathname || '/';
      const homeAllowed = robotsAllows(rules, homePath);
      const allows = rules.filter((r) => r.allow && r.path && r.path !== '/').length;
      const blocksRoot = rules.some((r) => !r.allow && r.path === '/') && !rules.some((r) => r.allow && r.path === '/');
      if (!homeAllowed && !allows) items.push(item('robots', 'robots.txt', 'fail', 'Blocks all search engines (Disallow: /)'));
      else if (!homeAllowed) items.push(item('robots', 'robots.txt', 'fail', `Homepage is blocked for search engines (only ${allows} path rule(s) allowed)`));
      else if (blocksRoot) items.push(item('robots', 'robots.txt', 'warn', `Homepage allowed, but most paths are blocked (Disallow: / with ${allows} Allow rule(s))`));
      else items.push(item('robots', 'robots.txt', 'pass', `Search engines allowed${sitemapsFromRobots.length ? ` · lists ${sitemapsFromRobots.length} sitemap(s)` : ''}`));
    } catch (e) { items.push(item('robots', 'robots.txt', 'unknown', e.message)); }
  });

  // 5. Sitemap
  await safe(async () => {
    const candidates = [...new Set([...sitemapsFromRobots, base + '/sitemap.xml', base + '/sitemap_index.xml', ...(site.type === 'wordpress' ? [base + '/wp-sitemap.xml'] : [])])];
    let sawBlock = false;
    for (const u of candidates.slice(0, 5)) {
      try {
        const { res, body, blocked } = await get(u);
        if (blocked) { sawBlock = true; continue; }
        if (res.ok && (body.includes('<urlset') || body.includes('<sitemapindex'))) {
          const n = (body.match(/<loc>/g) || []).length;
          return items.push(item('sitemap', 'XML sitemap', 'pass', `${new URL(u).pathname} · ${n} ${body.includes('<sitemapindex') ? 'sitemaps' : 'URLs'}`));
        }
      } catch {}
    }
    items.push(sawBlock ? item('sitemap', 'XML sitemap', 'unknown', BLOCKED) : item('sitemap', 'XML sitemap', 'warn', 'No sitemap found'));
  });

  // 6–8. Homepage SEO basics + static files
  if (homeBlocked) {
    items.push(item('index', 'Search engine indexing', 'unknown', home ? BLOCKED : 'Homepage did not load'));
    items.push(item('meta', 'Title & description', 'unknown', home ? BLOCKED : 'Homepage did not load'));
    items.push(item('assets', 'CSS / JS files load', 'unknown', home ? BLOCKED : 'Homepage did not load'));
  } else {
    const html = home.body;
    const metaRobots = (html.match(/<meta[^>]+name=["']robots["'][^>]*>/i) || [''])[0];
    const header = home.res.headers.get('x-robots-tag') || '';
    items.push(/noindex/i.test(metaRobots) || /noindex/i.test(header)
      ? item('index', 'Search engine indexing', 'fail', `Homepage is set to noindex${/noindex/i.test(header) ? ' (X-Robots-Tag header)' : ' (meta robots tag)'}`)
      : item('index', 'Search engine indexing', 'pass', 'Homepage is indexable'));

    const title = decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim();
    const desc = /<meta[^>]+name=["']description["'][^>]+content=["'][^"']+/i.test(html) || /<meta[^>]+content=["'][^"']+["'][^>]+name=["']description["']/i.test(html);
    items.push(!title ? item('meta', 'Title & description', 'fail', 'Homepage has no <title>')
      : !desc ? item('meta', 'Title & description', 'warn', `No meta description · title: "${title.slice(0, 60)}"`)
      : item('meta', 'Title & description', 'pass', `"${title.slice(0, 70)}"`));

    await safe(async () => {
      const srcs = [...html.matchAll(/<(?:script[^>]+src|link[^>]+rel=["']stylesheet["'][^>]+href)=["']([^"']+)["']/gi)].map((m) => m[1]).filter((s) => !s.startsWith('data:'));
      if (!srcs.length) return items.push(item('assets', 'CSS / JS files load', 'pass', 'No external files to check'));
      const sample = srcs.slice(0, 3).map((s) => new URL(s.replace(/&amp;/g, '&'), home.res.url).href);
      const bad = [];
      for (const u of sample) {
        try { const { res } = await get(u); if (!res.ok) bad.push(`${new URL(u).pathname} → ${res.status}`); } catch (e) { bad.push(`${new URL(u).pathname} → ${e.message}`); }
      }
      items.push(bad.length ? item('assets', 'CSS / JS files load', 'fail', bad.join(', ')) : item('assets', 'CSS / JS files load', 'pass', `${sample.length} file(s) OK`));
    });
  }

  // 9–10. WordPress specifics
  if (site.type === 'wordpress') {
    await safe(async () => {
      try {
        const { res, body, blocked } = await get(base + '/wp-json/');
        if (blocked) return items.push(item('wpapi', 'WordPress REST API', 'unknown', BLOCKED));
        let ok = false; try { ok = res.ok && !!JSON.parse(body).name; } catch {}
        items.push(ok ? item('wpapi', 'WordPress REST API', 'pass', 'wp-json responds') : item('wpapi', 'WordPress REST API', 'fail', `wp-json returned HTTP ${res.status}`));
      } catch (e) { items.push(item('wpapi', 'WordPress REST API', 'fail', e.message)); }
    });
    await safe(async () => {
      try {
        const { res, body, blocked } = await get(base + '/feed/');
        if (blocked) return items.push(item('feed', 'RSS feed', 'unknown', BLOCKED));
        const n = (body.match(/<item>/g) || []).length;
        items.push(res.ok && /<rss|<feed/.test(body) ? item('feed', 'RSS feed', 'pass', `${n} item(s)`) : item('feed', 'RSS feed', 'warn', `HTTP ${res.status}`));
      } catch (e) { items.push(item('feed', 'RSS feed', 'warn', e.message)); }
    });
  }

  return { checkedAt: Date.now(), items };
}

// ---------- Moz Domain Authority ----------

const findKey = (obj, key) => {
  if (!obj || typeof obj !== 'object') return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) { const r = findKey(v, key); if (r !== undefined) return r; }
  return undefined;
};

export async function fetchDomainAuthority(url) {
  if (!config.mozToken) return { error: 'Set MOZ_API_TOKEN to show DA', checkedAt: Date.now() };
  const domain = rootDomain(url);
  const r = await fetch('https://api.moz.com/jsonrpc', {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'x-moz-token': config.mozToken, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: 'data.site.metrics.fetch', params: { data: { site_query: { query: domain, scope: 'domain' } } } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) return { error: j.error?.message || `Moz API HTTP ${r.status}`, checkedAt: Date.now() };
  const da = findKey(j.result, 'domain_authority');
  const spam = findKey(j.result, 'spam_score');
  if (typeof da !== 'number') return { error: 'Moz response had no domain_authority', checkedAt: Date.now() };
  return { value: Math.round(da), spamScore: typeof spam === 'number' ? spam : null, domain, checkedAt: Date.now() };
}
