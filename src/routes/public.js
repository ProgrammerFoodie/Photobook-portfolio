import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import archiver from 'archiver';
import { db, tx, getSettings } from '../db.js';
import { isAdmin } from '../auth.js';
import { ensureOg, MIME } from '../images.js';
import { originalPath, derivedPath, listPhotos, getAlbumBySlug, getHighlightPhotos } from '../store.js';
import { ensureVisitorId, getVisitorId, allow, rateLimit, isBot } from '../security.js';
import { parseStoredTheme, buildThemeCss } from '../theme.js';
import { tagSlug, tagsForPhotos, albumTagCounts, siteTagSuggestions, tagNameBySlug, photoFilter } from '../tags.js';
import { homeView, albumView, aboutView, searchView, errorView } from '../views/pages.js';

const router = express.Router();
const intId = (v) => (/^\d+$/.test(String(v)) ? Number(v) : 0);

export function renderError(req, res, status, message) {
  res.status(status).send(errorView(req, { settings: getSettings(), status, message }).toString());
}
const sendHtml = (res, view) => res.type('html').send(view.toString());
const notFound = (req, res) => renderError(req, res, 404, "We couldn't find that page.");

/** ?tag=bmw-m3 and/or ?q=blue m3 → { tag, q, qs } (qs is the query string to carry along to photo links). */
function readFilter(req) {
  const tag = typeof req.query.tag === 'string' ? tagSlug(req.query.tag) : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const params = new URLSearchParams();
  if (tag) params.set('tag', tag);
  if (q) params.set('q', q);
  return { tag, q, qs: params.size ? `?${params}` : '' };
}

/** Everything the public may see: ready, not hidden, in a published album. */
function publicPhoto(id) {
  const photo = db.prepare("SELECT * FROM photos WHERE id = ? AND status = 'ready' AND is_hidden = 0").get(id);
  if (!photo) return null;
  const album = db.prepare('SELECT * FROM albums WHERE id = ? AND is_published = 1').get(photo.album_id);
  return album ? { photo, album } : null;
}

// ---------- theme ----------
router.get('/theme.css', (req, res) => {
  const css = buildThemeCss(parseStoredTheme(getSettings().theme));
  res.type('css').set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache').send(css);
});

