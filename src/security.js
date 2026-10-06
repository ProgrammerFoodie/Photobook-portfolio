import crypto from 'node:crypto';

export function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
}

// ---- cookies (tiny parser; avoids a dependency) ----
export function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!(k in out)) {
      try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
    }
  }
  return out;
}

// ---- visitor id (anonymous, only set when someone likes a photo) ----
export const VISITOR_COOKIE = 'pl_vid';
export function getVisitorId(req) {
  const v = parseCookies(req)[VISITOR_COOKIE];
  return v && /^[a-f0-9]{32}$/.test(v) ? v : null;
}
export function ensureVisitorId(req, res) {
  let id = getVisitorId(req);
  if (!id) {
    id = crypto.randomBytes(16).toString('hex');
    res.cookie(VISITOR_COOKIE, id, {
      httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 365 * 24 * 3600 * 1000, path: '/',
    });
  }
  return id;
}

// ---- in-memory rate limiting ----
const buckets = new Map();
/** Returns true if the action is allowed, false if the limit is exceeded. */
export function allow(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}
export function resetLimit(key) { buckets.delete(key); }

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
}, 5 * 60 * 1000).unref();

/** Express middleware factory. */
export function rateLimit({ name, max, windowMs, message = 'Too many requests, please slow down.' }) {
  return (req, res, next) => {
    if (allow(`${name}:${req.ip}`, max, windowMs)) return next();
    res.status(429).json({ error: message });
  };
}

// Bots / link-preview fetchers shouldn't inflate view counts.
export const isBot = (req) =>
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|curl|wget|headless/i.test(req.headers['user-agent'] || '');
