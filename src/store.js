/** Shared data-access helpers for albums and photos. */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DIRS } from './config.js';
import { db, tx, getSetting, setSetting } from './db.js';
import { photoFilter, pruneTags } from './tags.js';

export const originalPath = (id, ext) => path.join(DIRS.originals, `${id}.${ext}`);
export const derivedDir = (id) => path.join(DIRS.derived, String(id));
export const derivedPath = (id, name) => path.join(derivedDir(id), name);

const ORDER = {
  manual: 'p.sort_order, p.id',
  taken_asc: 'p.taken_at IS NULL, p.taken_at ASC, p.id',
  taken_desc: 'p.taken_at IS NULL, p.taken_at DESC, p.id',
};

export function slugify(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'album';
}
export function uniqueSlug(base, exceptId = 0) {
  const root = slugify(base);
  let slug = root;
  for (let n = 2; db.prepare('SELECT 1 FROM albums WHERE slug = ? AND id != ?').get(slug, exceptId); n++) slug = `${root}-${n}`;
  return slug;
}

/** Photos of an album in display order. visible=true → only what the public may see. */
export function listPhotos(album, { visible = true, tag = '', q = '' } = {}) {
  const order = ORDER[album.photo_sort] || ORDER.manual;
  const where = visible ? "AND p.status = 'ready' AND p.is_hidden = 0" : '';
  const filter = photoFilter({ tag, q });
  return db.prepare(`SELECT p.* FROM photos p WHERE p.album_id = ? ${where}${filter.sql} ORDER BY ${order}`).all(album.id, ...filter.args);
}

export function getAlbumBySlug(slug) {
  return db.prepare('SELECT * FROM albums WHERE slug = ?').get(slug);
}

/** Make sure an album's cover points at a real, visible photo (or null when empty). */
export function ensureCover(albumId) {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(albumId);
  if (!album) return;
  const ok = album.cover_photo_id && db.prepare(
    "SELECT 1 FROM photos WHERE id = ? AND album_id = ? AND status = 'ready'").get(album.cover_photo_id, albumId);
  if (ok) return;
  const first = listPhotos(album)[0];
  db.prepare('UPDATE albums SET cover_photo_id = ? WHERE id = ?').run(first ? first.id : null, albumId);
}

export function nextPhotoOrder(albumId) {
  return (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM photos WHERE album_id = ?').get(albumId)).n;
}

export async function removePhotoFiles(photo) {
  await fsp.rm(originalPath(photo.id, photo.ext), { force: true });
  await fsp.rm(derivedDir(photo.id), { recursive: true, force: true });
}

export async function deletePhoto(id) {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
  if (!photo) return false;
  tx(() => {
    removeFromHighlights([id]);
    db.prepare('DELETE FROM photos WHERE id = ?').run(id);
    db.prepare('UPDATE albums SET cover_photo_id = NULL WHERE cover_photo_id = ?').run(id);
  });
  pruneTags();
  await removePhotoFiles(photo);
  ensureCover(photo.album_id);
  return true;
}

export async function deleteAlbum(id) {
  const photos = db.prepare('SELECT * FROM photos WHERE album_id = ?').all(id);
  tx(() => {
    removeFromHighlights(photos.map((p) => p.id));
    db.prepare('DELETE FROM albums WHERE id = ?').run(id); // photos + likes + photo_tags cascade
    pruneTags();
  });
  for (const photo of photos) await removePhotoFiles(photo);
}

// ---------- landing-page highlights ----------
export const MAX_HIGHLIGHTS = 5;

/** Ordered photo ids chosen in the admin (slot 1 = cover, 2 = large page, 3–5 = small photos). */
export function getHighlightIds() {
  let ids = [];
  try { ids = JSON.parse(getSetting('highlights') || '[]'); } catch { /* corrupt → empty */ }
  if (!Array.isArray(ids)) ids = [];
  if (!ids.length) { const legacy = Number(getSetting('featured_photo_id')); if (legacy) ids = [legacy]; }
  return [...new Set(ids.map(Number).filter(Boolean))].slice(0, MAX_HIGHLIGHTS);
}
export function setHighlightIds(ids) {
  setSetting('highlights', JSON.stringify(ids));
  setSetting('featured_photo_id', '');
}
export function removeFromHighlights(photoIds) {
  const drop = new Set(photoIds.map(Number));
  const ids = getHighlightIds();
  if (ids.some((x) => drop.has(x))) setHighlightIds(ids.filter((x) => !drop.has(x)));
}
/** Highlight photos in slot order. publicOnly → skip anything visitors may not see. */
export function getHighlightPhotos({ publicOnly = true } = {}) {
  const ids = getHighlightIds();
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT p.*, a.slug AS album_slug, a.title AS album_title, a.is_published AS album_published
    FROM photos p JOIN albums a ON a.id = p.album_id WHERE p.status = 'ready' AND p.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((p) => p && (!publicOnly || (p.album_published && !p.is_hidden)));
}
