import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError, config } from './config.js';

// One portal account (ADMIN_USERNAME / ADMIN_PASSWORD). The session is a signed cookie, so it works across
// Vercel's stateless functions without a session store.
const COOKIE = 'kg_session';
const HOURS = 12;
// SESSION_SECRET if set; otherwise derived from secrets that only the deployment has. Changing the password signs everyone out.
const secret = () => config.sessionSecret || createHash('sha256').update(`kg-mail-portal|${config.turso.authToken}|${config.admin.password}`).digest('hex');
const sign = payload => createHmac('sha256', secret()).update(payload).digest('base64url');
const same = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());

function readCookie(req) {
  const match = (req.headers.cookie || '').split(/;\s*/).find(part => part.startsWith(`${COOKIE}=`));
  return match ? decodeURIComponent(match.slice(COOKIE.length + 1)) : '';
}
function cookie(req, value, maxAge) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function currentUser(req) {
  const [payload, signature] = readCookie(req).split('.');
  if (!payload || !signature || !same(sign(payload), signature)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return session.exp > Date.now() && session.u === config.admin.username ? session.u : null;
  } catch { return null; }
}

// Slows down password guessing (per server instance).
const attempts = new Map();
export function login(req, res) {
  const key = req.ip || 'unknown';
  const recent = (attempts.get(key) || []).filter(time => time > Date.now() - 15 * 60000);
  if (recent.length >= 10) throw new ApiError(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
  const { username, password } = req.body || {};
  if (!same(username ?? '', config.admin.username) || !same(password ?? '', config.admin.password)) {
    attempts.set(key, [...recent, Date.now()]);
    throw new ApiError(401, 'Incorrect username or password.');
  }
  attempts.delete(key);
  const payload = Buffer.from(JSON.stringify({ u: config.admin.username, exp: Date.now() + HOURS * 3600000 })).toString('base64url');
  res.set('Set-Cookie', cookie(req, `${payload}.${sign(payload)}`, HOURS * 3600));
  return { username: config.admin.username };
}
export function logout(req, res) { res.set('Set-Cookie', cookie(req, '', 0)); return {}; }

/** Every API route except sign-in requires a valid session. */
export function requireLogin(req, res, next) {
  if (req.path === '/auth/login' || req.path === '/auth/session' || currentUser(req)) return next();
  res.status(401).json({ success: false, message: 'Please sign in.' });
}
