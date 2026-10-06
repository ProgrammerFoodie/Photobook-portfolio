import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { DIRS, MAX_UPLOAD_BYTES } from '../config.js';
import { db, tx, getSettings, getSetting, setSetting, getPublicSettings, EDITABLE_SETTINGS } from '../db.js';
import { login, requireAdmin, clearSessionCookie } from '../auth.js';
import { enqueue, queueStatus } from '../queue.js';
import { processPhoto } from '../images.js';
import { resolveTheme, parseStoredTheme, DEFAULT_THEME, ROLE_LABELS } from '../theme.js';
import { ensureCover, listPhotos, nextPhotoOrder, uniqueSlug, slugify, deletePhoto, deleteAlbum, getHighlightPhotos, setHighlightIds, MAX_HIGHLIGHTS } from '../store.js';
import { startAlbumSync, syncingAlbumIds, parseSharedAlbumToken } from '../icloud.js';
import { normalizeSocial, SOCIAL_KEYS } from '../social.js';
import { parseTagList, addTags, removeTags, tagsForPhotos, allTags, renameTag, deleteTag, MAX_TAGS_PER_PHOTO } from '../tags.js';

const router = express.Router();
const bad = (res, message, status = 400) => res.status(status).json({ error: message });
const intId = (v) => (/^\d+$/.test(String(v)) ? Number(v) : 0);
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

router.post('/login', login);
router.use(requireAdmin);
router.post('/logout', (req, res) => { clearSessionCookie(res); res.json({ ok: true }); });
router.get('/me', (req, res) => res.json({ admin: true }));

// ---------- albums ----------
const albumRow = (a) => ({
  ...a,
  is_published: !!a.is_published,
  allow_download: !!a.allow_download,
  icloud_auto_sync: !!a.icloud_auto_sync,
});

router.get('/albums', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id AND p.status = 'ready') AS photo_count,
      (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id AND p.status != 'ready') AS pending_count
    FROM albums a ORDER BY a.sort_order, a.id`).all();
  res.json({ albums: rows.map(albumRow) });
});

function validateAlbumFields(body, existing) {
  const out = {};
  if ('title' in body) {
    const title = String(body.title ?? '').trim();
    if (!title || title.length > 120) return { error: 'Title is required (max 120 characters)' };
    out.title = title;
  }
  if ('description' in body) out.description = String(body.description ?? '').slice(0, 2000);
  if ('category' in body) out.category = String(body.category ?? '').trim().slice(0, 40);
  if ('date' in body) {
    const d = String(body.date ?? '').trim();
    if (d && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(d)) return { error: 'Date must look like 2026-10-06, 2026-10 or 2026' };
    out.date = d;
  }
  if ('is_published' in body) out.is_published = bool(body.is_published);
  if ('allow_download' in body) out.allow_download = bool(body.allow_download);
  if ('icloud_auto_sync' in body) out.icloud_auto_sync = bool(body.icloud_auto_sync);
  if ('photo_sort' in body) {
    if (!['manual', 'taken_asc', 'taken_desc'].includes(body.photo_sort)) return { error: 'Invalid photo sort' };
    out.photo_sort = body.photo_sort;
  }
  if ('icloud_url' in body) {
    const url = String(body.icloud_url ?? '').trim();
    if (url && !parseSharedAlbumToken(url)) return { error: 'That does not look like an iCloud shared album link (https://www.icloud.com/sharedalbum/#…)' };
    out.icloud_url = url;
  }
  if ('slug' in body) {
    const raw = String(body.slug ?? '').trim();
    if (raw && slugify(raw) !== raw) return { error: 'Slug may only contain lowercase letters, numbers and dashes' };
    out.slug = uniqueSlug(raw || out.title || existing?.title || 'album', existing?.id || 0);
  }
  if ('cover_photo_id' in body && existing) {
    const id = intId(body.cover_photo_id);
    const ok = id && db.prepare("SELECT 1 FROM photos WHERE id = ? AND album_id = ? AND status = 'ready'").get(id, existing.id);
    if (!ok) return { error: 'Cover must be a ready photo in this album' };
    out.cover_photo_id = id;
  }
  return { fields: out };
}

router.post('/albums', (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  const { fields, error } = validateAlbumFields({ ...req.body, title });
  if (error) return bad(res, error);
  if (!title) return bad(res, 'Title is required');
  const slug = uniqueSlug(fields.slug || title);
  const order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM albums').get().n;
  const info = db.prepare(`INSERT INTO albums (slug, title, description, category, date, sort_order, allow_download, icloud_url, photo_sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    slug, title, fields.description ?? '', fields.category ?? '', fields.date ?? '', order,
    getSetting('default_allow_download') === '0' ? 0 : 1, fields.icloud_url ?? '', fields.photo_sort ?? 'manual');
  res.status(201).json({ album: albumRow(db.prepare('SELECT * FROM albums WHERE id = ?').get(info.lastInsertRowid)) });
});

