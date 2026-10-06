import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { getSetting } from './db.js';
import { parseCookies, allow, resetLimit } from './security.js';

const SCRYPT = { N: 16384, r: 8, p: 1 };
export const SESSION_COOKIE = 'pl_admin';
const SESSION_MS = 30 * 24 * 3600 * 1000;

// ---- passwords ----
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

// ---- signing secret ----
let secret;
function getSecret() {
  if (secret) return secret;
  const file = path.join(DATA_DIR, 'secret');
  try {
    secret = fs.readFileSync(file);
    if (secret.length >= 32) return secret;
  } catch { /* create below */ }
  secret = crypto.randomBytes(32);
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

// ---- sessions ----
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const mac = (data, key = getSecret()) => crypto.createHmac('sha256', key).update(data).digest('base64url');

export function signSession(now = Date.now(), key = getSecret()) {
  const payload = b64u(JSON.stringify({ exp: now + SESSION_MS }));
  return `${payload}.${mac(payload, key)}`;
}
export function verifySession(token, now = Date.now(), key = getSecret()) {
  if (typeof token !== 'string') return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = mac(payload, key);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > now;
  } catch { return false; }
}

export const isAdmin = (req) => verifySession(parseCookies(req)[SESSION_COOKIE]);

export function setSessionCookie(req, res) {
  res.cookie(SESSION_COOKIE, signSession(), {
    httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: SESSION_MS, path: '/',
  });
}
export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Gate for /admin/api: valid session, and a custom header on mutations (CSRF defence in depth). */
export function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Not signed in' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Photolib') !== '1') {
    return res.status(403).json({ error: 'Missing X-Photolib header' });
  }
  next();
}

/** POST /admin/api/login handler. */
export function login(req, res) {
  const key = `login:${req.ip}`;
  const stored = getSetting('admin_password');
  if (!stored) return res.status(503).json({ error: 'No admin password set. Run: npm run set-password' });
  if (req.get('X-Photolib') !== '1') return res.status(403).json({ error: 'Missing X-Photolib header' });
  if (!allow(key, 5, 15 * 60 * 1000)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password || !verifyPassword(password, stored)) return res.status(401).json({ error: 'Wrong password' });
  resetLimit(key);
  setSessionCookie(req, res);
  res.json({ ok: true });
}
