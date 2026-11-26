// Slower "health" checks that run every few hours per site (SEO / config problems that
// don't take a site offline but quietly hurt it), plus article discovery and Moz DA.
import crypto from 'node:crypto';
import { config } from './config.js';

const UA = 'InternalStatusMonitor/1.0';
// Ad networks (Ezoic, etc.) and some tag setups only add their code for real browsers, so tag checks look like one.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const CHALLENGE = ['Attention Required! | Cloudflare', '<title>Just a moment...</title>', 'challenge-platform', 'cf-chl-'];
const challenged = (res, body = '') =>
  res.headers.get('cf-mitigated') === 'challenge' || ([403, 429, 503].includes(res.status) && CHALLENGE.some((m) => body.includes(m)));

async function get(url, { redirect = 'follow', timeout = 15000, method = 'GET', ua = UA } = {}) {
  const res = await fetch(url, {
    method,
    redirect,
    signal: AbortSignal.timeout(timeout),
    headers: { 'user-agent': ua, ...(ua === BROWSER_UA ? { accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' } : {}), ...(config.monitorToken ? { 'x-status-monitor': config.monitorToken } : {}) },
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

export async function runHealthChecks(site, sslInfo, { articleUrl = null, tagSeen = {} } = {}) {
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
    const it = { ...item('domain', 'Domain expiry', days <= 7 ? 'fail' : days <= 30 ? 'warn' : 'pass', `${domain} expires ${exp.slice(0, 10)} (${days} days)`), data: { domain, expires: exp, days } };
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

  // 11–13. Analytics tags, ad scripts and ads.txt
  const tracking = await trackingChecks(site, home, homeBlocked, articleUrl, tagSeen);
  items.push(...tracking.items);

  // 14–17. Domain email setup (MX, SPF, DMARC, DKIM)
  items.push(...(await emailChecks(site)));

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

  return { checkedAt: Date.now(), items, tags: tracking.tags, tagSeen: tracking.tagSeen };
}

// ---------- Moz Domain Authority ----------

const findKey = (obj, key) => {
  if (!obj || typeof obj !== 'object') return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) { const r = findKey(v, key); if (r !== undefined) return r; }
  return undefined;
};

// Moz's free plan allows about one request every 10 seconds.
let lastMozCall = 0;
const MOZ_GAP_MS = 11000;

export async function fetchDomainAuthority(url) {
  if (!config.mozToken) return { error: 'Set MOZ_API_TOKEN to show DA', noToken: true, checkedAt: Date.now() };
  const domain = rootDomain(url);
  const wait = lastMozCall + MOZ_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastMozCall = Date.now();
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


// ---------- analytics & ads ----------

const TAG_MEMORY_MS = 7 * 86400000; // a tag seen in the last 7 days is expected to still be there
const AD_NETWORKS = [
  // name, how to recognise it, script host to test-load
  ['Google AdSense', /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js|adsbygoogle/i, /pagead2\.googlesyndication\.com/],
  ['Google Ad Manager', /securepubads\.g\.doubleclick\.net|googletag\.pubads\(/i, /securepubads\.g\.doubleclick\.net/],
  ['Ezoic', /ezojs\.com|ezoic\.net|ezodn\.com|ezoicAnalytics|ezstandalone/i, /ezojs\.com|ezoic\.net|ezodn\.com/],
  ['Mediavine', /scripts\.mediavine\.com/i, /scripts\.mediavine\.com/],
  ['Raptive', /ads\.adthrive\.com|raptive/i, /ads\.adthrive\.com/],
  ['Taboola', /cdn\.taboola\.com/i, /cdn\.taboola\.com/],
  ['Outbrain', /widgets\.outbrain\.com/i, /widgets\.outbrain\.com/],
  ['Monumetric', /monu\.delivery/i, /monu\.delivery/],
  ['Freestar', /a\.pub\.network/i, /a\.pub\.network/],
  ['Media.net', /contextual\.media\.net/i, /contextual\.media\.net/],
  ['Amazon Publisher Services', /c\.amazon-adsystem\.com/i, /c\.amazon-adsystem\.com/],
  ['Adnimation', /adncdn\.net|adnimation\.com/i, /adncdn\.net|adnimation\.com/],
  ['AdPushup', /cdn\.adpushup\.com/i, /cdn\.adpushup\.com/],
  ['Playwire', /cdn\.intergient\.com|playwire/i, /cdn\.intergient\.com/],
  ['Snigel', /cdn\.snigelweb\.com/i, /cdn\.snigelweb\.com/],
  ['Setupad', /stpd\.cloud|setupad/i, /stpd\.cloud/],
  ['Clickio', /clickiocdn\.com/i, /clickiocdn\.com/],
  ['Primis', /live\.primis\.tech/i, /live\.primis\.tech/],
  ['Sortable', /tags\.deployads\.com/i, /tags\.deployads\.com/],
];

/** Find GA4 / GTM / ad networks in the homepage, the article page and the site's own JS bundles. */
async function trackingChecks(site, home, homeBlocked, articleUrl, tagSeen) {
  const items = [];
  const now = Date.now();
  const seenPrev = { ...tagSeen };
  if (homeBlocked) {
    const u = (k, n) => item(k, n, 'unknown', home ? BLOCKED : 'Homepage did not load');
    return { items: [u('analytics', 'Analytics tag'), u('ads', 'Ad scripts')], tags: null, tagSeen: seenPrev };
  }
  // sources: homepage + article HTML (fetched as a browser) + up to 3 same-origin JS bundles (for app-style sites
  // that inject tags in JS)
  try { const hb = await get(site.url, { ua: BROWSER_UA }); if (hb.res.ok && !hb.blocked) home = hb; } catch {}
  const sources = [home.body];
  if (articleUrl) { try { const a = await get(articleUrl, { ua: BROWSER_UA }); if (a.res.ok && !a.blocked) sources.push(a.body); } catch {} }
  const scriptUrls = [...home.body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => { try { return new URL(m[1].replace(/&amp;/g, '&'), home.res.url); } catch { return null; } }).filter(Boolean);
  for (const u of scriptUrls.filter((u) => u.origin === new URL(home.res.url).origin && /\.m?js($|\?)/.test(u.pathname + u.search)).slice(0, 3)) {
    try { const r = await get(u.href, { timeout: 20000, ua: BROWSER_UA }); if (r.res.ok) sources.push(r.body.slice(0, 4_000_000)); } catch {}
  }
  const all = sources.join('\n');
  const hasGtagContext = /gtag|googletagmanager|google-analytics/i.test(all);
  const ga4 = hasGtagContext ? [...new Set([...all.matchAll(/['"=\s(,](G-[A-Z0-9]{8,12})\b/g)].map((m) => m[1]))] : [];
  const gtm = [...new Set([...all.matchAll(/\b(GTM-[A-Z0-9]{5,9})\b/g)].map((m) => m[1]))];
  const ads = AD_NETWORKS.filter(([, re]) => re.test(all)).map(([n]) => n);
  const pubIds = [...new Set([...all.matchAll(/\bca-(pub-\d{10,20})\b/g)].map((m) => m[1]))];
  // IDs used to actually serve AdSense ads (script client= / data-ad-client); others are e.g. the site-verification meta tag
  const servingPubIds = [...new Set([...all.matchAll(/(?:client=|data-ad-client=["']|google_ad_client\s*[:=]\s*["'])ca-(pub-\d{10,20})/g)].map((m) => m[1]))];

  // remember what we saw; anything seen in the last 7 days but missing now is a regression
  const found = [...ga4.map((x) => `ga:${x}`), ...gtm.map((x) => `gtm:${x}`), ...ads.map((x) => `ads:${x}`)];
  const tagSeenNext = Object.fromEntries(Object.entries(seenPrev).filter(([, t]) => now - t < TAG_MEMORY_MS));
  for (const k of found) tagSeenNext[k] = now;
  const missing = Object.keys(seenPrev).filter((k) => now - seenPrev[k] < TAG_MEMORY_MS && !found.includes(k));

  // test-load the tag scripts themselves
  const loadCheck = async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': BROWSER_UA } }); await r.arrayBuffer(); return r.ok ? null : `HTTP ${r.status}`; } catch (e) { return e.message; } };
  const gaProblems = [];
  for (const id of ga4.slice(0, 2)) { const e = await loadCheck(`https://www.googletagmanager.com/gtag/js?id=${id}`); if (e) gaProblems.push(`${id} script not loading (${e})`); }
  for (const id of gtm.slice(0, 2)) { const e = await loadCheck(`https://www.googletagmanager.com/gtm.js?id=${id}`); if (e) gaProblems.push(`${id} container not loading (${e}) — is it published?`); }
  const adProblems = [];
  for (const [name, , host] of AD_NETWORKS.filter(([n]) => ads.includes(n))) {
    const src = scriptUrls.find((u) => host.test(u.hostname));
    if (!src) continue; // loaded dynamically; presence was detected in the code
    const e = await loadCheck(src.href);
    if (e) adProblems.push(`${name} script not loading (${e})`);
  }

  // Analytics item
  const gaMissing = missing.filter((k) => k.startsWith('ga:') || k.startsWith('gtm:')).map((k) => k.split(':')[1]);
  const gaFound = [...ga4, ...gtm];
  items.push(
    gaMissing.length ? item('analytics', 'Analytics tag', 'fail', `Tag disappeared: ${gaMissing.join(', ')} (was on the site in the last 7 days)`)
    : gaProblems.length ? item('analytics', 'Analytics tag', 'fail', gaProblems.join('; '))
    : gaFound.length ? item('analytics', 'Analytics tag', 'pass', `${gaFound.join(', ')} · loading`)
    : item('analytics', 'Analytics tag', 'warn', 'No Google Analytics 4 or Tag Manager tag found')
  );

  // Ads item (sites.json "ads": true means the site must have ads)
  const adMissing = missing.filter((k) => k.startsWith('ads:')).map((k) => k.split(':')[1]);
  items.push(
    adMissing.length ? item('ads', 'Ad scripts', 'fail', `Ad code disappeared: ${adMissing.join(', ')} (was on the site in the last 7 days)`)
    : adProblems.length ? item('ads', 'Ad scripts', 'fail', adProblems.join('; '))
    : ads.length ? item('ads', 'Ad scripts', 'pass', `${ads.join(', ')}${pubIds.length ? ` · ${pubIds.join(', ')}` : ''} · loading`)
    : site.ads ? item('ads', 'Ad scripts', 'fail', 'No ad network code found, but this site is set to have ads')
    : item('ads', 'Ad scripts', 'pass', 'No ad networks on this site')
  );

  // ads.txt — required for ad networks to pay for impressions
  let adsTxt = null;
  const expectAds = ads.length || adMissing.length || site.ads;
  try {
    const { res, body, blocked } = await get(new URL('/ads.txt', home.res.url).href);
    const valid = res.ok && !blocked && !/<html/i.test(body.slice(0, 500)) && /,\s*(DIRECT|RESELLER)/i.test(body);
    if (blocked) { if (expectAds) items.push(item('adstxt', 'ads.txt', 'unknown', BLOCKED)); }
    else if (!valid) { if (expectAds) items.push(item('adstxt', 'ads.txt', 'fail', `ads.txt missing (HTTP ${res.status}) — ad networks may not pay for impressions`)); }
    else {
      const lines = body.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes(',')).length;
      const manager = body.match(/^\s*MANAGERDOMAIN\s*=\s*([^\s#]+)/im)?.[1] || null;
      const listed = (id) => body.toLowerCase().includes(id.toLowerCase());
      const missingServing = servingPubIds.filter((id) => !listed(id));
      const missingOther = pubIds.filter((id) => !servingPubIds.includes(id) && !listed(id));
      adsTxt = { lines, manager, url: res.url };
      const via = `${lines} seller line${lines === 1 ? '' : 's'}${manager ? ` · managed by ${manager}` : ''}`;
      items.push(
        missingServing.length ? item('adstxt', 'ads.txt', 'fail', `ads.txt (${via}) doesn't list ${missingServing.join(', ')}, which serves AdSense ads on this site — those impressions may not be paid`)
        : missingOther.length ? item('adstxt', 'ads.txt', 'warn', `${via} · AdSense account ${missingOther.join(', ')} (site verification tag) isn't listed — add "google.com, ${missingOther[0]}, DIRECT, f08c47fec0942fa0" if AdSense ads run directly`)
        : item('adstxt', 'ads.txt', 'pass', via)
      );
      // a monetised site (has ads.txt) where no ad code shows up: ads may not be loading
      if (!ads.length && !adMissing.length) {
        const i = items.findIndex((x) => x.key === 'ads');
        items[i] = item('ads', 'Ad scripts', 'warn', `ads.txt is set up (${via}) but no ad code was found on the site — check that ads are loading`);
      }
    }
  } catch (e) { if (expectAds) items.push(item('adstxt', 'ads.txt', 'unknown', e.message)); }
  return { items, tags: { ga4, gtm, ads, pubIds, adsTxt, checkedAt: now }, tagSeen: tagSeenNext };
}

// ---------- domain email setup (DNS over HTTPS, cached 6 h per domain) ----------

const emailCache = new Map();
const DKIM_SELECTORS = ['google', 'default', 'selector1', 'selector2', 'k1', 'k2', 's1', 's2', 'mail', 'dkim', 'smtp', 'hostingermail-a', 'hostingermail-b', 'hostingermail-c', 'hostingermail1', 'titan1', 'zmail', 'zoho', 'mxvault', 'protonmail', 'fm1', 'mandrill', 'resend', 'everlytickey1', 'cm'];

async function doh(name, type) {
  const typeNum = { MX: 15, TXT: 16 }[type];
  for (const u of [`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`]) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/dns-json' } });
      if (!r.ok) continue;
      const j = await r.json();
      return (j.Answer || []).filter((a) => a.type === typeNum).map((a) => (type === 'TXT' ? a.data.replace(/"\s+"/g, '').replace(/^"|"$/g, '') : a.data));
    } catch {}
  }
  return null; // lookup failed
}

async function emailChecks(site) {
  const domain = rootDomain(site.url);
  const cached = emailCache.get(domain);
  if (cached && Date.now() - cached.at < 6 * 3600000) return cached.items;
  const items = [];
  const [mx, txt, dmarc] = await Promise.all([doh(domain, 'MX'), doh(domain, 'TXT'), doh(`_dmarc.${domain}`, 'TXT')]);
  if (mx === null || txt === null) {
    const u = (k, n) => item(k, n, 'unknown', 'DNS lookup failed');
    return [u('mx', 'Email: MX records'), u('spf', 'Email: SPF'), u('dmarc', 'Email: DMARC'), u('dkim', 'Email: DKIM')];
  }
  const hosts = mx.map((m) => m.split(' ').pop().replace(/\.$/, '')).filter(Boolean);
  const provider = hosts.some((h) => /google|googlemail/i.test(h)) ? 'Google Workspace' : hosts.some((h) => /outlook|protection\.outlook/i.test(h)) ? 'Microsoft 365' : hosts.some((h) => /hostinger/i.test(h)) ? 'Hostinger Mail' : hosts.some((h) => /zoho/i.test(h)) ? 'Zoho Mail' : hosts.some((h) => /titan/i.test(h)) ? 'Titan' : hosts[0] || '';
  items.push(hosts.length ? item('mx', 'Email: MX records', 'pass', `${provider}${provider !== hosts[0] ? ` (${hosts.length} server${hosts.length > 1 ? 's' : ''})` : ''}`) : item('mx', 'Email: MX records', 'warn', `${domain} has no MX records — it can't receive email`));

  const spf = txt.filter((t) => /^v=spf1\b/i.test(t));
  items.push(
    !spf.length ? item('spf', 'Email: SPF', hosts.length ? 'fail' : 'warn', `No SPF record — email from ${domain} is likely to land in spam`)
    : spf.length > 1 ? item('spf', 'Email: SPF', 'fail', `${spf.length} SPF records — only one is allowed, so SPF fails`)
    : /\+all\b/.test(spf[0]) ? item('spf', 'Email: SPF', 'fail', 'SPF ends in +all, which lets anyone send as this domain')
    : /\?all\b/.test(spf[0]) || !/[~-]all\b/.test(spf[0]) ? item('spf', 'Email: SPF', 'warn', `SPF is weak: ${spf[0].slice(0, 90)}`)
    : item('spf', 'Email: SPF', 'pass', spf[0].slice(0, 110))
  );

  const dm = (dmarc || []).find((t) => /^v=DMARC1/i.test(t));
  const policy = dm?.match(/\bp=(\w+)/i)?.[1]?.toLowerCase();
  items.push(
    !dm ? item('dmarc', 'Email: DMARC', 'warn', `No DMARC record at _dmarc.${domain} — Gmail and Yahoo expect one for bulk senders`)
    : policy === 'none' ? item('dmarc', 'Email: DMARC', 'warn', 'DMARC policy is p=none (monitoring only, no protection against spoofing)')
    : item('dmarc', 'Email: DMARC', 'pass', `Policy p=${policy}${/rua=/i.test(dm) ? ' · reports enabled' : ''}`)
  );

  const selectors = [...new Set([...(site.dkimSelectors || []), ...DKIM_SELECTORS])];
  const found = [];
  await Promise.all(selectors.map(async (sel) => { const r = await doh(`${sel}._domainkey.${domain}`, 'TXT'); if (r?.some((t) => /v=DKIM1|k=rsa|p=/i.test(t))) found.push(sel); }));
  items.push(found.length
    ? item('dkim', 'Email: DKIM', 'pass', `Key found for selector${found.length > 1 ? 's' : ''} ${found.sort().join(', ')}`)
    : item('dkim', 'Email: DKIM', hosts.length ? 'warn' : 'unknown', `No DKIM key at common selectors${hosts.length ? ' — add "dkimSelectors" for this site in sites.json if it uses a custom one' : ''}`));

  emailCache.set(domain, { at: Date.now(), items });
  return items;
}
