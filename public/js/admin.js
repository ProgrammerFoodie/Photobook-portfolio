/* Admin single-page app: dashboard, albums, album editor (uploads, iCloud, photos), settings & palette. */
(() => {
  'use strict';
  const app = document.getElementById('app');

  // ---------- tiny helpers ----------
  const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'draggable', 'readOnly', 'multiple', 'required', 'className', 'htmlFor', 'textContent']);
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'for') el.htmlFor = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const clear = (el) => el.replaceChildren();
  const num = (n) => Number(n || 0).toLocaleString();

  function toast(message, ms = 3500) {
    const host = document.querySelector('.toasts');
    const el = h('div', { class: 'toast' }, h('span', null, message));
    host.append(el);
    setTimeout(() => el.remove(), ms);
  }

  async function api(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Photolib': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(`/admin/api${url}`, opts);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && url !== '/login') { showLogin(); throw new Error('Signed out'); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const attempt = async (fn) => { try { return await fn(); } catch (e) { if (e.message !== 'Signed out') toast(e.message, 5000); } };

  let pollTimer = 0;
  const stopPolling = () => { clearInterval(pollTimer); pollTimer = 0; };
  const thumb = (p) => `/img/${p.id}/thumb.webp?v=${p.version ?? p.v ?? 1}`;

  // ---------- shell & routing ----------
  function shell(active, ...content) {
    const link = (href, label, key) => h('a', { href, 'aria-current': active === key ? 'page' : null }, label);
    return h('div', null,
      h('header', { class: 'a-bar' },
        h('a', { class: 'brand', href: '#/' }, 'Admin'),
        h('nav', null, link('#/', 'Dashboard', 'dash'), link('#/albums', 'Albums', 'albums'), link('#/settings', 'Settings', 'settings'),
          h('a', { href: '/', target: '_blank', rel: 'noopener' }, 'View site ↗')),
        h('button', { class: 'btn sm', type: 'button', onclick: logout }, 'Sign out')),
      h('main', { class: 'a-main' }, ...content));
  }
  function mount(node) { clear(app); app.append(node); window.scrollTo(0, 0); }

  function showLogin(message) {
    stopPolling();
    const err = h('p', { class: 'warn', role: 'alert' }, message || '');
    const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true, class: 'input' });
    const form = h('form', { class: 'login', onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      try { await api('POST', '/login', { password: pw.value }); route(); } catch (ex) { err.textContent = ex.message; pw.select(); }
    } },
      h('h1', null, 'Sign in'),
      h('label', { class: 'field', for: 'pw' }, 'Password', pw),
      err,
      h('p', null, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in')));
    mount(form);
    pw.focus();
  }
  async function logout() { await attempt(() => api('POST', '/logout')); showLogin(); }

  async function route() {
    stopPolling();
    try { await api('GET', '/me'); } catch { return showLogin(); }
    const hash = location.hash.replace(/^#/, '') || '/';
    const m = hash.match(/^\/albums\/(\d+)$/);
    try {
      if (m) await albumPage(Number(m[1]));
      else if (hash === '/albums') await albumsPage();
      else if (hash === '/settings') await settingsPage();
      else await dashboardPage();
    } catch (e) { if (e.message !== 'Signed out') mount(shell('', h('p', { class: 'warn' }, e.message))); }
  }
  window.addEventListener('hashchange', route);

  // ---------- dashboard ----------
  async function dashboardPage() {
    const [stats, jobs] = await Promise.all([api('GET', '/stats'), api('GET', '/jobs')]);
    const t = stats.totals;
    const stat = (label, v) => h('div', { class: 'stat' }, h('b', null, num(v)), h('span', null, label));
    const photoList = (rows, unit) => rows.length
      ? h('ul', { class: 'list' }, rows.map((p) => h('li', null,
        h('img', { src: thumb(p), alt: '', loading: 'lazy' }),
        h('div', { class: 'grow' }, h('a', { href: `#/albums/${p.album_id}` }, p.album_title)),
        h('span', { class: 'num' }, `${num(p.n)} ${unit}`))))
      : h('p', { class: 'note' }, 'Nothing yet.');
    const proc = jobs.photos.processing || 0;
    mount(shell('dash',
      h('h1', null, 'Dashboard'),
      h('p', { class: 'a-sub' }, 'What visitors are doing on your site.'),
      h('div', { class: 'stats' },
        stat('Albums', t.albums), stat('Published', t.published), stat('Photos', t.photos),
        stat('Album views', t.views), stat('Likes', t.likes), stat('Photo downloads', t.downloads), stat('Album downloads', t.zip_downloads)),
      (proc || jobs.queue.pending) ? h('p', { class: 'note' }, `Processing ${proc} photo(s)…`) : null,
      (jobs.photos.error) ? h('p', { class: 'warn' }, `${jobs.photos.error} photo(s) failed to import. Open the album to see details.`) : null,
      h('div', { class: 'cols' },
        h('section', { class: 'panel' }, h('h2', null, 'Most liked'), photoList(stats.topLiked, 'likes')),
        h('section', { class: 'panel' }, h('h2', null, 'Most downloaded'), photoList(stats.topDownloaded, 'downloads')),
        h('section', { class: 'panel' }, h('h2', null, 'Albums by views'),
          stats.albums.length ? h('ul', { class: 'list' }, stats.albums.map((a) => h('li', null,
            h('div', { class: 'grow' }, h('a', { href: `#/albums/${a.id}` }, a.title), h('span', { class: 'note' }, a.is_published ? '' : 'Draft · ')),
            h('span', { class: 'num' }, `${num(a.views)} views · ${num(a.likes)} ♥ · ${num(a.downloads + a.zip_downloads)} ↓`)))) : h('p', { class: 'note' }, 'No albums yet.')))));
  }

  // ---------- albums list ----------
  async function albumsPage() {
    let { albums } = await api('GET', '/albums');
    const list = h('div', { class: 'albums' });

    async function persist() { await attempt(() => api('POST', '/albums/reorder', { ids: albums.map((a) => a.id) })); }
    function move(i, d) {
      const j = i + d;
      if (j < 0 || j >= albums.length) return;
      [albums[i], albums[j]] = [albums[j], albums[i]];
      draw(); persist();
    }
    let dragId = 0;
    function draw() {
      clear(list);
      if (!albums.length) list.append(h('p', { class: 'note' }, 'No albums yet. Create your first one.'));
      albums.forEach((a, i) => {
        const row = h('div', { class: 'arow', draggable: true,
          ondragstart: (e) => { dragId = a.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(a.id)); },
          ondragover: (e) => { if (dragId) { e.preventDefault(); row.classList.add('over'); } },
          ondragleave: () => row.classList.remove('over'),
          ondrop: (e) => {
            e.preventDefault();
            const from = albums.findIndex((x) => x.id === dragId);
            if (from < 0 || from === i) return draw();
            albums.splice(i, 0, albums.splice(from, 1)[0]);
            dragId = 0; draw(); persist();
          },
          ondragend: () => { dragId = 0; draw(); } },
          h('span', { class: 'handle', title: 'Drag to reorder', 'aria-hidden': 'true' }, '⠿'),
          a.cover_photo_id ? h('img', { class: 'cover', src: `/img/${a.cover_photo_id}/thumb.webp`, alt: '', loading: 'lazy' }) : h('div', { class: 'cover' }),
          h('div', { class: 'info' },
            h('a', { href: `#/albums/${a.id}` }, a.title),
            h('div', { class: 'meta' }, [a.category, `${a.photo_count} photo${a.photo_count === 1 ? '' : 's'}`,
              a.pending_count ? `${a.pending_count} pending/failed` : '', a.icloud_url ? (a.sync_error ? '⚠ sync error' : 'iCloud') : ''].filter(Boolean).join(' · '))),
          h('div', { class: 'acts' },
            h('button', { class: 'btn sm', type: 'button', title: 'Move up', 'aria-label': 'Move up', onclick: () => move(i, -1), disabled: i === 0 }, '↑'),
            h('button', { class: 'btn sm', type: 'button', title: 'Move down', 'aria-label': 'Move down', onclick: () => move(i, 1), disabled: i === albums.length - 1 }, '↓'),
            h('label', { class: 'switch', title: 'Show on the public site' },
              h('input', { type: 'checkbox', checked: a.is_published, onchange: async (e) => {
                const ok = await attempt(() => api('PATCH', `/albums/${a.id}`, { is_published: e.target.checked }));
                if (ok) a.is_published = e.target.checked; else e.target.checked = a.is_published;
              } }), 'Published'),
            h('a', { class: 'btn sm', href: `#/albums/${a.id}` }, 'Edit')));
        list.append(row);
      });
    }
    draw();
    mount(shell('albums',
      h('div', { class: 'a-head' },
        h('div', null, h('h1', null, 'Albums'), h('p', { class: 'a-sub' }, 'Drag to reorder how they appear on the home page.')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => attempt(async () => {
          const title = prompt('Album title', 'New album');
          if (!title) return;
          const { album } = await api('POST', '/albums', { title });
          location.hash = `#/albums/${album.id}`;
        }) }, '+ New album')),
      list));
  }

  // ---------- album editor ----------
  function uploadFile(albumId, file, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', `/admin/api/albums/${albumId}/photos`);
      x.setRequestHeader('X-Photolib', '1');
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      x.onload = () => {
        let body = {};
        try { body = JSON.parse(x.responseText); } catch { /* not json */ }
        if (x.status >= 200 && x.status < 300) resolve(body); else reject(new Error(body.error || `HTTP ${x.status}`));
      };
      x.onerror = () => reject(new Error('Network error'));
      const fd = new FormData();
      fd.append('files', file);
      x.send(fd);
    });
  }

  async function albumPage(id) {
    let [{ album, photos }, { albums: allAlbums }, settingsData] = await Promise.all([
      api('GET', `/albums/${id}`), api('GET', '/albums'), api('GET', '/settings')]);
    let highlightIds = settingsData.highlights.map((x) => x.id);
    const maxHighlights = settingsData.maxHighlights;
    const SLOTS = ['Cover', 'Large', 'Small', 'Small', 'Small'];

    // --- details form ---
    const f = {};
    const text = (key, label, type = 'text', extra = {}) => {
      f[key] = h('input', { type, value: album[key] ?? '', class: 'input', ...extra });
      return h('label', { class: 'field' }, label, f[key]);
    };
    const cats = [...new Set(allAlbums.map((a) => a.category).filter(Boolean))];
    f.description = h('textarea', { class: 'input', value: album.description });
    f.category = h('input', { type: 'text', value: album.category, class: 'input', list: 'cats', placeholder: 'Cars, City, Wildlife…' });
    f.photo_sort = h('select', { class: 'input' }, [['manual', 'Manual (drag to arrange)'], ['taken_asc', 'Date taken, oldest first'], ['taken_desc', 'Date taken, newest first']]
      .map(([v, l]) => h('option', { value: v, selected: album.photo_sort === v }, l)));
    f.is_published = h('input', { type: 'checkbox', checked: album.is_published });
    f.allow_download = h('input', { type: 'checkbox', checked: album.allow_download });
    const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save changes');
    const details = h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      saveBtn.disabled = true;
      const res = await attempt(() => api('PATCH', `/albums/${id}`, {
        title: f.title.value, slug: f.slug.value, category: f.category.value, date: f.date.value,
        description: f.description.value, photo_sort: f.photo_sort.value,
        is_published: f.is_published.checked, allow_download: f.allow_download.checked,
      }));
      saveBtn.disabled = false;
      if (res) { album = res.album; f.slug.value = album.slug; viewLink.href = `/a/${album.slug}`; heading.textContent = album.title; toast('Saved'); await reloadPhotos(); }
    } },
      h('h2', null, 'Details'),
      h('div', { class: 'form' },
        text('title', 'Title', 'text', { required: true, maxlength: 120 }),
        text('slug', 'Link name (URL)', 'text', { pattern: '[a-z0-9-]+' }),
        h('label', { class: 'field' }, 'Category', f.category, h('datalist', { id: 'cats' }, cats.map((c) => h('option', { value: c })))),
        text('date', 'Date', 'text', { placeholder: '2026-10-06 (or 2026-10, 2026)' }),
        h('label', { class: 'field wide' }, 'Description', f.description),
        h('label', { class: 'field' }, 'Photo order', f.photo_sort),
        h('div', { class: 'field' }, 'Visibility',
          h('label', { class: 'check' }, f.is_published, 'Published on the public site'),
          h('label', { class: 'check' }, f.allow_download, 'Allow visitors to download'))),
      h('p', null, saveBtn));

    // --- iCloud ---
    const icloudUrl = h('input', { type: 'url', class: 'input', value: album.icloud_url, placeholder: 'https://www.icloud.com/sharedalbum/#B0aG…' });
    const auto = h('input', { type: 'checkbox', checked: album.icloud_auto_sync });
    const syncInfo = h('p', { class: 'note' });
    const syncBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      const ok = await attempt(async () => {
        await api('PATCH', `/albums/${id}`, { icloud_url: icloudUrl.value, icloud_auto_sync: auto.checked });
        await api('POST', `/albums/${id}/sync`);
        return true;
      });
      if (ok) { toast('Sync started'); startPolling(); }
    } }, 'Save & sync now');
    function drawSync() {
      syncInfo.className = album.sync_error ? 'warn' : 'note';
      syncInfo.textContent = album.sync_error ? `⚠ ${album.sync_error}`
        : album.last_synced_at ? `Last synced ${album.last_synced_at} UTC` : (album.icloud_url ? 'Not synced yet.' : '');
    }
    const icloud = h('section', { class: 'panel' },
      h('h2', null, 'iCloud shared album'),
      h('p', { class: 'note' }, 'In Photos, open the shared album → People → turn on “Public Website”, then copy the link. iCloud shares photos up to ~2048 px; upload originals below if you need full resolution.'),
      h('label', { class: 'field' }, 'Link', icloudUrl),
      h('p', null, h('label', { class: 'check' }, auto, 'Check for new photos automatically')),
      h('div', { class: 'row', style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } }, syncBtn, syncInfo));
    drawSync();

    // --- uploads ---
    const uploads = h('div', { class: 'uploads' });
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: () => { addFiles(fileInput.files); fileInput.value = ''; } });
    const drop = h('div', { class: 'drop',
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); } },
      h('strong', null, 'Drop photos here'),
      h('span', null, 'JPEG, PNG, WebP, AVIF or TIFF · up to 100 MB each · location data is removed automatically'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => fileInput.click() }, 'Choose files'), fileInput);
    let uploading = false;
    const pending = [];
    async function addFiles(fileList) {
      for (const file of fileList) {
        if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|avif|tiff?)$/i.test(file.name)) { toast(`Skipped ${file.name}: not an image`); continue; }
        const bar = h('i'), status = h('span', { class: 'note' }, 'Waiting');
        uploads.append(h('div', { class: 'up' }, h('span', { class: 'name' }, file.name), h('div', { class: 'bar' }, bar), status));
        pending.push({ file, bar, status });
      }
      if (uploading) return;
      uploading = true;
      while (pending.length) {
        const { file, bar, status } = pending.shift();
        status.textContent = 'Uploading…';
        try {
          await uploadFile(id, file, (r) => { bar.style.width = `${Math.round(r * 100)}%`; });
          bar.style.width = '100%'; status.textContent = 'Queued ✓';
        } catch (e) { status.textContent = `Failed: ${e.message}`; status.className = 'warn'; }
        await reloadPhotos();
      }
      uploading = false;
      startPolling();
    }

    // --- photo grid (with tagging) ---
    const grid = h('div', { class: 'pgrid' });
    const photoCount = h('h2', null, 'Photos');
    const selected = new Set();
    let lastPicked = null;
    let tagFilter = ''; // '' = all, '\u0000untagged' = no tags, otherwise a tag name
    const UNTAGGED = '\u0000untagged';
    const tagNames = h('datalist', { id: 'tag-names' });
    const loadTagNames = async () => {
      const data = await api('GET', '/tags').catch(() => ({ tags: [] }));
      clear(tagNames);
      data.tags.forEach((t) => tagNames.append(h('option', { value: t.name })));
    };
    loadTagNames();
    const shown = () => photos.filter((p) => !tagFilter || (tagFilter === UNTAGGED ? !p.tags.length : p.tags.includes(tagFilter)));
    const cards = new Map(); // photo id → { card, chips }

    let dragId = 0;
    async function reorderTo(photoId, targetIndex) {
      const from = photos.findIndex((p) => p.id === photoId);
      if (from < 0 || from === targetIndex) return;
      photos.splice(targetIndex, 0, photos.splice(from, 1)[0]);
      album.photo_sort = 'manual'; f.photo_sort.value = 'manual';
      drawPhotos();
      await attempt(() => api('POST', `/albums/${id}/photos/reorder`, { ids: photos.map((p) => p.id) }));
    }

    async function applyTags(ids, { add = '', remove = '' }) {
      const res = await attempt(() => api('POST', `/albums/${id}/tags`, { photo_ids: ids, add, remove }));
      if (!res) return false;
      for (const [pid, names] of Object.entries(res.photos)) {
        const p = photos.find((x) => x.id === Number(pid));
        if (p) p.tags = names;
      }
      if (res.skipped) toast(`${res.skipped} photo(s) already have ${res.limit} tags, so some were not added`, 5000);
      loadTagNames();
      if (tagFilter) drawPhotos(); else photos.forEach((p) => cards.has(p.id) && drawChips(p));
      drawToolbar();
      return true;
    }
    function drawChips(p) {
      const { chips } = cards.get(p.id);
      clear(chips);
      p.tags.forEach((name) => chips.append(h('span', { class: 'ptag' }, name,
        h('button', { type: 'button', title: `Remove “${name}”`, 'aria-label': `Remove tag ${name}`, onclick: () => applyTags([p.id], { remove: [name] }) }, '×'))));
    }

    // toolbar: filter, selection, bulk tag add/remove (nodes are created once so typed text survives selection changes)
    const toolbar = h('div', { class: 'tagbar' });
    const filter = h('select', { class: 'input', 'aria-label': 'Filter photos by tag', onchange: () => { tagFilter = filter.value; selected.clear(); lastPicked = null; drawPhotos(); drawToolbar(); } });
    const selNote = h('span', { class: 'note' });
    const clearBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => { selected.clear(); lastPicked = null; syncSelection(); drawToolbar(); } }, 'Clear selection');
    const addIn = h('input', { class: 'input', type: 'text', list: 'tag-names', placeholder: 'Tags to add: BMW M3, #42', 'aria-label': 'Tags to add', maxlength: 200 });
    const rmIn = h('input', { class: 'input', type: 'text', list: 'tag-names', placeholder: 'Tag to remove', 'aria-label': 'Tags to remove', maxlength: 200 });
    const doAdd = async () => {
      if (!addIn.value.trim()) return;
      if (await applyTags([...selected], { add: addIn.value })) { addIn.value = ''; selected.clear(); lastPicked = null; syncSelection(); drawToolbar(); }
    };
    const doRemove = async () => { if (rmIn.value.trim() && await applyTags([...selected], { remove: rmIn.value })) rmIn.value = ''; };
    addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
    rmIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doRemove(); } });
    const bulkRow = h('div', { class: 'tagrow', hidden: true },
      h('div', { class: 'tagin' }, addIn, h('button', { class: 'btn btn-primary sm', type: 'button', onclick: doAdd }, 'Add tags')),
      h('div', { class: 'tagin' }, rmIn, h('button', { class: 'btn sm', type: 'button', onclick: doRemove }, 'Remove')));
    toolbar.append(
      h('div', { class: 'tagrow' }, filter,
        h('button', { class: 'btn sm', type: 'button', onclick: () => { shown().forEach((p) => selected.add(p.id)); syncSelection(); drawToolbar(); } }, 'Select all shown'),
        clearBtn, selNote),
      bulkRow, tagNames);
    function drawToolbar() {
      const counts = new Map();
      photos.forEach((p) => p.tags.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
      const untagged = photos.filter((p) => !p.tags.length).length;
      clear(filter);
      filter.append(
        h('option', { value: '' }, `All photos (${photos.length})`),
        h('option', { value: UNTAGGED }, `Untagged (${untagged})`),
        ...[...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([name, n]) => h('option', { value: name }, `${name} (${n})`)));
      filter.value = tagFilter;
      if (filter.value !== tagFilter) { tagFilter = ''; filter.value = ''; }
      selNote.textContent = selected.size ? `${selected.size} selected` : 'Tick photos (shift-click for a range) to tag many at once';
      clearBtn.hidden = !selected.size;
      bulkRow.hidden = !selected.size;
    }
    function syncSelection() {
      for (const [pid, { card, pick }] of cards) { const on = selected.has(pid); card.classList.toggle('sel', on); pick.checked = on; }
    }

    function drawPhotos() {
      clear(grid);
      cards.clear();
      const list = shown();
      const ready = photos.filter((p) => p.status === 'ready').length;
      photoCount.textContent = `Photos (${ready}${photos.length !== ready ? ` of ${photos.length}` : ''})${list.length !== photos.length ? ` · showing ${list.length}` : ''}`;
      if (!photos.length) grid.append(h('p', { class: 'note' }, 'No photos yet. Upload some above or connect an iCloud album.'));
      else if (!list.length) grid.append(h('p', { class: 'note' }, tagFilter === UNTAGGED ? 'Every photo has a tag. 🎉' : 'No photos with that tag.'));
      list.forEach((p, vi) => {
        const realIndex = photos.indexOf(p);
        const cap = h('input', { class: 'cap', type: 'text', value: p.caption, placeholder: 'Caption', maxlength: 500,
          onchange: async () => { if (await attempt(() => api('PATCH', `/photos/${p.id}`, { caption: cap.value }))) p.caption = cap.value; } });
        const pick = h('input', { type: 'checkbox', class: 'pick', 'aria-label': `Select photo ${realIndex + 1}`, checked: selected.has(p.id),
          onclick: (e) => {
            if (e.shiftKey && lastPicked != null) {
              const a = list.findIndex((x) => x.id === lastPicked), bIdx = vi;
              for (let k = Math.min(a, bIdx); k <= Math.max(a, bIdx); k++) selected.add(list[k].id);
            } else if (pick.checked) selected.add(p.id); else selected.delete(p.id);
            lastPicked = p.id;
            syncSelection(); drawToolbar();
          } });
        const chips = h('div', { class: 'ptags' });
        const card = h('div', { class: `pcard${p.is_hidden ? ' hidden' : ''}${selected.has(p.id) ? ' sel' : ''}`,
          ondragover: (e) => { if (dragId) { e.preventDefault(); card.classList.add('over'); } },
          ondragleave: () => card.classList.remove('over'),
          ondrop: (e) => { e.preventDefault(); const d = dragId; dragId = 0; if (d) reorderTo(d, realIndex); } },
          h('div', { class: 'th', draggable: true, ondragstart: (e) => { dragId = p.id; e.dataTransfer.setData('text/plain', String(p.id)); }, ondragend: () => { dragId = 0; drawPhotos(); } },
            p.status === 'ready' ? h('img', { src: thumb(p), alt: p.caption || p.original_name, loading: 'lazy' }) : null,
            album.cover_photo_id === p.id ? h('span', { class: 'badge cover' }, 'COVER') : null,
            p.status === 'processing' ? h('span', { class: 'badge' }, 'Processing…') : null,
            p.status === 'error' ? h('span', { class: 'badge err', title: p.error }, 'Failed') : null,
            highlightIds.includes(p.id) ? h('span', { class: 'badge hero', title: 'Shown on the title page' }, `★ ${SLOTS[highlightIds.indexOf(p.id)]}`) : null,
            p.status === 'ready' ? pick : null),
          p.status === 'error' ? h('div', { class: 'sub warn' }, p.error) : h('div', { class: 'sub' }, p.status === 'ready' ? `${p.width}×${p.height} · ♥ ${p.likes} · ↓ ${p.downloads}` : p.original_name),
          chips,
          cap,
          h('div', { class: 'tools' },
            h('button', { type: 'button', title: 'Move earlier', onclick: () => reorderTo(p.id, photos.indexOf(list[vi - 1])), disabled: vi === 0 }, '◀'),
            h('button', { type: 'button', title: 'Move later', onclick: () => reorderTo(p.id, photos.indexOf(list[vi + 1])), disabled: vi === list.length - 1 }, '▶'),
            p.status === 'ready' ? h('button', { type: 'button', title: 'Use as album cover', onclick: async () => { if (await attempt(() => api('POST', `/albums/${id}/cover`, { photo_id: p.id }))) { album.cover_photo_id = p.id; drawPhotos(); } } }, 'Cover') : null,
            p.status === 'ready' ? h('button', { type: 'button', title: 'Show this photo on the title page', onclick: async () => {
              const on = highlightIds.includes(p.id);
              if (!on && highlightIds.length >= maxHighlights) return toast(`The title page has room for ${maxHighlights} highlights. Remove one in Settings → Title page first.`, 5000);
              const next = on ? highlightIds.filter((x) => x !== p.id) : [...highlightIds, p.id];
              if (await attempt(() => api('PATCH', '/settings', { highlights: next }))) { highlightIds = next; drawPhotos(); toast(on ? 'Removed from the title page' : `Added to the title page (${SLOTS[next.length - 1].toLowerCase()} photo)`); }
            } }, highlightIds.includes(p.id) ? '★ Highlight' : '☆ Highlight') : null,
            h('button', { type: 'button', title: p.is_hidden ? 'Show to visitors' : 'Hide from visitors', onclick: async () => {
              if (await attempt(() => api('PATCH', `/photos/${p.id}`, { is_hidden: !p.is_hidden }))) { p.is_hidden = !p.is_hidden; drawPhotos(); }
            } }, p.is_hidden ? 'Show' : 'Hide'),
            p.source !== 'icloud' && allAlbums.length > 1 ? h('button', { type: 'button', title: 'Move to another album', onclick: async () => {
              const others = allAlbums.filter((a) => a.id !== id);
              const choice = prompt(`Move to which album? Type the number:\n${others.map((a, n) => `${n + 1}. ${a.title}`).join('\n')}`);
              const target = others[Number(choice) - 1];
              if (!target) return;
              if (await attempt(() => api('PATCH', `/photos/${p.id}`, { album_id: target.id }))) { toast(`Moved to ${target.title}`); await reloadPhotos(); }
            } }, 'Move') : null,
            h('button', { class: 'del', type: 'button', title: p.source === 'icloud' ? 'iCloud photos can only be hidden' : 'Delete photo', disabled: p.source === 'icloud', onclick: async () => {
              if (!confirm('Delete this photo permanently? This cannot be undone.')) return;
              if (await attempt(() => api('DELETE', `/photos/${p.id}`))) { await reloadPhotos(); }
            } }, 'Delete')));
        cards.set(p.id, { card, chips, pick });
        drawChips(p);
        grid.append(card);
      });
    }
    async function reloadPhotos() {
      const data = await api('GET', `/albums/${id}`);
      album = data.album; photos = data.photos;
      for (const sid of [...selected]) if (!photos.some((p) => p.id === sid)) selected.delete(sid);
      drawPhotos(); drawToolbar(); drawSync();
      return data;
    }
    function startPolling() {
      stopPolling();
      pollTimer = setInterval(async () => {
        try {
          const jobs = await api('GET', '/jobs');
          await reloadPhotos();
          const busy = photos.some((p) => p.status === 'processing') || jobs.syncing.includes(id) || jobs.queue.pending || jobs.queue.current;
          if (!busy) stopPolling();
        } catch { stopPolling(); }
      }, 2000);
    }
    drawPhotos();
    drawToolbar();
    if (photos.some((p) => p.status === 'processing')) startPolling();

    const heading = h('h1', null, album.title);
    const viewLink = h('a', { class: 'btn sm', href: `/a/${album.slug}`, target: '_blank', rel: 'noopener' }, 'View ↗');
    mount(shell('albums',
      h('div', { class: 'a-head' },
        h('div', null, h('p', { class: 'note' }, h('a', { href: '#/albums' }, '← Albums')), heading),
        h('div', { class: 'row' }, viewLink,
          h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
            if (!confirm(`Delete “${album.title}” and all ${photos.length} photo(s) in it? This cannot be undone.`)) return;
            if (await attempt(() => api('DELETE', `/albums/${id}`))) { location.hash = '#/albums'; }
          } }, 'Delete album'))),
      details, icloud,
      h('section', { class: 'panel' }, h('h2', null, 'Upload'), drop, uploads),
      h('section', { class: 'panel flat' }, photoCount, h('p', { class: 'note' }, 'Drag photos to reorder. “Hide” keeps a photo in the album but off the public site. Tags help visitors find their car: tag by model, number or plate.'), toolbar, grid)));
  }

  // ---------- settings & palette ----------
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * c(n >> 16) + 0.7152 * c((n >> 8) & 255) + 0.0722 * c(n & 255);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (base) => { const n = parseInt(base.slice(1), 16); const f = (v) => Math.round(v * 0.55).toString(16).padStart(2, '0'); return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`; };
  const mixHex = (a, b, wa) => {
    const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    const c = (sh) => Math.round(((x >> sh) & 255) * wa + ((y >> sh) & 255) * (1 - wa)).toString(16).padStart(2, '0');
    return `#${c(16)}${c(8)}${c(0)}`;
  };
  const grade = (r) => (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'large text only' : 'too low');
  const PALETTE_ORDER = ['surface', 'base', 'accent', 'accent2', 'muted'];

  function parsePalette(text) {
    const norm = (s) => { s = s.replace('#', ''); if (/^[0-9a-f]{3}$/i.test(s)) s = [...s].map((c) => c + c).join(''); return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toUpperCase()}` : null; };
    const hashed = [...text.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/gi)].map((m) => norm(m[0]));
    if (hashed.length) return hashed.filter(Boolean);
    return text.split(/[\s,;\-/]+/).filter((t) => /^[0-9a-f]{6}$/i.test(t)).map(norm);
  }

  async function settingsPage() {
    const data = await api('GET', '/settings');
    const s = data.settings;
    let theme = { ...data.theme };
    const fields = {};
    const text = (key, label, type = 'text', extra = {}) => {
      fields[key] = h('input', { type, class: 'input', value: s[key] ?? '', ...extra });
      return h('label', { class: 'field' }, label, fields[key]);
    };
    fields.about = h('textarea', { class: 'input', id: 'about-text', rows: 10, maxlength: 5000, value: s.about, placeholder: 'A few lines about you and your photography. Blank line = new paragraph.' });

    // --- About text: formatting buttons, the title-page cut-off, and a preview of the About page ---
    const aboutCount = h('p', { class: 'note about-count', 'aria-live': 'polite' });
    const aboutIntro = h('p', { class: 'about-intro' });
    const aboutPage = h('div', { class: 'about-page' });
    let aboutTimer = 0;
    let aboutSeq = 0;
    async function refreshAbout() {
      const n = ++aboutSeq;
      let r;
      try { r = await api('POST', '/about/preview', { text: fields.about.value }); } catch { return; }
      if (n !== aboutSeq) return;
      const { shown, rest, total, max, truncated } = r.intro;
      aboutCount.classList.toggle('warn', truncated);
      aboutCount.textContent = truncated
        ? `Title-page intro: ${total} characters, but only the first ${max} fit. The grey, struck-through part below is cut off (the About page still shows everything).`
        : `Title-page intro: ${total} of ${max} characters, all of it fits.`;
      clear(aboutIntro);
      aboutIntro.append(shown || 'Nothing yet.');
      if (truncated) aboutIntro.append('…', h('span', { class: 'cut' }, rest));
      aboutPage.innerHTML = r.html; // already escaped by the server; only <p>, <ul>, <ol>, <h2>, <h3>, <strong>, <em>, <a>, <br>
    }
    const queueAbout = () => { clearTimeout(aboutTimer); aboutTimer = setTimeout(refreshAbout, 250); };
    const changeAbout = () => { fields.about.focus(); fields.about.dispatchEvent(new Event('input')); };
    const wrapAbout = (before, after, sample) => {
      const t = fields.about;
      const a = t.selectionStart; const b = t.selectionEnd;
      const inner = t.value.slice(a, b) || sample;
      t.setRangeText(before + inner + after, a, b, 'preserve');
      t.setSelectionRange(a + before.length, a + before.length + inner.length);
      changeAbout();
    };
    const prefixAbout = (make) => {
      const t = fields.about;
      const from = t.value.lastIndexOf('\n', t.selectionStart - 1) + 1;
      let to = t.value.indexOf('\n', t.selectionEnd);
      if (to < 0) to = t.value.length;
      const lines = t.value.slice(from, to).split('\n');
      const allMarked = lines.every((line, i) => make(i).re.test(line));
      const out = lines.map((line, i) => (allMarked ? line.replace(make(i).re, '') : `${make(i).add}${line.replace(make(i).re, '')}`));
      t.setRangeText(out.join('\n'), from, to, 'select');
      changeAbout();
    };
    const tool = (label, title, onclick) => h('button', { type: 'button', class: 'btn sm', title, 'aria-label': title, onclick }, label);
    const aboutTools = h('div', { class: 'about-tools', role: 'toolbar', 'aria-label': 'Formatting' },
      tool(h('b', null, 'B'), 'Bold', () => wrapAbout('**', '**', 'bold text')),
      tool(h('i', null, 'I'), 'Italic', () => wrapAbout('*', '*', 'italic text')),
      tool('Heading', 'Heading', () => prefixAbout(() => ({ re: /^#{1,3}\s+/, add: '## ' }))),
      tool('• List', 'Bulleted list', () => prefixAbout(() => ({ re: /^\s*[-*•]\s+/, add: '- ' }))),
      tool('1. List', 'Numbered list', () => prefixAbout((i) => ({ re: /^\s*\d+[.)]\s+/, add: `${i + 1}. ` }))),
      tool('Link', 'Link', () => {
        const t = fields.about;
        const label = t.value.slice(t.selectionStart, t.selectionEnd) || 'link text';
        const url = prompt('Link address (starting with https://)', 'https://');
        if (!url || !/^https?:\/\/\S+$/.test(url)) return;
        t.setRangeText(`[${label}](${url})`, t.selectionStart, t.selectionEnd, 'end');
        changeAbout();
      }));
    fields.about.addEventListener('input', queueAbout);
    const aboutEditor = h('div', { class: 'field wide about-editor' },
      h('label', { for: 'about-text' }, 'About text (its first paragraph is also the intro on the title page)'),
      aboutTools, fields.about,
      h('p', { class: 'note' }, 'Formatting: **bold**, *italic*, ## heading, - bullet, 1. numbered, [text](https://link). A blank line starts a new paragraph.'),
      aboutCount,
      h('div', { class: 'about-previews' },
        h('div', null, h('h3', null, 'Title page shows'), aboutIntro),
        h('div', null, h('h3', null, 'About page shows'), aboutPage)));
    refreshAbout();
    fields.default_allow_download = h('input', { type: 'checkbox', checked: s.default_allow_download === '1' });
    fields.strip_gps = h('input', { type: 'checkbox', checked: s.strip_gps === '1' });

    const saveSite = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save settings');
    const siteForm = h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      saveSite.disabled = true;
      const ok = await attempt(() => api('PATCH', '/settings', {
        site_title: fields.site_title.value, tagline: fields.tagline.value, about: fields.about.value,
        cover_subtitle: fields.cover_subtitle.value, intro_title: fields.intro_title.value,
        contact_email: fields.contact_email.value, instagram: fields.instagram.value, facebook: fields.facebook.value,
        tiktok: fields.tiktok.value, youtube: fields.youtube.value, x: fields.x.value, telegram: fields.telegram.value,
        icloud_sync_hours: fields.icloud_sync_hours.value,
        default_allow_download: fields.default_allow_download.checked, strip_gps: fields.strip_gps.checked,
      }));
      saveSite.disabled = false;
      if (ok) toast('Settings saved');
    } },
      h('h2', null, 'Site'),
      h('div', { class: 'form' },
        text('site_title', 'Site title', 'text', { maxlength: 60, required: true }),
        text('tagline', 'Tagline (small line on the cover)', 'text', { maxlength: 200 }),
        text('cover_subtitle', 'Cover subtitle', 'text', { maxlength: 60, placeholder: 'Portfolio' }),
        text('intro_title', 'Heading of the intro on the title page', 'text', { maxlength: 60 }),
        aboutEditor,
        text('contact_email', 'Contact email', 'email'),
        text('instagram', 'Instagram (handle or link)', 'text', { placeholder: '@yourname' }),
        text('facebook', 'Facebook (page name or link)', 'text'),
        text('tiktok', 'TikTok (handle or link)', 'text'),
        text('youtube', 'YouTube (handle or link)', 'text'),
        text('x', 'X (handle or link)', 'text'),
        text('telegram', 'Telegram (username or link)', 'text'),
        h('p', { class: 'note wide' }, 'Filled-in links appear as small icons on the book cover, on the open book and on the About page. Leave a field empty to hide that icon. The email above shows as a mail icon.')),
      h('h2', { style: { marginTop: '22px' } }, 'Behaviour'),
      h('div', { class: 'form' },
        h('div', { class: 'field' },
          h('label', { class: 'check' }, fields.default_allow_download, 'New albums allow downloads'),
          h('label', { class: 'check' }, fields.strip_gps, 'Remove GPS location from photos on import (recommended)')),
        text('icloud_sync_hours', 'Check iCloud albums every (hours, 0 = never)', 'number', { min: 0, max: 168 })),
      h('p', null, saveSite));

    // --- highlights (title page) ---
    let highlights = [...data.highlights];
    const SLOT_LABELS = ['Cover photo', 'Large photo (right page)', 'Small photo 1', 'Small photo 2', 'Small photo 3'];
    const hlList = h('div', { class: 'hl' });
    async function saveHighlights(next) {
      const r = await attempt(() => api('PATCH', '/settings', { highlights: next.map((x) => x.id) }));
      if (r) { highlights = r.highlights; drawHighlights(); }
    }
    function drawHighlights() {
      clear(hlList);
      for (let i = 0; i < data.maxHighlights; i++) {
        const x = highlights[i];
        hlList.append(h('div', { class: `hlrow${x ? '' : ' empty'}` },
          x ? h('img', { src: thumb({ id: x.id, version: x.version }), alt: '' }) : h('div', { class: 'ph' }, '+'),
          h('div', { class: 'grow' }, h('strong', null, SLOT_LABELS[i]),
            x ? h('span', { class: 'note' }, ' · ', h('a', { href: `#/albums/${x.album_id}` }, x.album_title)) : h('span', { class: 'note' }, ' · empty. Press “☆ Highlight” on a photo in an album.')),
          x ? [
            h('button', { class: 'btn sm', type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { const n = [...highlights]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; saveHighlights(n); } }, '↑'),
            h('button', { class: 'btn sm', type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: i === highlights.length - 1, onclick: () => { const n = [...highlights]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; saveHighlights(n); } }, '↓'),
            h('button', { class: 'btn sm danger', type: 'button', onclick: () => saveHighlights(highlights.filter((_, j) => j !== i)) }, 'Remove')] : null));
      }
    }
    drawHighlights();
    const highlightsPanel = h('section', { class: 'panel' }, h('h2', null, 'Title page'),
      h('p', { class: 'note' }, 'Your highlight photos appear on the title page, like the cover and first spread of a photo book. The cover works best with a portrait photo. Highlights are chosen with the “☆ Highlight” button on each photo inside an album.'),
      hlList);

    // --- palette ---
    const preview = h('div', { class: 'preview theme-scope' },
      h('div', { class: 'ph' }, h('span', null, 'Photolib'), h('span', null, 'Albums · About')),
      h('div', { class: 'pg' },
        h('span', { class: 'pbar' }),
        h('h3', null, 'Track Day 2026'), h('p', { class: 'pm' }, '24 photos · Sep 2026'),
        h('p', null, 'Paper page with ink text and a ', h('a', { href: '#', onclick: (e) => e.preventDefault() }, 'link'), '.'),
        h('div', { class: 'row' }, h('span', { class: 'pbtn' }, '▶ Slideshow'), h('span', { class: 'pchip' }, 'Cars'), h('span', { class: 'pchip on' }, 'BMW M3'))));
    const contrast = h('div', { class: 'contrast' });
    const inputs = {};
    function paintPreview() {
      for (const [k, v] of Object.entries(theme)) preview.style.setProperty(`--${k}`, v);
      const ink = bgOf(theme.base);
      const paper = mixHex(theme.text, '#FFFFFF', 0.86);
      const desk = mixHex(theme.surface, theme.base, 0.78);
      const link = mixHex(theme.accent2, ink, 0.7);
      const badge = (label, a, b) => { const r = ratio(a, b); return h('span', { class: `pill${r >= 4.5 ? ' on' : ''}` }, `${label} ${r.toFixed(1)}:1 · ${grade(r)}`); };
      clear(contrast);
      contrast.append(badge('Ink on paper', ink, paper), badge('Links on paper', link, paper), badge('Button text', ink, theme.accent), badge('Paper on desk', paper, desk), badge('Light text in viewer', theme.text, ink));
      for (const [k, el] of Object.entries(inputs)) { el.color.value = theme[k].toLowerCase(); el.hex.value = theme[k]; }
    }
    const row = (key) => {
      const color = h('input', { type: 'color', 'aria-label': data.roleLabels[key], oninput: () => { theme[key] = color.value.toUpperCase(); paintPreview(); } });
      const hex = h('input', { type: 'text', class: 'input', maxlength: 7, spellcheck: false, 'aria-label': `${data.roleLabels[key]} hex`,
        oninput: () => { const m = hex.value.trim().match(/^#?([0-9a-f]{6})$/i); if (m) { theme[key] = `#${m[1].toUpperCase()}`; paintPreview(); } } });
      inputs[key] = { color, hex };
      return h('div', { class: 'prow' }, color, h('label', null, data.roleLabels[key]), hex);
    };
    const paste = h('textarea', { class: 'input', placeholder: 'Paste colours or a coolors.co link, e.g. coolors.co/63361e-402313-e37c44-ba6538-914f2c', style: { minHeight: '64px' } });
    const savePalette = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      const ok = await attempt(() => api('PATCH', '/settings', { theme }));
      if (ok) { toast('Palette saved. Reload the site to see it.'); }
    } }, 'Save palette');
    const palette = h('section', { class: 'panel' },
      h('h2', null, 'Colour palette'),
      h('p', { class: 'note' }, 'Every colour on the site comes from these six. Contrast badges tell you if text stays readable.'),
      h('div', { class: 'palette' },
        h('div', null,
          ['surface', 'base', 'accent', 'accent2', 'muted', 'text'].map(row),
          h('label', { class: 'field', style: { marginTop: '12px' } }, `Paste a palette (assigned in order: ${PALETTE_ORDER.join(', ')})`, paste),
          h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } },
            h('button', { class: 'btn sm', type: 'button', onclick: () => {
              const colors = parsePalette(paste.value);
              if (!colors.length) return toast('No colours found in that text');
              PALETTE_ORDER.forEach((k, i) => { if (colors[i]) theme[k] = colors[i]; });
              paintPreview(); toast(`Applied ${Math.min(colors.length, 5)} colour(s). Remember to save.`);
            } }, 'Apply pasted colours'),
            h('button', { class: 'btn sm', type: 'button', onclick: () => { theme = { ...data.defaultTheme }; paintPreview(); } }, 'Reset to defaults'),
            savePalette)),
        h('div', null, preview, contrast)));
    paintPreview();

    // --- tags manager ---
    const tagsList = h('div');
    const nPhotos = (n) => `${n} photo${n === 1 ? '' : 's'}`;
    async function drawTags(data) {
      const { tags } = data || await api('GET', '/tags');
      clear(tagsList);
      if (!tags.length) tagsList.append(h('p', { class: 'note' }, 'No tags yet. Open an album, tick some photos and add tags like “BMW M3” or “#42”.'));
      tags.forEach((t) => tagsList.append(h('div', { class: 'trow' },
        h('div', { class: 'grow' }, h('strong', null, t.name), h('span', { class: 'note' }, ` · ${nPhotos(t.photos)} in ${t.albums} album${t.albums === 1 ? '' : 's'}`)),
        h('button', { class: 'btn sm', type: 'button', onclick: async () => {
          const name = prompt('Rename tag (type an existing tag’s name to merge them):', t.name);
          if (!name || name === t.name) return;
          const r = await attempt(() => api('PATCH', `/tags/${t.id}`, { name }));
          if (r) { toast(r.merged ? 'Merged into the existing tag' : 'Renamed'); drawTags(r); }
        } }, 'Rename / merge'),
        h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
          if (!confirm(`Remove the tag “${t.name}” from ${nPhotos(t.photos)}?`)) return;
          const r = await attempt(() => api('DELETE', `/tags/${t.id}`));
          if (r) drawTags(r);
        } }, 'Delete'))));
    }
    const tagsPanel = h('section', { class: 'panel' }, h('h2', null, 'Tags'),
      h('p', { class: 'note' }, 'Visitors search and filter by these to find their car. Renaming a tag to the name of another tag merges the two.'), tagsList);
    await drawTags();

    mount(shell('settings',
      h('h1', null, 'Settings'),
      h('p', { class: 'a-sub' }, data.passwordSet ? 'To change the admin password, run “npm run set-password” on the server.' : 'No admin password is set.'),
      highlightsPanel, palette, tagsPanel, siteForm));
  }

  route();
})();
