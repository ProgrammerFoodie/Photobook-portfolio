/**
 * iCloud Shared Album import (unofficial "Public Website" web API).
 * Everything Apple-specific lives in this file: if Apple changes the API, only this breaks
 * and manual uploads keep working.
 */
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DIRS, MAX_UPLOAD_BYTES } from './config.js';
import { db, getSetting } from './db.js';
import { enqueue } from './queue.js';
import { processPhoto } from './images.js';
import { deletePhoto, nextPhotoOrder } from './store.js';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const APPLE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.icloud(-content)?\.com$/i;
const FALLBACK_HOST = 'p23-sharedstreams.icloud.com';

/** "https://www.icloud.com/sharedalbum/#B0aGxxxx" → "B0aGxxxx" (or null). */
export function parseSharedAlbumToken(input) {
  const s = String(input || '').trim();
  const m = s.match(/^https?:\/\/(?:www\.)?icloud\.com\/sharedalbum\/?(?:[a-z]{2}(?:[-_][A-Za-z]{2})?\/)?#([A-Za-z0-9]{8,})$/);
  return m ? m[1] : null;
}

const base62 = (s) => [...s].reduce((n, c) => n * 62 + Math.max(0, BASE62.indexOf(c)), 0);
export function streamHost(token) {
  const partition = token[0] === 'A' ? base62(token[1]) : base62(token.slice(1, 3));
  return `p${String(partition).padStart(2, '0')}-sharedstreams.icloud.com`;
}

// ---------- pure parsers (unit-tested with fixtures) ----------

/** Normalise a webstream response into { name, photos: [{ guid, checksum, width, height, caption, takenAt }] }. */
export function parseWebstream(json) {
  const photos = [];
  for (const p of json?.photos || []) {
    if (!p?.photoGuid || String(p.mediaAssetType || '').toLowerCase() === 'video') continue;
    const derivs = Object.entries(p.derivatives || {}).filter(([key]) => key !== 'PosterFrame');
    if (!derivs.length || Object.keys(p.derivatives).includes('PosterFrame')) continue; // videos carry a poster frame
    let best = null;
    for (const [, d] of derivs) {
      const area = Number(d.width) * Number(d.height) || 0;
      if (d.checksum && (!best || area > best.area)) best = { area, checksum: d.checksum, width: Number(d.width) || 0, height: Number(d.height) || 0 };
    }
    if (!best) continue;
    photos.push({
      guid: p.photoGuid,
      checksum: best.checksum,
      width: best.width,
      height: best.height,
      caption: String(p.caption || '').slice(0, 500),
      takenAt: p.dateCreated && !Number.isNaN(Date.parse(p.dateCreated)) ? new Date(p.dateCreated).toISOString() : null,
    });
  }
  return { name: String(json?.streamName || ''), photos };
}

/** webasseturls response → Map(checksum → absolute URL). */
export function parseAssetUrls(json) {
  const out = new Map();
  for (const [checksum, item] of Object.entries(json?.items || {})) {
    // Only ever download from Apple hosts, whatever the response says.
    if (APPLE_HOST.test(item?.url_location || '') && String(item?.url_path || '').startsWith('/')) {
      out.set(checksum, `https://${item.url_location}${item.url_path}`);
    }
  }
  return out;
}

/**
 * Decide what to do: add new photos, re-import ones whose file changed (or previously failed),
 * and remove ones no longer in the iCloud album. local: [{ id, guid, checksum, status }]
 */
export function planSync(remote, local) {
  const localByGuid = new Map(local.map((l) => [l.guid, l]));
  const remoteGuids = new Set(remote.map((r) => r.guid));
  return {
    add: remote.filter((r) => !localByGuid.has(r.guid)),
    update: remote.filter((r) => {
      const l = localByGuid.get(r.guid);
      return l && (l.checksum !== r.checksum || l.status === 'error');
    }).map((r) => ({ ...r, id: localByGuid.get(r.guid).id })),
    remove: local.filter((l) => !remoteGuids.has(l.guid)),
  };
}

// ---------- network ----------

async function post(host, token, endpoint, body, doFetch, hop = 0) {
  const res = await doFetch(`https://${host}/${token}/sharedstreams/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 330 && hop < 2) {
    let next = res.headers.get('X-Apple-MMe-Host');
    if (!next) next = (await res.json().catch(() => ({})))['X-Apple-MMe-Host'];
    if (next && /^[a-z0-9-]+\.icloud\.com$/i.test(next)) return post(next, token, endpoint, body, doFetch, hop + 1);
  }
  if (res.status === 404 || res.status === 400) throw new Error('iCloud could not find that album. Is "Public Website" still switched on?');
  if (!res.ok) throw new Error(`iCloud answered HTTP ${res.status}`);
  return { json: await res.json(), host };
}

export async function fetchRemoteAlbum(token, doFetch = fetch) {
  let first;
  try {
    first = await post(streamHost(token), token, 'webstream', { streamCtag: null }, doFetch);
  } catch (err) {
    if (err?.cause?.code !== 'ENOTFOUND') throw err;
    first = await post(FALLBACK_HOST, token, 'webstream', { streamCtag: null }, doFetch); // host guess was wrong; Apple redirects
  }
  return { ...parseWebstream(first.json), host: first.host };
}

async function fetchAssetUrls(host, token, guids, doFetch = fetch) {
  const urls = new Map();
  for (let i = 0; i < guids.length; i += 20) {
    const { json } = await post(host, token, 'webasseturls', { photoGuids: guids.slice(i, i + 20) }, doFetch);
    for (const [k, v] of parseAssetUrls(json)) urls.set(k, v);
  }
  return urls;
}

async function download(url, dest, doFetch = fetch) {
  const res = await doFetch(url, { signal: AbortSignal.timeout(180000) });
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status})`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_UPLOAD_BYTES) throw new Error('file too large');
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
}

// ---------- sync ----------

const syncing = new Set();
export const syncingAlbumIds = () => [...syncing];

/** Queue a sync for one album (ignored if one is already queued/running). */
export function startAlbumSync(albumId) {
  if (syncing.has(albumId)) return false;
  syncing.add(albumId);
  enqueue(`sync album ${albumId}`, () => syncAlbum(albumId).finally(() => syncing.delete(albumId)));
  return true;
}

export async function syncAlbum(albumId, doFetch = fetch) {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(albumId);
  if (!album?.icloud_url) return;
  const setErr = (msg) => db.prepare('UPDATE albums SET sync_error = ? WHERE id = ?').run(msg, albumId);
  try {
    const token = parseSharedAlbumToken(album.icloud_url);
    if (!token) throw new Error('Invalid iCloud link');
    const remote = await fetchRemoteAlbum(token, doFetch);
    const local = db.prepare("SELECT id, icloud_guid AS guid, icloud_checksum AS checksum, status FROM photos WHERE album_id = ? AND icloud_guid IS NOT NULL").all(albumId);
    if (!remote.photos.length && local.length) throw new Error('iCloud returned an empty album, so nothing was removed. Try again later.');

    const plan = planSync(remote.photos, local);
    const want = [...plan.add, ...plan.update];
    const urls = want.length ? await fetchAssetUrls(remote.host, token, want.map((w) => w.guid), doFetch) : new Map();

    for (const gone of plan.remove) await deletePhoto(gone.id);

    const queueDownload = (photoId, url, label) => enqueue(label, async () => {
      const tmp = path.join(DIRS.tmp, `${crypto.randomBytes(12).toString('hex')}.upload`);
      try {
        await download(url, tmp, doFetch);
      } catch (err) {
        await fsp.rm(tmp, { force: true });
        db.prepare("UPDATE photos SET status='error', error=? WHERE id=?").run(`Download failed: ${err.message}`.slice(0, 300), photoId);
        return;
      }
      await processPhoto(photoId, tmp);
    });

    let missingUrl = 0;
    for (const p of plan.add) {
      const url = urls.get(p.checksum);
      if (!url) { missingUrl++; continue; }
      const info = db.prepare(`INSERT INTO photos (album_id, source, original_name, caption, taken_at, icloud_guid, icloud_checksum, sort_order, status)
        VALUES (?, 'icloud', ?, ?, ?, ?, ?, ?, 'processing')`)
        .run(albumId, `${p.guid}.jpg`, p.caption, p.takenAt, p.guid, p.checksum, nextPhotoOrder(albumId));
      queueDownload(Number(info.lastInsertRowid), url, `icloud photo ${p.guid}`);
    }
    for (const p of plan.update) {
      const url = urls.get(p.checksum);
      if (!url) { missingUrl++; continue; }
      db.prepare("UPDATE photos SET status='processing', error='', icloud_checksum=? WHERE id=?").run(p.checksum, p.id);
      queueDownload(p.id, url, `icloud photo ${p.guid}`);
    }

    if (remote.name && album.title === 'New album') db.prepare('UPDATE albums SET title = ? WHERE id = ?').run(remote.name.slice(0, 120), albumId);
    db.prepare("UPDATE albums SET last_synced_at = datetime('now'), sync_error = ? WHERE id = ?")
      .run(missingUrl ? `${missingUrl} photo(s) had no download link and will be retried next sync` : '', albumId);
  } catch (err) {
    setErr(String(err.message || err).slice(0, 300));
    console.error(`[icloud] album ${albumId}:`, err.message || err);
  }
}

/** Hourly check: sync albums whose last sync is older than the configured interval. */
export function startScheduler() {
  const tick = () => {
    const hours = Number(getSetting('icloud_sync_hours'));
    if (!hours) return;
    const due = db.prepare(`SELECT id FROM albums WHERE icloud_url != '' AND icloud_auto_sync = 1
      AND (last_synced_at IS NULL OR last_synced_at < datetime('now', ?)) ORDER BY last_synced_at IS NOT NULL, last_synced_at`)
      .all(`-${hours} hours`);
    for (const { id } of due) startAlbumSync(id);
  };
  setTimeout(tick, 30 * 1000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
}
