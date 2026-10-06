import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { makeJpeg } from './helpers.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'photolib-hl-'));
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/auth.js');
const { setSetting, db } = await import('../src/db.js');
const { idle } = await import('../src/queue.js');
const { getHighlightIds } = await import('../src/store.js');
const { derivePaper, deriveLink, deriveBg, contrastRatio, buildThemeCss, DEFAULT_THEME } = await import('../src/theme.js');

let server, base, cookie = '', ids = [], album, draft;
const call = (url, { method = 'GET', json, form, auth = true } = {}) => {
  const h = { 'user-agent': 'Mozilla/5.0 (test)' };
  if (auth && cookie) h.cookie = cookie;
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  if (json !== undefined || form || method !== 'GET') h['X-Photolib'] = '1';
  return fetch(base + url, { method, headers: h, body, redirect: 'manual' });
};
const api = async (method, url, json) => { const res = await call(`/admin/api${url}`, { method, json }); return { res, body: await res.json().catch(() => ({})) }; };
const upload = async (albumId, n, w = 1400, h = 900) => {
  const form = new FormData();
  for (let i = 0; i < n; i++) form.append('files', new Blob([await makeJpeg(w, h, '#BA6538')], { type: 'image/jpeg' }), `p${i}.jpg`);
  await call(`/admin/api/albums/${albumId}/photos`, { method: 'POST', form });
  await idle();
};
const home = async () => (await call('/', { auth: false })).text();
const plates = (html) => [...html.matchAll(/class="plate ([^"]*)"[^>]*><a href="\/a\/[^/]+\/p\/(\d+)"/g)].map((m) => [m[1], Number(m[2])]);

before(async () => {
  setSetting('admin_password', hashPassword('pw-for-tests-123'));
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await call('/admin/api/login', { method: 'POST', json: { password: 'pw-for-tests-123' }, auth: false });
  cookie = login.headers.getSetCookie()[0].split(';')[0];
  album = (await api('POST', '/albums', { title: 'Shown', category: 'Cars' })).body.album;
  await upload(album.id, 6);
  await api('PATCH', `/albums/${album.id}`, { is_published: true });
  ids = (await api('GET', `/albums/${album.id}`)).body.photos.map((p) => p.id);
  draft = (await api('POST', '/albums', { title: 'Draft' })).body.album;
  await upload(draft.id, 1);
});
after(() => server.close());

test('landing page without highlights falls back to the first album cover', async () => {
  const html = await home();
  assert.match(html, /class="cover page face front"/);
  assert.match(html, /UGIS|Photolib/i);
  assert.ok(!html.includes('class="flip"') && !html.includes('class="leaf right page"'), 'no opening spread without a second highlight');
  assert.match(html, /class="chapters"/);
  assert.match(html, /<span class="num">01<\/span>/);
});

test('highlights are validated and saved in order', async () => {
  const draftPhoto = (await api('GET', `/albums/${draft.id}`)).body.photos[0].id;
  assert.equal((await api('PATCH', '/settings', { highlights: 'x' })).res.status, 400);
  assert.equal((await api('PATCH', '/settings', { highlights: ids.concat([999999]) })).res.status, 400, 'unknown photo / too many');
  assert.equal((await api('PATCH', '/settings', { highlights: [ids[0], 999999] })).res.status, 400);
  assert.equal((await call('/admin/api/settings', { method: 'PATCH', json: { highlights: [ids[0]] }, auth: false })).status, 401);

  const r = await api('PATCH', '/settings', { highlights: [ids[2], ids[1], ids[1], ids[0], ids[3]] });
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.body.highlights.map((h) => h.id), [ids[2], ids[1], ids[0], ids[3]], 'de-duplicated, order kept');
  assert.equal(r.body.maxHighlights, 5);
  assert.deepEqual(getHighlightIds(), [ids[2], ids[1], ids[0], ids[3]]);

  // an unpublished album's photo can be a highlight in the admin, but is never shown publicly
  assert.equal((await api('PATCH', '/settings', { highlights: [ids[2], draftPhoto] })).res.status, 200);
  const pub = plates(await home()).map(([, id]) => id);
  assert.ok(!pub.includes(draftPhoto));
  await api('PATCH', '/settings', { highlights: [ids[2], ids[1], ids[0], ids[3], ids[4]] });
});

test('landing page lays the highlights out as cover, large page and small photos', async () => {
  const html = await home();
  const found = plates(html);
  assert.equal(found.length, 5);
  const byClass = (c) => found.filter(([cls]) => cls.includes(c)).map(([, id]) => id);
  assert.deepEqual(byClass('cover-photo'), [ids[2]], 'slot 1 is the cover');
  assert.deepEqual(byClass('big'), [ids[1]], 'slot 2 is the large page');
  assert.deepEqual(byClass('tall'), [ids[0]]);
  assert.deepEqual(byClass('square'), [ids[3]]);
  assert.deepEqual(byClass('grow'), [ids[4]]);
  assert.match(html, /class="flip"/, 'the cover flips open');
  assert.match(html, /class="leaf right page"/, 'the large photo is the right-hand page');
  assert.match(html, /class="page face back left"/, 'the cover\'s back is the left page');
  assert.match(html, new RegExp(`property="og:image" content="[^"]*/img/${ids[2]}/og\\.jpg`), 'cover photo is the link preview');
  assert.match(html, /Page 2/);
});

