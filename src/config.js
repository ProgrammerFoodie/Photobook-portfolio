import path from 'node:path';

const env = process.env;

export const ROOT = path.resolve(import.meta.dirname, '..');
export const PORT = Number(env.PORT || 3000);
export const HOST = env.HOST || '0.0.0.0';
export const DATA_DIR = path.resolve(env.DATA_DIR || path.join(ROOT, 'data'));
// Absolute public origin, e.g. https://photos.example.com (used in link previews). Optional.
export const PUBLIC_URL = (env.PUBLIC_URL || '').replace(/\/+$/, '');
// Express "trust proxy" value: 'loopback' suits Caddy/cloudflared on the same box.
export const TRUST_PROXY = env.TRUST_PROXY || 'loopback';

export const DIRS = {
  originals: path.join(DATA_DIR, 'originals'),
  derived: path.join(DATA_DIR, 'derived'),
  tmp: path.join(DATA_DIR, 'tmp'),
};

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
