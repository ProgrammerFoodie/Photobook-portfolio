import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import exifr from 'exifr';
import { makeJpeg } from './helpers.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photolib-api-'));
process.env.DATA_DIR = dataDir;
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/auth.js');
const { setSetting } = await import('../src/db.js');
const { idle } = await import('../src/queue.js');

const PASSWORD = 'test-password-123';
let server, base, cookie = '';
const UA = { 'user-agent': 'Mozilla/5.0 (test browser)' };

const call = (url, { method = 'GET', json, form, headers = {}, auth = true, admin = false } = {}) => {
  const h = { ...UA, ...headers };
  if (auth && cookie) h.cookie = cookie;
  if (admin || json || form) h['X-Photolib'] = '1';
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  return fetch(base + url, { method, headers: h, body, redirect: 'manual' });
};
const api = async (method, url, json) => {
  const res = await call(`/admin/api${url}`, { method, json, admin: true });
  return { res, body: await res.json().catch(() => ({})) };
};
const upload = async (albumId, buffers) => {
  const form = new FormData();
  buffers.forEach((b, i) => form.append('files', new Blob([b], { type: 'image/jpeg' }), `shot-${i + 1}.jpg`));
  return call(`/admin/api/albums/${albumId}/photos`, { method: 'POST', form });
};