// ---------- pages ----------
router.get('/', (req, res) => {
  const settings = getSettings();
  const cat = typeof req.query.c === 'string' ? req.query.c : '';
  const rows = db.prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id AND p.status = 'ready' AND p.is_hidden = 0) AS photo_count
    FROM albums a WHERE a.is_published = 1 ORDER BY a.sort_order, a.id`).all();
  const albums = [];
  for (const a of rows) {
    if (!a.photo_count) continue;
    const cover = a.cover_photo_id && db.prepare("SELECT * FROM photos WHERE id = ? AND status = 'ready' AND is_hidden = 0").get(a.cover_photo_id)
      || listPhotos(a)[0];
    if (cover) albums.push({ ...a, cover });
  }
  const categories = [...new Set(albums.map((a) => a.category).filter(Boolean))];
  sendHtml(res, homeView(req, {
    settings, categories, activeCat: categories.includes(cat) ? cat : '', highlights: getHighlightPhotos(), suggestions: siteTagSuggestions(),
    albums: albums.filter((a) => !cat || a.category === cat),
  }));
});

router.get('/about', (req, res) => sendHtml(res, aboutView(req, { settings: getSettings() })));

// Site-wide "find my car": every published album, grouped by album.
router.get('/search', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const filter = photoFilter({ q });
  const rows = q ? db.prepare(`SELECT p.*, a.slug AS album_slug, a.title AS album_title, a.date AS album_date
    FROM photos p JOIN albums a ON a.id = p.album_id
    WHERE a.is_published = 1 AND p.status = 'ready' AND p.is_hidden = 0${filter.sql}
    ORDER BY a.sort_order, a.id, p.sort_order, p.id LIMIT 301`).all(...filter.args) : [];
  const groups = [];
  for (const p of rows.slice(0, 300)) {
    let g = groups[groups.length - 1];
    if (!g || g.slug !== p.album_slug) groups.push(g = { slug: p.album_slug, title: p.album_title, date: p.album_date, photos: [] });
    g.photos.push(p);
  }
  sendHtml(res, searchView(req, { settings: getSettings(), q, groups, count: Math.min(rows.length, 300), more: rows.length > 300, suggestions: siteTagSuggestions() }));
});

// Count one view per visitor (IP + UA) per album per 30 minutes; skip bots and the admin.
function countView(req, album) {
  if (isBot(req) || isAdmin(req)) return;
  const key = crypto.createHash('sha1').update(`${req.ip}|${req.headers['user-agent'] || ''}|${album.id}`).digest('hex');
  if (allow(`view:${key}`, 1, 30 * 60 * 1000)) db.prepare('UPDATE albums SET views = views + 1 WHERE id = ?').run(album.id);
}

function albumPage(req, res) {
  const album = getAlbumBySlug(String(req.params.slug));
  if (!album || (!album.is_published && !isAdmin(req))) return notFound(req, res);
  const filter = readFilter(req);
  const filtered = !!(filter.tag || filter.q);
  const everything = listPhotos(album);
  const photos = filtered ? listPhotos(album, filter) : everything;
  let openId = 0;
  if (req.params.id !== undefined) {
    openId = intId(req.params.id);
    if (!photos.some((p) => p.id === openId)) return res.redirect(302, `/a/${album.slug}`);
  }
  const vid = getVisitorId(req);
  const liked = new Set(vid && photos.length
    ? db.prepare(`SELECT photo_id FROM likes WHERE visitor_id = ? AND photo_id IN (${photos.map(() => '?').join(',')})`).all(vid, ...photos.map((p) => p.id)).map((r) => r.photo_id)
    : []);
  if (album.is_published) countView(req, album);
  sendHtml(res, albumView(req, {
    settings: getSettings(), album, photos, liked, openId,
    totalBytes: photos.reduce((n, p) => n + p.bytes, 0),
    total: everything.length, filter, filtered,
    tagName: filter.tag ? tagNameBySlug(filter.tag) || filter.tag : '',
    tagCounts: albumTagCounts(album.id),
    tagMap: tagsForPhotos(photos.map((p) => p.id)),
  }));
}
router.get('/a/:slug', albumPage);
router.get('/a/:slug/p/:id', albumPage);

// ---------- images ----------
const FILES = new Set(['thumb.webp', 'display.webp', 'og.jpg', 'original']);

router.get('/img/:id/:file', async (req, res, next) => {
  const photo = db.prepare("SELECT * FROM photos WHERE id = ? AND status = 'ready'").get(intId(req.params.id));
  if (!photo || !FILES.has(req.params.file)) return notFound(req, res);
  const admin = isAdmin(req);
  const album = db.prepare('SELECT is_published FROM albums WHERE id = ?').get(photo.album_id);
  const visible = album?.is_published && !photo.is_hidden;
  if (!visible && !admin) return notFound(req, res);

  let file;
  if (req.params.file === 'original') file = originalPath(photo.id, photo.ext);
  else if (req.params.file === 'og.jpg') file = await ensureOg(photo.id);
  else file = derivedPath(photo.id, req.params.file);

  const cache = !visible ? 'private, no-cache'
    : req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=300';
  res.sendFile(file, {
    dotfiles: 'allow',
    headers: { 'Cache-Control': cache, ...(req.params.file === 'original' ? { 'Content-Type': MIME[photo.ext] || 'application/octet-stream' } : {}) },
  }, (err) => { if (err && !res.headersSent) next(err); });
});

// ---------- likes ----------
router.post('/api/like/:id', rateLimit({ name: 'like', max: 30, windowMs: 60 * 1000 }), (req, res) => {
  const found = publicPhoto(intId(req.params.id));
  if (!found) return res.status(404).json({ error: 'Photo not found' });
  const vid = ensureVisitorId(req, res);
  const id = found.photo.id;
  const result = tx(() => {
    const had = db.prepare('DELETE FROM likes WHERE photo_id = ? AND visitor_id = ?').run(id, vid).changes > 0;
    if (!had) db.prepare('INSERT INTO likes (photo_id, visitor_id) VALUES (?, ?)').run(id, vid);
    const count = db.prepare('SELECT COUNT(*) AS n FROM likes WHERE photo_id = ?').get(id).n;
    db.prepare('UPDATE photos SET likes = ? WHERE id = ?').run(count, id);
    return { liked: !had, count };
  });
  res.json(result);
});

// ---------- downloads ----------
const pad = (n) => String(n).padStart(3, '0');
const safeName = (s) => String(s).replace(/[^\w.\- ()]+/g, '_').slice(0, 120);

function downloadName(album, photo, n, { zip = false } = {}) {
  if (zip && photo.source === 'upload' && photo.original_name) return `${pad(n)}-${safeName(photo.original_name)}`;
  return `${album.slug}-${pad(n)}.${photo.ext}`;
}

router.get('/dl/p/:id', (req, res, next) => {
  const found = publicPhoto(intId(req.params.id));
  if (!found || !found.album.allow_download) return notFound(req, res);
  const { photo, album } = found;
  const n = listPhotos(album).findIndex((p) => p.id === photo.id) + 1;
  if (req.method === 'GET') db.prepare('UPDATE photos SET downloads = downloads + 1 WHERE id = ?').run(photo.id);
  res.download(originalPath(photo.id, photo.ext), downloadName(album, photo, n), { dotfiles: 'allow' }, (err) => {
    if (err && !res.headersSent) next(err);
  });
});

let activeZips = 0;
router.get('/dl/a/:file', (req, res) => {
  const m = String(req.params.file).match(/^([a-z0-9-]+)\.zip$/);
  const album = m && getAlbumBySlug(m[1]);
  if (!album || !album.is_published || !album.allow_download) return notFound(req, res);
  const filter = readFilter(req);
  const photos = listPhotos(album, filter);
  if (!photos.length) return notFound(req, res);
  if (!allow(`zip:${req.ip}`, 5, 3600 * 1000)) return renderError(req, res, 429, 'Too many album downloads. Please try again in an hour.');
  if (activeZips >= 2) { res.set('Retry-After', '30'); return renderError(req, res, 503, 'The server is busy preparing other downloads. Please try again in a minute.'); }

  const suffix = filter.tag || filter.q ? `-${tagSlug(filter.tag || filter.q).slice(0, 30) || 'selection'}` : '';
  const zipName = `${album.slug}${suffix}.zip`.replace(/[^\p{L}\p{N}.-]+/gu, '_');
  activeZips++;
  const archive = archiver('zip', { store: true }); // photos are already compressed
  let done = false;
  const release = () => { if (!done) { done = true; activeZips--; } };
  res.on('close', () => { release(); if (!res.writableFinished) archive.abort(); });
  archive.on('error', (err) => { console.error('[zip]', err); release(); res.destroy(err); });

  // Numbers in file names follow the position in the whole album, so a filtered zip matches single downloads.
  const position = new Map(listPhotos(album).map((p, i) => [p.id, i + 1]));
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${zipName}"; filename*=UTF-8''${encodeURIComponent(zipName)}` });
  archive.pipe(res);
  photos.forEach((p) => archive.file(originalPath(p.id, p.ext), { name: `${album.slug}/${downloadName(album, p, position.get(p.id), { zip: true })}` }));
  db.prepare('UPDATE albums SET zip_downloads = zip_downloads + 1 WHERE id = ?').run(album.id);
  archive.finalize();
});

export default router;