router.post('/albums/reorder', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(intId) : [];
  if (!ids.length || ids.some((i) => !i)) return bad(res, 'ids must be a list of album ids');
  tx(() => ids.forEach((id, i) => db.prepare('UPDATE albums SET sort_order = ? WHERE id = ?').run(i + 1, id)));
  res.json({ ok: true });
});

router.get('/albums/:id', (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(intId(req.params.id));
  if (!album) return bad(res, 'Album not found', 404);
  const rows = listPhotos(album, { visible: false });
  const tags = tagsForPhotos(rows.map((p) => p.id));
  const photos = rows.map((p) => ({ ...p, exif: JSON.parse(p.exif || '{}'), is_hidden: !!p.is_hidden, tags: tags.get(p.id).map((t) => t.name) }));
  res.json({ album: albumRow(album), photos });
});

router.patch('/albums/:id', (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(intId(req.params.id));
  if (!album) return bad(res, 'Album not found', 404);
  const { fields, error } = validateAlbumFields(req.body || {}, album);
  if (error) return bad(res, error);
  const keys = Object.keys(fields);
  if (keys.length) {
    db.prepare(`UPDATE albums SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...keys.map((k) => fields[k]), album.id);
    if ('photo_sort' in fields) ensureCover(album.id);
  }
  res.json({ album: albumRow(db.prepare('SELECT * FROM albums WHERE id = ?').get(album.id)) });
});

router.delete('/albums/:id', async (req, res) => {
  const id = intId(req.params.id);
  if (!db.prepare('SELECT 1 FROM albums WHERE id = ?').get(id)) return bad(res, 'Album not found', 404);
  await deleteAlbum(id);
  res.json({ ok: true });
});

router.post('/albums/:id/cover', (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(intId(req.params.id));
  if (!album) return bad(res, 'Album not found', 404);
  const { fields, error } = validateAlbumFields({ cover_photo_id: req.body?.photo_id }, album);
  if (error) return bad(res, error);
  db.prepare('UPDATE albums SET cover_photo_id = ? WHERE id = ?').run(fields.cover_photo_id, album.id);
  res.json({ ok: true });
});

router.post('/albums/:id/photos/reorder', (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(intId(req.params.id));
  if (!album) return bad(res, 'Album not found', 404);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(intId) : [];
  if (!ids.length || ids.some((i) => !i)) return bad(res, 'ids must be a list of photo ids');
  tx(() => {
    ids.forEach((id, i) => db.prepare('UPDATE photos SET sort_order = ? WHERE id = ? AND album_id = ?').run(i + 1, id, album.id));
    db.prepare("UPDATE albums SET photo_sort = 'manual' WHERE id = ?").run(album.id);
  });
  res.json({ ok: true });
});

// ---------- tags ----------
// Bulk add/remove: { photo_ids: [..], add: "BMW M3, #42" | [..], remove: [..] }
router.post('/albums/:id/tags', (req, res) => {
  const album = db.prepare('SELECT id FROM albums WHERE id = ?').get(intId(req.params.id));
  if (!album) return bad(res, 'Album not found', 404);
  const ids = [...new Set((Array.isArray(req.body?.photo_ids) ? req.body.photo_ids : []).map(intId).filter(Boolean))];
  if (!ids.length) return bad(res, 'Select at least one photo');
  if (ids.length > 2000) return bad(res, 'Too many photos selected at once');
  const owned = db.prepare(`SELECT id FROM photos WHERE album_id = ? AND id IN (${ids.map(() => '?').join(',')})`).all(album.id, ...ids).map((r) => r.id);
  if (owned.length !== ids.length) return bad(res, 'Some photos are not in this album');
  const add = parseTagList(req.body?.add);
  const remove = parseTagList(req.body?.remove);
  if (!add.length && !remove.length) return bad(res, 'Enter at least one tag');
  if (remove.length) removeTags(owned, remove);
  const result = add.length ? addTags(owned, add) : { added: 0, skipped: 0 };
  const tags = tagsForPhotos(owned);
  res.json({
    ...result, limit: MAX_TAGS_PER_PHOTO,
    photos: Object.fromEntries(owned.map((id) => [id, tags.get(id).map((t) => t.name)])),
  });
});

router.get('/tags', (req, res) => res.json({ tags: allTags() }));

router.patch('/tags/:id', (req, res) => {
  const id = intId(req.params.id);
  if (!db.prepare('SELECT 1 FROM tags WHERE id = ?').get(id)) return bad(res, 'Tag not found', 404);
  const survivor = renameTag(id, req.body?.name);
  if (!survivor) return bad(res, 'Enter a tag name (letters or numbers)');
  res.json({ ok: true, merged: survivor !== id, tags: allTags() });
});

router.delete('/tags/:id', (req, res) => {
  if (!deleteTag(intId(req.params.id))) return bad(res, 'Tag not found', 404);
  res.json({ ok: true, tags: allTags() });
});

// ---------- uploads ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: DIRS.tmp,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + '.upload'),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 20 },
});

function cleanName(name) {
  let n = String(name || 'photo');
  const fixed = Buffer.from(n, 'latin1').toString('utf8'); // multer reports UTF-8 names as latin1
  if (!fixed.includes('�')) n = fixed;
  return path.basename(n).replace(/[\\/\0]/g, '_').slice(0, 150);
}

router.post('/albums/:id/photos', upload.array('files', 20), (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(intId(req.params.id));
  if (!album) {
    for (const f of req.files || []) fs.promises.rm(f.path, { force: true });
    return bad(res, 'Album not found', 404);
  }
  const created = [];
  for (const file of req.files || []) {
    const info = db.prepare("INSERT INTO photos (album_id, source, original_name, sort_order, status) VALUES (?, 'upload', ?, ?, 'processing')")
      .run(album.id, cleanName(file.originalname), nextPhotoOrder(album.id));
    const id = Number(info.lastInsertRowid);
    created.push({ id, name: cleanName(file.originalname), status: 'processing' });
    enqueue(`photo ${id}`, () => processPhoto(id, file.path));
  }
  res.status(202).json({ photos: created });
});

// ---------- iCloud ----------
router.post('/albums/:id/sync', (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(intId(req.params.id));
  if (!album) return bad(res, 'Album not found', 404);
  if (!album.icloud_url) return bad(res, 'Add an iCloud shared album link first');
  startAlbumSync(album.id);
  res.status(202).json({ ok: true });
});

// ---------- photos ----------
router.patch('/photos/:id', (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(intId(req.params.id));
  if (!photo) return bad(res, 'Photo not found', 404);
  const body = req.body || {};
  const sets = [];
  const args = [];
  if ('caption' in body) { sets.push('caption = ?'); args.push(String(body.caption ?? '').slice(0, 500)); }
  if ('is_hidden' in body) { sets.push('is_hidden = ?'); args.push(bool(body.is_hidden)); }
  let moveTo = 0;
  if ('album_id' in body && intId(body.album_id) !== photo.album_id) {
    moveTo = intId(body.album_id);
    if (photo.source === 'icloud') return bad(res, 'iCloud photos cannot be moved (the next sync would re-import them). Hide it instead.');
    if (!db.prepare('SELECT 1 FROM albums WHERE id = ?').get(moveTo)) return bad(res, 'Target album not found');
    sets.push('album_id = ?', 'sort_order = ?');
    args.push(moveTo, nextPhotoOrder(moveTo));
  }
  if (sets.length) db.prepare(`UPDATE photos SET ${sets.join(', ')} WHERE id = ?`).run(...args, photo.id);
  if (moveTo) {
    db.prepare('UPDATE albums SET cover_photo_id = NULL WHERE id = ? AND cover_photo_id = ?').run(photo.album_id, photo.id);
    ensureCover(photo.album_id);
    ensureCover(moveTo);
  } else if ('is_hidden' in body) {
    ensureCover(photo.album_id);
  }
  res.json({ ok: true });
});

router.delete('/photos/:id', async (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(intId(req.params.id));
  if (!photo) return bad(res, 'Photo not found', 404);
  if (photo.source === 'icloud') {
    return bad(res, 'This photo comes from iCloud and would be re-imported on the next sync. Hide it instead, or remove it from the iCloud album.');
  }
  await deletePhoto(photo.id);
  res.json({ ok: true });
});

// ---------- settings ----------
function settingsPayload() {
  const { theme: savedTheme, featured_photo_id, highlights, ...rest } = getPublicSettings();
  const list = getHighlightPhotos({ publicOnly: false }).map((p) => ({ id: p.id, version: p.version, album_id: p.album_id, album_title: p.album_title }));
  return {
    settings: rest, theme: parseStoredTheme(savedTheme), defaultTheme: DEFAULT_THEME, roleLabels: ROLE_LABELS,
    highlights: list, maxHighlights: MAX_HIGHLIGHTS, passwordSet: !!getSetting('admin_password'),
  };
}
router.get('/settings', (req, res) => res.json(settingsPayload()));

router.patch('/settings', (req, res) => {
  const body = req.body || {};
  const next = {};
  for (const key of EDITABLE_SETTINGS) {
    if (!(key in body)) continue;
    let v = body[key];
    if (['default_allow_download', 'strip_gps'].includes(key)) v = bool(v) ? '1' : '0';
    else if (key === 'icloud_sync_hours') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 168) return bad(res, 'Sync interval must be 0–168 hours');
      v = String(Math.round(n));
    } else if (SOCIAL_KEYS.includes(key)) {
      const url = normalizeSocial(key, v);
      if (url === null) return bad(res, `${key[0].toUpperCase()}${key.slice(1)}: enter a handle (like @name) or a link starting with https://`);
      v = url;
    } else if (key === 'site_title') {
      v = String(v ?? '').trim().slice(0, 60);
      if (!v) return bad(res, 'Site title cannot be empty');
    } else {
      v = String(v ?? '').trim().slice(0, key === 'about' ? 5000 : 200);
    }
    next[key] = v;
  }
  if ('highlights' in body) {
    const ids = Array.isArray(body.highlights) ? [...new Set(body.highlights.map(intId).filter(Boolean))] : null;
    if (!ids || ids.length > MAX_HIGHLIGHTS) return bad(res, `Choose at most ${MAX_HIGHLIGHTS} highlight photos`);
    const ok = ids.length === 0 || db.prepare(`SELECT COUNT(*) AS n FROM photos WHERE status = 'ready' AND id IN (${ids.map(() => '?').join(',')})`).get(...ids).n === ids.length;
    if (!ok) return bad(res, 'Highlights must be photos that are ready');
    next.__highlights = ids;
  }
  if ('theme' in body) {
    if (body.theme === null) next.theme = '';
    else if (typeof body.theme === 'object') next.theme = JSON.stringify(resolveTheme(body.theme));
    else return bad(res, 'theme must be an object or null');
  }
  tx(() => {
    if (next.__highlights) { setHighlightIds(next.__highlights); delete next.__highlights; }
    for (const [k, v] of Object.entries(next)) setSetting(k, v);
    if ('theme' in next) setSetting('theme_version', String(Number(getSetting('theme_version') || 1) + 1));
  });
  res.json(settingsPayload());
});