test('cover and intro texts come from settings and are escaped', async () => {
  const r = await api('PATCH', '/settings', {
    site_title: 'Ugis <b>Photo</b>', tagline: 'Cars & Drift', cover_subtitle: 'Portfolio 2026', intro_title: 'Hello "you"',
    about: 'First paragraph about me.\n\nSecond paragraph that should not appear on the cover spread.',
  });
  assert.equal(r.res.status, 200);
  const html = await home();
  assert.match(html, /<h1 class="cover-title">Ugis &lt;b&gt;Photo&lt;\/b&gt;<small>Portfolio 2026<\/small>/);
  assert.match(html, /Cars &amp; Drift/);
  assert.match(html, /<h2>Hello &quot;you&quot;<\/h2>/);
  assert.match(html, /First paragraph about me\./);
  const left = html.slice(html.indexOf('class="page face back left"'), html.indexOf('</article>', html.indexOf('class="page face back left"')));
  assert.ok(left.includes('First paragraph about me.'));
  assert.ok(!left.includes('Second paragraph'), 'only the first paragraph is shown');
  assert.ok(!html.includes('<b>Photo</b>'));
});

test('hidden photos drop out of the landing page; deleting removes highlights', async () => {
  await api('PATCH', `/photos/${ids[1]}`, { is_hidden: true });
  const shown = plates(await home()).map(([, id]) => id);
  assert.ok(!shown.includes(ids[1]), 'hidden photo is not shown');
  assert.equal((await call(`/img/${ids[1]}/thumb.webp`, { auth: false })).status, 404);
  await api('PATCH', `/photos/${ids[1]}`, { is_hidden: false });

  assert.equal((await api('DELETE', `/photos/${ids[4]}`)).res.status, 200);
  assert.ok(!getHighlightIds().includes(ids[4]));
  await api('DELETE', `/albums/${draft.id}`);
});

test('legacy single hero migrates to the first highlight', async () => {
  await api('PATCH', '/settings', { highlights: [] });
  assert.deepEqual(getHighlightIds(), []);
  setSetting('featured_photo_id', String(ids[0]));
  assert.deepEqual(getHighlightIds(), [ids[0]]);
  await api('PATCH', '/settings', { highlights: [ids[3]] });
  assert.deepEqual(getHighlightIds(), [ids[3]], 'new list replaces the legacy hero');
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'featured_photo_id'").get().value, '');
});

test('album page is a chapter opener with the cover photo on the facing page', async () => {
  const html = await (await call('/a/shown', { auth: false })).text();
  assert.match(html, /class="opener"/);
  assert.match(html, /<h1>Shown<\/h1>/);
  assert.match(html, /class="plate lead"/);
  assert.match(html, /href="\/#contents"/);
  assert.match(html, /Page 1/);
  assert.match(html, /id="grid"/);
  const hasIndexedLead = /class="plate lead"[^>]*><a href="[^"]+" data-index="\d+"/.test(html);
  assert.ok(hasIndexedLead, 'the opening photo opens the viewer');
});

test('book colours: paper, ink and links stay readable with the default palette', () => {
  const ink = deriveBg(DEFAULT_THEME.base);
  const paper = derivePaper(DEFAULT_THEME.text);
  assert.ok(contrastRatio(ink, paper) >= 7, 'ink on paper');
  assert.ok(contrastRatio(deriveLink(DEFAULT_THEME.accent2, DEFAULT_THEME.base), paper) >= 4.5, 'links on paper');
  assert.ok(contrastRatio(ink, DEFAULT_THEME.accent) >= 4.5, 'button text on the accent colour');
  const css = buildThemeCss(null);
  for (const token of ['--desk:', '--paper:', '--ink:', '--rule:', '--link:', '--font-serif:']) assert.ok(css.includes(token), token);
});

test('there is no top navigation bar; About is reachable from the footer and every page links back', async () => {
  for (const url of ['/', '/a/shown', '/about', '/search?q=zzz']) {
    const html = await (await call(url, { auth: false })).text();
    assert.ok(!html.includes('class="site-header"'), `${url} has no header bar`);
    assert.ok(!html.includes('aria-label="Main"'), `${url} has no main nav`);
    assert.match(html, /<footer class="site-footer">[\s\S]*href="\/about"/, `${url} footer links to About`);
  }
  for (const url of ['/about', '/search?q=zzz', '/a/shown']) {
    assert.match(await (await call(url, { auth: false })).text(), /class="crumb" href="\/#contents"/, `${url} links back to the Contents`);
  }
});

test('the landing page loads the opening-sequence script only when there is a book to open', async () => {
  await api('PATCH', '/settings', { highlights: [ids[2], ids[1], ids[0]] });
  const withSpread = await home();
  assert.match(withSpread, /src="\/js\/book\.js\?v=/);
  await api('PATCH', '/settings', { highlights: [] });
  assert.ok(!(await home()).includes('/js/book.js'), 'a lone cover has nothing to wait for');
  await api('PATCH', '/settings', { highlights: [ids[3]] });
});

test('the closed book carries no call-to-action text: the only link is an icon with an accessible name', async () => {
  await api('PATCH', '/settings', { highlights: [ids[2], ids[1], ids[0]] });
  const html = await home();
  const stage = html.slice(html.indexOf('<section class="stage'), html.indexOf('id="contents"'));
  assert.match(stage, /<a class="cue" href="#contents" aria-label="Contents"><svg/);
  assert.ok(!/click|tap|open the book|contents\s*<svg|press/i.test(stage.replace(/aria-label="Contents"/, '')), 'no visible prompt text on the title page');
  await api('PATCH', '/settings', { highlights: [ids[3]] });
});
