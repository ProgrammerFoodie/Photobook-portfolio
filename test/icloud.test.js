import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { makeJpeg } from './helpers.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'photolib-icloud-'));
const icloud = await import('../src/icloud.js');
const { db } = await import('../src/db.js');
const { idle } = await import('../src/queue.js');
const webstream = JSON.parse(fs.readFileSync(new URL('./fixtures/webstream.json', import.meta.url), 'utf8'));
const assetUrls = JSON.parse(fs.readFileSync(new URL('./fixtures/webasseturls.json', import.meta.url), 'utf8'));

test('parseSharedAlbumToken accepts only icloud.com shared album links', () => {
  assert.equal(icloud.parseSharedAlbumToken('https://www.icloud.com/sharedalbum/#B0aGAbCdEf123456'), 'B0aGAbCdEf123456');
  assert.equal(icloud.parseSharedAlbumToken('  https://icloud.com/sharedalbum/#B0aGAbCdEf123456 '), 'B0aGAbCdEf123456');
  for (const bad of ['https://evil.com/sharedalbum/#B0aGAbCdEf123456', 'https://www.icloud.com/other/#B0aGAbCdEf123456', 'B0aGAbCdEf123456', '', 'https://www.icloud.com/sharedalbum/#short']) {
    assert.equal(icloud.parseSharedAlbumToken(bad), null, bad);
  }
});

test('streamHost derives the partition from the token', () => {
  assert.equal(icloud.streamHost('A5xxxxxxxx'), 'p05-sharedstreams.icloud.com');
  assert.match(icloud.streamHost('B0aGAbCdEf123456'), /^p\d\d+-sharedstreams\.icloud\.com$/);
});

test('parseWebstream picks the largest derivative and skips videos/broken entries', () => {
  const r = icloud.parseWebstream(webstream);
  assert.equal(r.name, 'Spa 2026');
  assert.deepEqual(r.photos.map((p) => p.guid), ['G-1', 'G-2']);
  assert.equal(r.photos[0].checksum, 'c-1-big');
  assert.equal(r.photos[0].width, 2049);
  assert.equal(r.photos[0].caption, 'Pit lane');
  assert.equal(r.photos[0].takenAt, '2026-09-12T10:00:00.000Z');
  assert.equal(r.photos[1].checksum, 'c-2');
});

test('parseAssetUrls only returns Apple hosts', () => {
  const urls = icloud.parseAssetUrls(assetUrls);
  assert.deepEqual([...urls.keys()].sort(), ['c-1-big', 'c-2']);
  assert.equal(urls.get('c-1-big'), 'https://cvws.icloud-content.com/S/abc/one.JPG?x=1');
});

test('planSync computes add / update / remove', () => {
  const remote = [{ guid: 'a', checksum: '1' }, { guid: 'b', checksum: '2new' }, { guid: 'c', checksum: '3' }, { guid: 'd', checksum: '4' }];
  const local = [
    { id: 10, guid: 'a', checksum: '1', status: 'ready' },
    { id: 11, guid: 'b', checksum: '2', status: 'ready' },
    { id: 12, guid: 'd', checksum: '4', status: 'error' },
    { id: 13, guid: 'gone', checksum: '9', status: 'ready' },
  ];
  const plan = icloud.planSync(remote, local);
  assert.deepEqual(plan.add.map((p) => p.guid), ['c']);
  assert.deepEqual(plan.update.map((p) => [p.guid, p.id]), [['b', 11], ['d', 12]]);
  assert.deepEqual(plan.remove.map((p) => p.id), [13]);
  const same = icloud.planSync([{ guid: 'a', checksum: '1' }], [{ id: 1, guid: 'a', checksum: '1', status: 'ready' }]);
  assert.deepEqual([same.add.length, same.update.length, same.remove.length], [0, 0, 0]);
});

