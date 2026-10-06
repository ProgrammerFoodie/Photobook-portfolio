import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, DIRS } from './config.js';

for (const dir of [DATA_DIR, ...Object.values(DIRS)]) fs.mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'photolib.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  cover_photo_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 0,
  allow_download INTEGER NOT NULL DEFAULT 1,
  photo_sort TEXT NOT NULL DEFAULT 'manual',
  icloud_url TEXT NOT NULL DEFAULT '',
  icloud_auto_sync INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  sync_error TEXT NOT NULL DEFAULT '',
  views INTEGER NOT NULL DEFAULT 0,
  zip_downloads INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'upload',
  original_name TEXT NOT NULL DEFAULT '',
  ext TEXT NOT NULL DEFAULT 'jpg',
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  taken_at TEXT,
  exif TEXT NOT NULL DEFAULT '{}',
  caption TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'processing',
  error TEXT NOT NULL DEFAULT '',
  icloud_guid TEXT,
  icloud_checksum TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (album_id, icloud_guid)
);
CREATE INDEX IF NOT EXISTS photos_album ON photos(album_id, sort_order);
CREATE TABLE IF NOT EXISTS likes (
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (photo_id, visitor_id)
);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS photo_tags (
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (photo_id, tag_id)
);
CREATE INDEX IF NOT EXISTS photo_tags_tag ON photo_tags(tag_id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

/** Run fn inside a transaction; rolls back if it throws. */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const DEFAULT_SETTINGS = {
  site_title: 'Photolib',
  tagline: 'Cars · Cities · Wildlife',
  about: '',
  contact_email: '',
  instagram: '',
  facebook: '',
  tiktok: '',
  youtube: '',
  x: '',
  telegram: '',
  default_allow_download: '1',
  icloud_sync_hours: '6',
  strip_gps: '1',
  featured_photo_id: '', // legacy single hero; replaced by `highlights`
  highlights: '',        // JSON array of up to 5 photo ids shown on the landing page
  cover_subtitle: 'Portfolio',
  intro_title: 'Hello',
  theme: '',
  theme_version: '1',
  admin_password: '',
};
// Keys the admin UI may change through PATCH /admin/api/settings (never admin_password or theme_version).
export const EDITABLE_SETTINGS = [
  'site_title', 'tagline', 'about', 'contact_email', 'instagram', 'facebook', 'tiktok', 'youtube', 'x', 'telegram',
  'default_allow_download', 'icloud_sync_hours', 'strip_gps', 'cover_subtitle', 'intro_title',
];

const getRow = db.prepare('SELECT value FROM settings WHERE key = ?');
const setRow = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

export function getSetting(key) {
  const row = getRow.get(key);
  return row ? row.value : (DEFAULT_SETTINGS[key] ?? '');
}
export function setSetting(key, value) {
  setRow.run(key, String(value));
}
export function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}
/** Settings that are safe to expose to the browser. */
export function getPublicSettings() {
  const { admin_password, ...rest } = getSettings();
  return rest;
}