// ---------- stats & jobs ----------
router.get('/stats', (req, res) => {
  const one = (sql) => db.prepare(sql).get();
  const totals = one(`SELECT
    (SELECT COUNT(*) FROM albums) AS albums,
    (SELECT COUNT(*) FROM albums WHERE is_published = 1) AS published,
    (SELECT COUNT(*) FROM photos WHERE status = 'ready') AS photos,
    (SELECT COALESCE(SUM(likes), 0) FROM photos) AS likes,
    (SELECT COALESCE(SUM(downloads), 0) FROM photos) AS downloads,
    (SELECT COALESCE(SUM(zip_downloads), 0) FROM albums) AS zip_downloads,
    (SELECT COALESCE(SUM(views), 0) FROM albums) AS views`);
  const top = (col) => db.prepare(`SELECT p.id, p.version, p.${col} AS n, a.title AS album_title, a.id AS album_id
    FROM photos p JOIN albums a ON a.id = p.album_id WHERE p.${col} > 0 AND p.status = 'ready' ORDER BY p.${col} DESC, p.id LIMIT 10`).all();
  const albums = db.prepare(`SELECT a.id, a.title, a.views, a.zip_downloads, a.is_published,
    (SELECT COALESCE(SUM(likes), 0) FROM photos p WHERE p.album_id = a.id) AS likes,
    (SELECT COALESCE(SUM(downloads), 0) FROM photos p WHERE p.album_id = a.id) AS downloads
    FROM albums a ORDER BY a.views DESC, a.id LIMIT 10`).all();
  res.json({ totals, topLiked: top('likes'), topDownloaded: top('downloads'), albums });
});

router.get('/jobs', (req, res) => {
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM photos GROUP BY status').all().map((r) => [r.status, r.n]));
  res.json({ queue: queueStatus(), photos: counts, syncing: syncingAlbumIds() });
});

export default router;