// ---- full sync against a stubbed Apple ----
function stubFetch(state) {
  const jpg = { 'c-1-big': state.jpg1, 'c-2': state.jpg2 };
  return async (url, opts = {}) => {
    const u = String(url);
    const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
    if (u.endsWith('/sharedstreams/webstream')) {
      state.calls.push('webstream');
      if (state.redirectOnce) { state.redirectOnce = false; return json({ 'X-Apple-MMe-Host': 'p99-sharedstreams.icloud.com' }, 330); }
      return json(state.stream);
    }
    if (u.endsWith('/sharedstreams/webasseturls')) { state.calls.push('assets'); return json(assetUrls); }
    if (u.startsWith('https://cvws.icloud-content.com/')) {
      state.calls.push('download');
      const entry = Object.entries(assetUrls.items).find(([, v]) => u.endsWith(v.url_path));
      return new Response(jpg[entry[0]] ?? jpg['c-1-big'], { status: 200, headers: { 'content-length': String((jpg[entry[0]] ?? jpg['c-1-big']).length) } });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
}

test('syncAlbum imports, is idempotent, updates, removes, and never empties an album on a blank response', async () => {
  const state = {
    calls: [], redirectOnce: true, stream: structuredClone(webstream),
    jpg1: await makeJpeg(2049, 1366, '#E37C44'), jpg2: await makeJpeg(1366, 2049, '#BA6538'),
  };
  const doFetch = stubFetch(state);
  const info = db.prepare("INSERT INTO albums (slug, title, icloud_url, is_published) VALUES ('spa', 'New album', 'https://www.icloud.com/sharedalbum/#B0aGAbCdEf123456', 1)").run();
  const albumId = Number(info.lastInsertRowid);
  const photos = () => db.prepare('SELECT * FROM photos WHERE album_id = ? ORDER BY sort_order').all(albumId);

  await icloud.syncAlbum(albumId, doFetch);
  await idle();
  let rows = photos();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.status === 'ready' && r.source === 'icloud'), JSON.stringify(rows.map((r) => [r.status, r.error])));
  assert.equal(rows[0].caption, 'Pit lane');
  assert.equal(rows[0].taken_at, '2026-09-12T10:00:00.000Z', 'falls back to iCloud capture date');
  assert.equal(db.prepare('SELECT title FROM albums WHERE id = ?').get(albumId).title, 'Spa 2026');
  assert.ok(db.prepare('SELECT cover_photo_id FROM albums WHERE id = ?').get(albumId).cover_photo_id, 'cover assigned');
  assert.equal(db.prepare('SELECT sync_error FROM albums WHERE id = ?').get(albumId).sync_error, '');
  assert.ok(state.calls.filter((c) => c === 'webstream').length >= 2, 'followed the 330 redirect');

  // admin edits survive a re-sync; nothing is downloaded again
  db.prepare('UPDATE photos SET caption = ?, is_hidden = 1 WHERE id = ?').run('Mine', rows[0].id);
  state.calls.length = 0;
  await icloud.syncAlbum(albumId, doFetch); await idle();
  assert.equal(state.calls.filter((c) => c === 'download').length, 0);
  rows = photos();
  assert.equal(rows[0].caption, 'Mine');
  assert.equal(rows[0].is_hidden, 1);

  // changed checksum → re-import just that photo
  state.stream.photos[1].derivatives['2049'].checksum = 'c-2'; // unchanged id, same checksum for asset lookup
  state.stream.photos[0].derivatives['2049'].checksum = 'c-1-big'; // keep lookup valid
  db.prepare("UPDATE photos SET icloud_checksum = 'old' WHERE id = ?").run(rows[1].id);
  state.calls.length = 0;
  await icloud.syncAlbum(albumId, doFetch); await idle();
  assert.equal(state.calls.filter((c) => c === 'download').length, 1);
  assert.equal(photos()[1].icloud_checksum, 'c-2');
  assert.equal(photos()[1].status, 'ready');

  // photo removed from iCloud → removed here
  state.stream.photos = state.stream.photos.slice(0, 1);
  await icloud.syncAlbum(albumId, doFetch); await idle();
  assert.deepEqual(photos().map((r) => r.icloud_guid), ['G-1']);

  // blank response must not wipe the album
  state.stream.photos = [];
  await icloud.syncAlbum(albumId, doFetch); await idle();
  assert.equal(photos().length, 1);
  assert.match(db.prepare('SELECT sync_error FROM albums WHERE id = ?').get(albumId).sync_error, /empty album/);
});

test('syncAlbum reports a friendly error when the album is not public', async () => {
  const info = db.prepare("INSERT INTO albums (slug, title, icloud_url) VALUES ('gone', 'Gone', 'https://www.icloud.com/sharedalbum/#B0aGAbCdEf999999')").run();
  await icloud.syncAlbum(Number(info.lastInsertRowid), async () => new Response('{}', { status: 404 }));
  assert.match(db.prepare('SELECT sync_error FROM albums WHERE id = ?').get(Number(info.lastInsertRowid)).sync_error, /Public Website/);
});