before(async () => {
  setSetting('admin_password', hashPassword(PASSWORD));
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('admin API requires a session and the CSRF header', async () => {
  assert.equal((await call('/admin/api/albums', { auth: false })).status, 401);
  assert.equal((await call('/admin/api/login', { method: 'POST', json: { password: 'nope' }, auth: false })).status, 401);
  const res = await call('/admin/api/login', { method: 'POST', json: { password: PASSWORD }, auth: false });
  assert.equal(res.status, 200);
  cookie = res.headers.getSetCookie()[0].split(';')[0];
  assert.match(res.headers.getSetCookie()[0], /HttpOnly/i);
  assert.match(res.headers.getSetCookie()[0], /SameSite=Strict/i);
  // mutation without X-Photolib is rejected even with a valid session
  const noHeader = await fetch(`${base}/admin/api/albums`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{"title":"x"}' });
  assert.equal(noHeader.status, 403);
  assert.equal((await call('/admin/api/albums')).status, 200);
});

let album, photoIds;
test('create an album, upload photos, process them', async () => {
  const created = await api('POST', '/albums', { title: 'Track Day', category: 'Cars', date: '2026-09-12' });
  assert.equal(created.res.status, 201);
  album = created.body.album;
  assert.equal(album.slug, 'track-day');
  assert.equal((await api('POST', '/albums', { title: 'Track Day' })).body.album.slug, 'track-day-2', 'slugs are unique');
  assert.equal((await api('POST', '/albums', { title: '' })).res.status, 400);

  const res = await upload(album.id, [await makeJpeg(1600, 1000, '#E37C44'), await makeJpeg(1000, 1600, '#BA6538'), await makeJpeg(1800, 900, '#914F2C')]);
  assert.equal(res.status, 202);
  await idle();
  const { body } = await api('GET', `/albums/${album.id}`);
  photoIds = body.photos.map((p) => p.id);
  assert.equal(body.photos.length, 3);
  assert.ok(body.photos.every((p) => p.status === 'ready'), JSON.stringify(body.photos.map((p) => p.error)));
  assert.deepEqual(body.photos.map((p) => [p.width, p.height]), [[1600, 1000], [1000, 1600], [1800, 900]]);
  assert.equal(body.photos[0].exif.camera, 'Canon EOS R6');
  assert.equal(body.album.cover_photo_id, photoIds[0], 'first photo becomes the cover');
});

test('GPS is stripped from stored originals but camera data is kept', async () => {
  const buf = fs.readFileSync(path.join(dataDir, 'originals', `${photoIds[0]}.jpg`));
  assert.equal(await exifr.gps(buf).catch(() => undefined), undefined);
  assert.equal((await exifr.parse(buf, ['Make'])).Make, 'Canon');
});

test('bad uploads fail cleanly without breaking the album', async () => {
  const form = new FormData();
  form.append('files', new Blob(['not an image at all'], { type: 'image/jpeg' }), 'fake.jpg');
  assert.equal((await call(`/admin/api/albums/${album.id}/photos`, { method: 'POST', form })).status, 202);
  await idle();
  const { body } = await api('GET', `/albums/${album.id}`);
  const bad = body.photos.find((p) => p.original_name === 'fake.jpg');
  assert.equal(bad.status, 'error');
  assert.match(bad.error, /Unsupported|unsupported|Input/i);
  assert.equal((await call(`/img/${bad.id}/thumb.webp`)).status, 404);
  assert.equal((await api('DELETE', `/photos/${bad.id}`)).res.status, 200);
});

test('unpublished albums are invisible to the public, published ones render', async () => {
  assert.equal((await call('/a/track-day', { auth: false })).status, 404);
  assert.equal((await call(`/img/${photoIds[0]}/thumb.webp`, { auth: false })).status, 404);
  assert.equal((await call(`/dl/p/${photoIds[0]}`, { auth: false })).status, 404);
  assert.equal((await call('/a/track-day')).status, 200, 'admin can preview a draft');

  assert.equal((await api('PATCH', `/albums/${album.id}`, { is_published: true })).res.status, 200);
  const page = await call('/a/track-day', { auth: false });
  assert.equal(page.status, 200);
  const html = await page.text();
  const data = JSON.parse(html.match(/id="album-data">(.*?)<\/script>/s)[1]);
  assert.deepEqual(data.photos.map((p) => p.id), photoIds);
  assert.match(html, /property="og:image" content="http:\/\/127\.0\.0\.1:\d+\/img\/\d+\/og\.jpg/);
  assert.match(html, /<title>Track Day · /);
  const home = await (await call('/', { auth: false })).text();
  assert.match(home, /Track Day/);
  const deep = await (await call(`/a/track-day/p/${photoIds[1]}`, { auth: false })).text();
  assert.match(deep, new RegExp(`"openId":${photoIds[1]}`));
  assert.equal((await call('/a/track-day/p/99999', { auth: false })).status, 302);
});

test('images are served with the right types and caching; traversal is blocked', async () => {
  for (const [file, type] of [['thumb.webp', 'image/webp'], ['display.webp', 'image/webp'], ['og.jpg', 'image/jpeg'], ['original', 'image/jpeg']]) {
    const res = await call(`/img/${photoIds[0]}/${file}?v=2`, { auth: false });
    assert.equal(res.status, 200, file);
    assert.equal(res.headers.get('content-type'), type, file);
    assert.match(res.headers.get('cache-control'), /immutable/);
    assert.ok((await res.arrayBuffer()).byteLength > 500);
  }
  for (const bad of ['/img/1/..%2f..%2fsecret', `/img/${photoIds[0]}/other.png`, '/img/abc/thumb.webp', '/dl/a/..%2fx.zip', '/dl/a/track-day.tar']) {
    assert.equal((await call(bad, { auth: false })).status, 404, bad);
  }
});

test('likes toggle per visitor and persist', async () => {
  const like = (cookies = '') => call(`/api/like/${photoIds[0]}`, { method: 'POST', auth: false, headers: cookies ? { cookie: cookies } : {} });
  const first = await like();
  assert.deepEqual(await first.clone().json(), { liked: true, count: 1 });
  const vid = first.headers.getSetCookie()[0].split(';')[0];
  assert.match(first.headers.getSetCookie()[0], /HttpOnly/i);
  assert.deepEqual(await (await like(vid)).json(), { liked: false, count: 0 });
  assert.deepEqual(await (await like(vid)).json(), { liked: true, count: 1 });
  assert.deepEqual(await (await like()).json(), { liked: true, count: 2 }, 'a second visitor');

  const html = await (await call('/a/track-day', { auth: false, headers: { cookie: vid } })).text();
  const data = JSON.parse(html.match(/id="album-data">(.*?)<\/script>/s)[1]);
  assert.deepEqual([data.photos[0].liked, data.photos[0].likes, data.photos[1].liked], [1, 2, 0]);
  assert.equal((await call('/api/like/99999', { method: 'POST', auth: false })).status, 404);
});

test('single download and zip download work and count', async () => {
  const one = await call(`/dl/p/${photoIds[1]}`, { auth: false });
  assert.equal(one.status, 200);
  assert.match(one.headers.get('content-disposition'), /attachment; filename="track-day-002\.jpg"/);
  const original = fs.readFileSync(path.join(dataDir, 'originals', `${photoIds[1]}.jpg`));
  assert.ok(Buffer.from(await one.arrayBuffer()).equals(original));

  const zip = await call('/dl/a/track-day.zip', { auth: false });
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  const file = path.join(dataDir, 'test.zip');
  fs.writeFileSync(file, Buffer.from(await zip.arrayBuffer()));
  const listing = execFileSync('unzip', ['-l', file]).toString();
  execFileSync('unzip', ['-tq', file]);
  assert.match(listing, /3 files/);
  assert.match(listing, /track-day\/001-shot-1\.jpg/);

  const stats = (await api('GET', '/stats')).body;
  assert.equal(stats.totals.downloads, 1);
  assert.equal(stats.totals.zip_downloads, 1);
  assert.equal(stats.totals.likes, 2);
});

test('hidden photos and disabled downloads are respected', async () => {
  await api('PATCH', `/photos/${photoIds[2]}`, { is_hidden: true });
  assert.equal((await call(`/img/${photoIds[2]}/thumb.webp`, { auth: false })).status, 404);
  assert.equal((await call(`/img/${photoIds[2]}/thumb.webp`)).status, 200, 'admin still sees it');
  const html = await (await call('/a/track-day', { auth: false })).text();
  assert.deepEqual(JSON.parse(html.match(/id="album-data">(.*?)<\/script>/s)[1]).photos.map((p) => p.id), photoIds.slice(0, 2));

  await api('PATCH', `/albums/${album.id}`, { allow_download: false });
  assert.equal((await call(`/dl/p/${photoIds[0]}`, { auth: false })).status, 404);
  assert.equal((await call('/dl/a/track-day.zip', { auth: false })).status, 404);
  await api('PATCH', `/albums/${album.id}`, { allow_download: true });
});

test('deleting a photo removes its files; deleting an album cascades', async () => {
  assert.equal((await api('DELETE', `/photos/${photoIds[2]}`)).res.status, 200);
  assert.equal(fs.existsSync(path.join(dataDir, 'originals', `${photoIds[2]}.jpg`)), false);
  assert.equal(fs.existsSync(path.join(dataDir, 'derived', String(photoIds[2]))), false);
  assert.equal((await api('DELETE', `/albums/${album.id}`)).res.status, 200);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'originals')), []);
  assert.equal((await call('/a/track-day', { auth: false })).status, 404);
});

test('settings and palette changes reach the public site', async () => {
  const bad = await api('PATCH', '/settings', { site_title: '   ' });
  assert.equal(bad.res.status, 400);
  const { res, body } = await api('PATCH', '/settings', { site_title: 'Ugis Photo', theme: { accent: '#112233', base: 'javascript:alert(1)' }, about: 'Hi <script>alert(1)</script>\n\nSee https://example.com' });
  assert.equal(res.status, 200);
  assert.equal(body.theme.accent, '#112233');
  assert.equal(body.theme.base, '#402313', 'invalid colour falls back');
  const css = await (await call('/theme.css?v=9', { auth: false })).text();
  assert.match(css, /--accent:#112233/);
  assert.ok(!css.includes('javascript'));
  const about = await (await call('/about', { auth: false })).text();
  assert.ok(!about.includes('<script>alert'), 'about text is escaped');
  assert.match(about, /<a href="https:\/\/example\.com"/);
  assert.match(await (await call('/', { auth: false })).text(), /<title>Ugis Photo/);
  assert.equal((await api('PATCH', '/settings', { theme: null })).body.theme.accent, '#E37C44', 'reset to defaults');
});

test('About text: the admin preview matches the public pages, and the title page cuts the intro at 256 characters', async () => {
  const long = `${'Long intro word '.repeat(30).trim()}\n\n- Nikon D50\n- Nikon D300s\n\nLater **bold** paragraph.`;
  const preview = await api('POST', '/about/preview', { text: long });
  assert.equal(preview.res.status, 200);
  assert.equal(preview.body.intro.max, 256);
  assert.equal(preview.body.intro.truncated, true);
  assert.ok(preview.body.intro.shown.length <= 256);
  assert.match(preview.body.html, /<ul><li>Nikon D50<\/li><li>Nikon D300s<\/li><\/ul>/);
  assert.match(preview.body.html, /<strong>bold<\/strong>/);
  assert.ok(!(await call('/admin/api/about/preview', { method: 'POST', json: { text: 'x' }, auth: false })).ok, 'preview needs a signed-in admin');

  await api('PATCH', '/settings', { about: long });
  const about = await (await call('/about', { auth: false })).text();
  assert.match(about, /<ul><li>Nikon D50<\/li>/, 'the About page shows the lists');
  assert.match(about, /Later <strong>bold<\/strong> paragraph/);
  await api('PATCH', '/settings', { about: '' });
});

test('login is rate limited', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await call('/admin/api/login', { method: 'POST', json: { password: 'wrong' }, auth: false });
  assert.equal(last.status, 429);
});
