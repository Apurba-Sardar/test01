// Cookie sessions for the dashboard login page. Stateless: the cookie holds the username and expiry,
// signed with HMAC. The signing key is derived from the login settings, so changing DASHBOARD_PASS
// (or SESSION_SECRET) signs everybody out.
import crypto from 'node:crypto';
import { config } from './config.js';

const COOKIE = 'status_session';
const SHORT_SESSION_S = 12 * 3600; // without "remember me"
const LONG_SESSION_S = 30 * 86400; // with "remember me"
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

const key = crypto
  .createHash('sha256')
  .update(`status-session\0${config.sessionSecret}\0${config.dashboardUser}\0${config.dashboardPass}`)
  .digest();
const sign = (data) => crypto.createHmac('sha256', key).update(data).digest('base64url');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

export const authEnabled = () => !!config.dashboardUser;

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isHttps = (req) => req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
}

/** Returns the signed-in username, or null. */
export function currentUser(req) {
  if (!authEnabled()) return 'guest';
  const token = cookies(req)[COOKIE];
  if (token) {
    const [data, sig] = token.split('.');
    if (data && sig && safeEqual(sig, sign(data))) {
      try {
        const { u, exp } = JSON.parse(Buffer.from(data, 'base64url').toString());
        if (exp > Date.now() / 1000 && u === config.dashboardUser) return u;
      } catch {}
    }
  }
  // Scripts may still use HTTP Basic auth (curl -u user:pass) for the API.
  const [scheme, value] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && value) {
    const [u, ...p] = Buffer.from(value, 'base64').toString().split(':');
    if (checkCredentials(u, p.join(':'))) return u;
  }
  return null;
}

export function checkCredentials(user, pass) {
  // evaluate both so timing doesn't reveal which one was wrong
  const okUser = safeEqual(user ?? '', config.dashboardUser);
  const okPass = safeEqual(pass ?? '', config.dashboardPass);
  return okUser && okPass;
}

export function sessionCookie(req, user, remember) {
  const maxAge = remember ? LONG_SESSION_S : SHORT_SESSION_S;
  const data = Buffer.from(JSON.stringify({ u: user, exp: Math.floor(Date.now() / 1000) + maxAge })).toString('base64url');
  return [
    `${COOKIE}=${data}.${sign(data)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    ...(isHttps(req) ? ['Secure'] : []),
    ...(remember ? [`Max-Age=${maxAge}`] : []),
  ].join('; ');
}

export const clearCookie = (req) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;

// Simple per-IP brute-force protection for the login form.
const fails = new Map();
export function loginBlockedFor(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.first > FAIL_WINDOW_MS) return 0;
  return f.count >= MAX_FAILS ? Math.ceil((f.first + FAIL_WINDOW_MS - Date.now()) / 1000) : 0;
}
export function recordLoginFailure(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.first > FAIL_WINDOW_MS) fails.set(ip, { first: Date.now(), count: 1 });
  else f.count++;
}
export const clearLoginFailures = (ip) => fails.delete(ip);
