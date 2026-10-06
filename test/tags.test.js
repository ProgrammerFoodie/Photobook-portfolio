import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeJpeg } from './helpers.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'photolib-tags-'));
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/auth.js');
const { setSetting, db } = await import('../src/db.js');
const { idle } = await import('../src/queue.js');
const { tagSlug, parseTagList } = await import('../src/tags.js');

test('tagSlug is case/accent-insensitive and unicode-aware', () => {
  assert.equal(tagSlug('BMW M3'), 'bmw-m3');
  assert.equal(tagSlug('  bmw   m3 '), 'bmw-m3');
  assert.equal(tagSlug('Rīga'), 'riga');
  assert.equal(tagSlug('БМВ М3'), 'бмв-м3');
  assert.equal(tagSlug('#42'), '42');
  assert.equal(tagSlug('AB-1234'), 'ab-1234');
  assert.equal(tagSlug('🔥🔥'), '');
  assert.equal(tagSlug(null), '');
});

test('parseTagList splits, cleans, de-duplicates and caps', () => {
  assert.deepEqual(parseTagList('BMW M3, #42;\nblue,  bmw m3 ,,🔥'), ['BMW M3', '#42', 'blue']);
  assert.deepEqual(parseTagList(['A', 'a', 'B']), ['A', 'B']);
  assert.equal(parseTagList(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 12);
  assert.equal(parseTagList('x'.repeat(100))[0].length, 40);
  assert.deepEqual(parseTagList(undefined), []);
});

// ---------- API / public behaviour ----------
let server, base, cookie = '';
const UA = { 'user-agent': 'Mozilla/5.0 (test browser)' };
const call = (url, { method = 'GET', json, form, auth = true, headers = {} } = {}) => {
  const h = { ...UA, ...headers };
  if (auth && cookie) h.cookie = cookie;
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  if (json !== undefined || form || method !== 'GET') h['X-Photolib'] = '1';
  return fetch(base + url, { method, headers: h, body, redirect: 'manual' });
};
const api = async (method, url, json) => { const res = await call(`/admin/api${url}`, { method, json }); return { res, body: await res.json().catch(() => ({})) }; };
const albumData = async (url) => {
  const html = await (await call(url, { auth: false })).text();
  const m = html.match(/id="album-data">(.*?)<\/script>/s);
  return { html, data: m ? JSON.parse(m[1]) : null };
};
let album, ids;

before(async () => {
  setSetting('admin_password', hashPassword('pw-for-tests-123'));
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await call('/admin/api/login', { method: 'POST', json: { password: 'pw-for-tests-123' }, auth: false });
  cookie = login.headers.getSetCookie()[0].split(';')[0];

  album = (await api('POST', '/albums', { title: 'Drift Day', category: 'Cars' })).body.album;
  const form = new FormData();
  for (let i = 0; i < 5; i++) form.append('files', new Blob([await makeJpeg(1200 + i * 50, 800, '#E37C44')], { type: 'image/jpeg' }), `car-${i + 1}.jpg`);
  await call(`/admin/api/albums/${album.id}/photos`, { method: 'POST', form });
  await idle();
  ids = (await api('GET', `/albums/${album.id}`)).body.photos.map((p) => p.id);
  await api('PATCH', `/albums/${album.id}`, { is_published: true });
});
after(() => server.close());

test('bulk tagging validates input and returns the new tags', async () => {
  const tag = (body) => api('POST', `/albums/${album.id}/tags`, body);
  assert.equal((await tag({ photo_ids: [], add: 'x' })).res.status, 400);
  assert.equal((await tag({ photo_ids: [ids[0]] })).res.status, 400, 'nothing to do');
  assert.equal((await tag({ photo_ids: [999999], add: 'x' })).res.status, 400, 'foreign photo');
  assert.equal((await call(`/admin/api/albums/${album.id}/tags`, { method: 'POST', json: { photo_ids: [ids[0]], add: 'x' }, auth: false })).status, 401);

  let r = await tag({ photo_ids: [ids[0], ids[1]], add: 'BMW M3, #42' });
  assert.equal(r.res.status, 200);
  assert.equal(r.body.added, 4);
  assert.deepEqual(r.body.photos[ids[0]], ['#42', 'BMW M3']);
  await tag({ photo_ids: [ids[0]], add: 'blue, bmw m3' });        // same tag, different spelling → no duplicate
  r = await tag({ photo_ids: [ids[2]], add: 'Audi RS3, <img src=x onerror=alert(1)>' });
  assert.equal(r.body.photos[ids[2]].length, 2);
  await tag({ photo_ids: [ids[4]], add: 'Hidden Car' });
  await api('PATCH', `/photos/${ids[4]}`, { is_hidden: true });

  const album1 = (await api('GET', `/albums/${album.id}`)).body.photos;
  assert.deepEqual(album1.find((p) => p.id === ids[0]).tags, ['#42', 'blue', 'BMW M3']);
  assert.deepEqual(album1.find((p) => p.id === ids[3]).tags, []);
});

test('per-photo tag limit is enforced', async () => {
  const many = Array.from({ length: 12 }, (_, i) => `limit${i}`);
  await api('POST', `/albums/${album.id}/tags`, { photo_ids: [ids[3]], add: many });
  const r = await api('POST', `/albums/${album.id}/tags`, { photo_ids: [ids[3]], add: 'one more' });
  assert.equal(r.body.skipped, 1);
  assert.equal(r.body.photos[ids[3]].length, 12);
  await api('POST', `/albums/${album.id}/tags`, { photo_ids: [ids[3]], remove: many });
  assert.deepEqual((await api('GET', `/albums/${album.id}`)).body.photos.find((p) => p.id === ids[3]).tags, []);
  assert.equal((await api('GET', '/tags')).body.tags.some((t) => t.name === 'limit3'), false, 'unused tags are pruned');
});

test('album page filters by tag and by search; links and counts follow', async () => {
  const ofIds = async (url) => (await albumData(url)).data.photos.map((p) => p.id);
  assert.deepEqual(await ofIds('/a/drift-day'), ids.slice(0, 4), 'hidden photo is not listed');
  assert.deepEqual(await ofIds('/a/drift-day?tag=bmw-m3'), [ids[0], ids[1]]);
  assert.deepEqual(await ofIds('/a/drift-day?tag=BMW%20M3'), [ids[0], ids[1]], 'tag param is normalised');
  assert.deepEqual(await ofIds('/a/drift-day?q=m3'), [ids[0], ids[1]]);
  assert.deepEqual(await ofIds('/a/drift-day?q=bm'), [ids[0], ids[1]], 'prefix search');
  assert.deepEqual(await ofIds('/a/drift-day?q=blue%20m3'), [ids[0]], 'every word must match');
  assert.deepEqual(await ofIds('/a/drift-day?q=rs'), [ids[2]]);
  assert.deepEqual(await ofIds('/a/drift-day?q=42'), [ids[0], ids[1]]);
  assert.deepEqual(await ofIds('/a/drift-day?q=hidden'), [], 'hidden photos never match');
  assert.deepEqual(await ofIds('/a/drift-day?q=%25'), [], '% is not a wildcard');
  assert.deepEqual(await ofIds('/a/drift-day?q=_'), [], '_ is not a wildcard');
  assert.deepEqual(await ofIds('/a/drift-day?tag=nope'), []);

  const { html, data } = await albumData('/a/drift-day?tag=bmw-m3');
  assert.match(html, /2 photos for <strong>BMW M3<\/strong>/);
  assert.match(html, /<title>BMW M3 · Drift Day/);
  assert.match(html, /Download these 2/);
  assert.match(html, /href="\/a\/drift-day\/p\/\d+\?tag=bmw-m3"/, 'photo links carry the filter');
  assert.deepEqual(data.photos[0].t.map((t) => t[1]), ['42', 'blue', 'bmw-m3']);
  const all = (await albumData('/a/drift-day')).html;
  assert.match(all, /BMW M3 <span class="n">2<\/span>/);
  assert.ok(!all.includes('Hidden Car'), 'tags of hidden photos are not exposed');
  assert.ok(!all.includes('<img src=x onerror'), 'tag names are escaped');
  assert.match(all, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.ok(!(await albumData('/a/drift-day?q=%3Cscript%3E')).html.includes('<script>alert'), 'search text is escaped');
});

test('deep links respect the filter', async () => {
  const res = await call(`/a/drift-day/p/${ids[1]}?tag=bmw-m3`, { auth: false });
  assert.equal(res.status, 200);
  assert.match(await res.text(), new RegExp(`"openId":${ids[1]}`));
  const out = await call(`/a/drift-day/p/${ids[2]}?tag=bmw-m3`, { auth: false });
  assert.equal(out.status, 302, 'photo not in the filtered set → back to the album');
  assert.equal(out.headers.get('location'), '/a/drift-day');
});

test('filtered zip contains only the matching photos with album-wide numbering', async () => {
  const res = await call('/dl/a/drift-day.zip?tag=bmw-m3', { auth: false });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /filename="drift-day-bmw-m3\.zip"/);
  const file = path.join(process.env.DATA_DIR, 'f.zip');
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const listing = execFileSync('unzip', ['-l', file]).toString();
  execFileSync('unzip', ['-tq', file]);
  assert.match(listing, /2 files/);
  assert.match(listing, /001-car-1\.jpg/);
  assert.match(listing, /002-car-2\.jpg/);
  assert.equal((await call('/dl/a/drift-day.zip?tag=nope', { auth: false })).status, 404, 'empty selection');
});

test('site-wide search spans published albums only', async () => {
  const draft = (await api('POST', '/albums', { title: 'Secret Draft' })).body.album;
  const form = new FormData();
  form.append('files', new Blob([await makeJpeg(900, 600)], { type: 'image/jpeg' }), 'd.jpg');
  await call(`/admin/api/albums/${draft.id}/photos`, { method: 'POST', form });
  await idle();
  const dp = (await api('GET', `/albums/${draft.id}`)).body.photos[0];
  await api('POST', `/albums/${draft.id}/tags`, { photo_ids: [dp.id], add: 'BMW M3' });

  const html = await (await call('/search?q=m3', { auth: false })).text();
  assert.match(html, /2 photos for <strong>“m3”/);
  assert.match(html, /href="\/a\/drift-day\?q=m3"/);
  assert.ok(!html.includes('Secret Draft'));
  assert.match(html, /name="robots" content="noindex"/);
  assert.match(await (await call('/search?q=zzzz', { auth: false })).text(), /No photos found/);
  assert.equal((await call('/search', { auth: false })).status, 200);
  const home = await (await call('/', { auth: false })).text();
  assert.match(home, /action="\/search"/);
  assert.match(home, /<option value="BMW M3">/);
});

test('tag manager: rename, merge, delete; deletions prune orphans', async () => {
  let tags = (await api('GET', '/tags')).body.tags;
  const find = (name) => tags.find((t) => t.name === name);
  assert.equal(find('BMW M3').photos, 3, 'includes the unpublished draft photo');

  // rename keeps photos
  let r = await api('PATCH', `/tags/${find('blue').id}`, { name: 'Blue' });
  assert.equal(r.body.merged, false);
  // merge Audi RS3 into BMW M3
  r = await api('PATCH', `/tags/${find('Audi RS3').id}`, { name: 'bmw m3' });
  assert.equal(r.body.merged, true);
  tags = r.body.tags;
  assert.equal(find('BMW M3').photos, 4);
  assert.equal(find('Audi RS3'), undefined);
  assert.equal((await api('PATCH', `/tags/${find('Blue').id}`, { name: '🔥' })).res.status, 400);
  assert.equal((await api('PATCH', '/tags/99999', { name: 'x' })).res.status, 404);

  assert.equal((await api('DELETE', `/tags/${find('#42').id}`)).res.status, 200);
  assert.deepEqual((await albumData('/a/drift-day?q=42')).data.photos, []);

  // removing a photo / album prunes tags nobody uses any more
  await api('DELETE', `/photos/${ids[0]}`);
  assert.equal((await api('GET', '/tags')).body.tags.some((t) => t.name === 'Blue'), false);
  await api('DELETE', `/albums/${album.id}`);
  const left = db.prepare('SELECT COUNT(*) n FROM tags').get().n;
  assert.equal(left, db.prepare('SELECT COUNT(DISTINCT tag_id) n FROM photo_tags').get().n, 'no orphan tags');
});
