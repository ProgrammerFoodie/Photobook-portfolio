/* Photo viewer: lightbox with pinch/wheel zoom up to the original file, and a fullscreen slideshow. */
(() => {
  'use strict';
  const PL = window.PL;
  const D = PL && PL.data;
  if (!D || !D.photos.length) return;

  const photos = D.photos;
  const slug = D.album.slug;
  const albumPath = `/a/${slug}`;
  const qs = location.search; // keep an active tag/search filter in photo links
  const thumb = (p) => `/img/${p.id}/thumb.webp?v=${p.v}`;
  const display = (p) => `/img/${p.id}/display.webp?v=${p.v}`;
  const original = (p) => `/img/${p.id}/original?v=${p.v}`;
  const displayWidth = (p) => Math.round(p.w * Math.min(1, 2048 / Math.max(p.w, p.h)));
  const dpr = () => window.devicePixelRatio || 1;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const store = {
    get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  const S = {
    open: false, index: 0, cur: 0, token: 0, photoId: 0, pushed: false, lastFocus: null,
    info: false, idleTimer: 0, overUi: false, tapTimer: 0, lastTap: { t: 0, x: 0, y: 0 },
    show: { on: false, paused: false, secs: Number(store.get('pl-secs', 5)) || 5, timer: 0 },
    wake: null,
  };
  const z = { s: 1, tx: 0, ty: 0, fw: 0, fh: 0 };
  let root, stage, imgs, spinner, infoEl, tagsEl, progress, countEl, likeBtn, likeCount, btnShow, btnZoom;

  // ---------- DOM ----------
  const ic = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  function build() {
    root = document.createElement('div');
    root.className = 'lb idle';
    root.hidden = true;
    root.tabIndex = -1;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', `${D.album.title} photo viewer`);
    root.innerHTML = `
      <div class="lb-stage"><img class="lb-img" alt=""><img class="lb-img" alt=""></div>
      <div class="lb-bar">
        <span class="lb-count" aria-live="polite"></span>
        <div class="lb-actions">
          <select class="lb-interval" aria-label="Slideshow speed">
            ${[3, 5, 8, 12].map((s) => `<option value="${s}">${s}s</option>`).join('')}
          </select>
          <button class="lb-btn" data-act="info" aria-pressed="false" aria-label="Photo info" title="Info (I)">${ic('info')}</button>
          <button class="lb-btn" data-act="like" aria-pressed="false" aria-label="Like" title="Like (L)">${ic('heart', 'heart')}<span class="lb-likes"></span></button>
          <button class="lb-btn" data-act="download" aria-label="Download photo" title="Download">${ic('download')}</button>
          <button class="lb-btn" data-act="share" aria-label="Share photo" title="Share">${ic('share')}</button>
          <button class="lb-btn" data-act="zoom" aria-label="View at original size" title="Original size (Z)">${ic('zoom')}</button>
          <button class="lb-btn" data-act="slideshow" aria-label="Start slideshow" title="Slideshow (Space)">${ic('play')}</button>
          <button class="lb-btn" data-act="fullscreen" aria-label="Fullscreen" title="Fullscreen (F)">${ic('expand')}</button>
          <button class="lb-btn" data-act="close" aria-label="Close" title="Close (Esc)">${ic('close')}</button>
        </div>
      </div>
      <button class="lb-nav prev" data-act="prev" aria-label="Previous photo">${ic('prev')}</button>
      <button class="lb-nav next" data-act="next" aria-label="Next photo">${ic('next')}</button>
      <div class="lb-tags"></div>
      <div class="lb-spinner" hidden></div>
      <aside class="lb-info" hidden></aside>
      <div class="lb-progress" aria-hidden="true"><i></i></div>`;
    document.body.append(root);
    stage = root.querySelector('.lb-stage');
    imgs = [...root.querySelectorAll('.lb-img')];
    spinner = root.querySelector('.lb-spinner');
    infoEl = root.querySelector('.lb-info');
    tagsEl = root.querySelector('.lb-tags');
    progress = root.querySelector('.lb-progress i');
    countEl = root.querySelector('.lb-count');
    likeBtn = root.querySelector('[data-act=like]');
    likeCount = root.querySelector('.lb-likes');
    btnShow = root.querySelector('[data-act=slideshow]');
    btnZoom = root.querySelector('[data-act=zoom]');
    if (photos.length < 2) root.classList.add('single');
    if (!D.album.allowDownload) root.querySelector('[data-act=download]').hidden = true;
    if (!navigator.share) root.querySelector('[data-act=share]').title = 'Copy link';
    if (!root.requestFullscreen && !root.webkitRequestFullscreen) root.querySelector('[data-act=fullscreen]').hidden = true;
    const sel = root.querySelector('.lb-interval');
    sel.value = String(S.show.secs);
    sel.addEventListener('change', () => { S.show.secs = Number(sel.value); store.set('pl-secs', sel.value); if (S.show.on) scheduleNext(); });
    wire();
  }

  // ---------- layout & zoom ----------
  const stageSize = () => ({ w: stage.clientWidth, h: stage.clientHeight });
  function layout(img, p) {
    const { w, h } = stageSize();
    const f = Math.min(w / p.w, h / p.h);
    z.fw = p.w * f; z.fh = p.h * f;
    img.style.width = `${z.fw}px`;
    img.style.height = `${z.fh}px`;
    z.s = 1; z.tx = (w - z.fw) / 2; z.ty = (h - z.fh) / 2;
    apply(img);
  }
  function apply(img = imgs[S.cur]) {
    img.style.transform = `translate3d(${z.tx}px,${z.ty}px,0) scale(${z.s})`;
    root.classList.toggle('zoomed', z.s > 1.001);
  }
  function constrain() {
    const { w, h } = stageSize();
    const cw = z.fw * z.s, ch = z.fh * z.s;
    z.tx = cw <= w ? (w - cw) / 2 : clamp(z.tx, w - cw, 0);
    z.ty = ch <= h ? (h - ch) / 2 : clamp(z.ty, h - ch, 0);
  }
  const maxScale = () => Math.max(3, photos[S.index].w / z.fw);
  function zoomTo(s, px, py) {
    const next = clamp(s, 1, maxScale());
    const k = next / z.s;
    z.tx = px - (px - z.tx) * k;
    z.ty = py - (py - z.ty) * k;
    z.s = next;
    constrain();
    apply();
    maybeLoadOriginal();
  }
  function toggleZoom(px, py) {
    if (z.s > 1.05) zoomTo(1, px, py);
    else zoomTo(Math.max(2, photos[S.index].w / z.fw), px, py);
  }
  // Swap in the full-resolution file once the view is sharper than the 2048px preview.
  function maybeLoadOriginal() {
    const p = photos[S.index];
    const img = imgs[S.cur];
    if (img.dataset.orig === String(p.id) || img.dataset.loading === String(p.id)) return;
    if (z.fw * z.s * dpr() <= displayWidth(p) * 0.95 || p.w <= displayWidth(p) * 1.05) return;
    img.dataset.loading = p.id;
    spinner.hidden = false;
    const probe = new Image();
    probe.src = original(p);
    probe.decode().then(() => {
      if (S.photoId === p.id && imgs[S.cur] === img) { img.src = probe.src; img.dataset.orig = p.id; }
    }).catch(() => PL.toast("Couldn't load the original size"))
      .finally(() => { img.dataset.loading = ''; spinner.hidden = true; });
  }

  // ---------- showing photos ----------
  const decodeUrl = (url) => {
    const im = new Image();
    im.src = url;
    return im.decode().then(() => true, () => false);
  };
  function chrome(p) {
    const n = photos.length;
    countEl.textContent = n > 1 ? `${S.index + 1} / ${n}` : '';
    likeBtn.setAttribute('aria-pressed', p.liked ? 'true' : 'false');
    likeBtn.setAttribute('aria-label', p.liked ? 'Remove like' : 'Like');
    likeCount.textContent = p.likes > 0 ? p.likes : '';
    renderInfo(p);
    history.replaceState({ pl: 1 }, '', `${albumPath}/p/${p.id}${qs}`);
    renderTags(p);
  }
  // Tags are links: tapping one shows every photo with that tag.
  function renderTags(p) {
    const tags = p.t || [];
    root.classList.toggle('has-tags', tags.length > 0);
    tagsEl.replaceChildren(...tags.map(([name, tagSlug]) => {
      const a = document.createElement('a');
      a.href = `${albumPath}?tag=${encodeURIComponent(tagSlug)}`;
      a.textContent = name;
      return a;
    }));
  }
  function renderInfo(p) {
    infoEl.replaceChildren();
    const add = (cls, text) => { if (!text) return; const el = document.createElement('p'); el.className = cls; el.textContent = text; infoEl.append(el); };
    const e = p.exif || {};
    add('cap', p.cap);
    add('row', [e.camera, e.lens].filter(Boolean).join(' · '));
    add('row', [e.focal, e.aperture, e.shutter, e.iso && `ISO ${e.iso}`].filter(Boolean).join(' · '));
    add('row', p.taken ? new Date(p.taken).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '');
    add('row', `${p.w} × ${p.h} px`);
  }
  async function show(i, { fade = false } = {}) {
    const n = photos.length;
    S.index = ((i % n) + n) % n;
    const my = ++S.token;
    const p = photos[S.index];
    S.photoId = p.id;
    chrome(p);
    spinner.hidden = true;

    const prev = imgs[S.cur];
    const target = fade ? imgs[1 - S.cur] : prev;
    if (!fade) {
      target.dataset.orig = target.dataset.loading = '';
      target.src = thumb(p);
      layout(target, p);
      target.classList.add('on');
      imgs[1 - S.cur].classList.remove('on');
    }
    const ok = await decodeUrl(display(p));
    if (my !== S.token) return;
    if (fade) {
      target.dataset.orig = target.dataset.loading = '';
      layout(target, p);
      target.src = ok ? display(p) : thumb(p);
      await target.decode().catch(() => {});
      if (my !== S.token) return;
      target.classList.add('on');
      prev.classList.remove('on');
      S.cur = 1 - S.cur;
    } else if (ok) {
      target.src = display(p);
    }
    for (const d of [1, -1]) new Image().src = display(photos[(S.index + d + n) % n]);
  }
  const nav = (d) => { show(S.index + d, { fade: S.show.on }); if (S.show.on) scheduleNext(); };

  // ---------- open / close ----------
  function open(i, { push = true } = {}) {
    if (!root) build();
    S.lastFocus = document.activeElement;
    S.open = true;
    root.hidden = false;
    document.documentElement.classList.add('lb-open');
    if (push) { history.pushState({ pl: 1 }, '', `${albumPath}/p/${photos[i].id}${qs}`); S.pushed = true; }
    imgs.forEach((im) => im.classList.remove('on'));
    S.cur = 0;
    show(i);
    root.focus({ preventScroll: true });
    poke();
  }
  function close() {
    if (!S.open) return;
    if (S.pushed) { S.pushed = false; history.back(); } // popstate → teardown
    else teardown();
  }
  function teardown() {
    if (!S.open) return;
    stopSlideshow();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    S.open = false;
    S.token++;
    root.hidden = true;
    document.documentElement.classList.remove('lb-open');
    if (/\/p\/\d+$/.test(location.pathname)) history.replaceState(null, '', albumPath + qs);
    const tile = document.querySelector(`#grid a[data-index="${S.index}"]`);
    if (tile) { tile.scrollIntoView({ block: 'nearest' }); tile.focus({ preventScroll: true }); }
    else if (S.lastFocus) S.lastFocus.focus({ preventScroll: true });
  }
  window.addEventListener('popstate', () => { if (S.open) { S.pushed = false; teardown(); } });

  // ---------- slideshow ----------
  const setShowIcon = (playing) => {
    btnShow.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
    btnShow.setAttribute('aria-label', playing ? 'Pause slideshow' : 'Start slideshow');
  };
  async function acquireWake() {
    try { if (navigator.wakeLock && !S.wake) { S.wake = await navigator.wakeLock.request('screen'); S.wake.addEventListener('release', () => { S.wake = null; }); } } catch { /* not allowed */ }
  }
  function releaseWake() { try { S.wake && S.wake.release(); } catch { /* ignore */ } S.wake = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.show.on) acquireWake(); });

  function scheduleNext() {
    clearTimeout(S.show.timer);
    progress.classList.remove('run');
    if (!S.show.on || S.show.paused) return;
    void progress.offsetWidth; // restart the CSS animation
    root.style.setProperty('--dur', `${S.show.secs}s`);
    progress.classList.add('run');
    S.show.timer = setTimeout(async () => { await show(S.index + 1, { fade: true }); scheduleNext(); }, S.show.secs * 1000);
  }
  function startSlideshow(from) {
    if (!S.open) open(typeof from === 'number' ? from : S.index);
    S.show.on = true;
    S.show.paused = false;
    root.classList.add('lb--show');
    root.classList.remove('lb--paused');
    setShowIcon(true);
    const fs = root.requestFullscreen || root.webkitRequestFullscreen;
    if (fs) { try { Promise.resolve(fs.call(root)).catch(() => {}); } catch { /* ignore */ } }
    acquireWake();
    scheduleNext();
  }
  function stopSlideshow() {
    if (!S.show.on) return;
    S.show.on = false;
    clearTimeout(S.show.timer);
    progress.classList.remove('run');
    root.classList.remove('lb--show', 'lb--paused');
    setShowIcon(false);
    releaseWake();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  function togglePause() {
    if (!S.show.on) return startSlideshow();
    S.show.paused = !S.show.paused;
    root.classList.toggle('lb--paused', S.show.paused);
    setShowIcon(!S.show.paused);
    if (S.show.paused) { clearTimeout(S.show.timer); progress.classList.remove('run'); } else scheduleNext();
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && S.show.on) stopSlideshow(); });

  // ---------- chrome visibility ----------
  function poke() {
    root.classList.remove('idle');
    clearTimeout(S.idleTimer);
    S.idleTimer = setTimeout(() => { if (!S.overUi && !root.hidden) root.classList.add('idle'); }, 2500);
  }

  // ---------- events ----------
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else { const fs = root.requestFullscreen || root.webkitRequestFullscreen; fs && fs.call(root); }
  }
  function toggleInfo(force) {
    S.info = force ?? !S.info;
    infoEl.hidden = !S.info;
    root.querySelector('[data-act=info]').setAttribute('aria-pressed', String(S.info));
  }
  const act = {
    close, prev: () => nav(-1), next: () => nav(1), info: () => toggleInfo(),
    like: () => PL.like(S.photoId),
    download: () => PL.save(photos[S.index]),
    share: () => PL.share(`${location.origin}${albumPath}/p/${S.photoId}`, D.album.title),
    zoom: () => { const { w, h } = stageSize(); toggleZoom(w / 2, h / 2); },
    slideshow: () => (S.show.on ? togglePause() : startSlideshow()),
    fullscreen: toggleFullscreen,
  };

  function wire() {
    root.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) act[b.dataset.act](); });
    root.addEventListener('pointermove', (e) => { S.overUi = !!e.target.closest('.lb-bar,.lb-nav,.lb-info'); if (e.pointerType === 'mouse') poke(); });
    document.addEventListener('pl:likes', () => { if (S.open) chrome(photos[S.index]); });
    window.addEventListener('resize', () => { if (S.open) { layout(imgs[S.cur], photos[S.index]); } });

    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomTo(z.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX, e.clientY);
    }, { passive: false });

    // pointer gestures: pan, pinch, swipe, double-tap
    const ptrs = new Map();
    let g = null;
    const mid = () => { const [a, b] = [...ptrs.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; };
    const rebase = () => {
      const [first] = ptrs.values();
      g = { s0: z.s, tx0: z.tx, ty0: z.ty, x0: first ? first.x : 0, y0: first ? first.y : 0 };
      if (ptrs.size === 2) Object.assign(g, { m0: mid() });
    };
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      stage.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      g = null; rebase();
      if (ptrs.size === 1) g.single = true;
      poke();
    });
    stage.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size >= 2 && g.m0) {
        const m = mid();
        const next = clamp(g.s0 * (m.d / g.m0.d), 1, maxScale());
        const k = next / g.s0;
        z.s = next;
        z.tx = m.x - (g.m0.x - g.tx0) * k;
        z.ty = m.y - (g.m0.y - g.ty0) * k;
        constrain(); apply(); maybeLoadOriginal();
        g.single = false;
      } else if (z.s > 1.001) {
        z.tx = g.tx0 + (p.x - g.x0);
        z.ty = g.ty0 + (p.y - g.y0);
        constrain(); apply();
      }
    });
    const end = (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size > 0) { rebase(); return; }
      const wasSingle = g && g.single;
      g = null;
      if (e.type === 'pointercancel' || !wasSingle) return;
      const dx = p.x - p.sx, dy = p.y - p.sy, dist = Math.hypot(dx, dy), dt = performance.now() - p.t;
      if (z.s <= 1.001 && dt < 900) {
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) return nav(dx < 0 ? 1 : -1);
        if (dy > 90 && dy > Math.abs(dx) * 1.4) return close();
      }
      if (dist < 10) {
        const now = performance.now();
        const near = Math.hypot(p.x - S.lastTap.x, p.y - S.lastTap.y) < 30;
        if (now - S.lastTap.t < 320 && near) {
          clearTimeout(S.tapTimer);
          S.lastTap = { t: 0, x: 0, y: 0 };
          toggleZoom(p.x, p.y);
        } else {
          S.lastTap = { t: now, x: p.x, y: p.y };
          if (e.pointerType !== 'mouse') S.tapTimer = setTimeout(() => root.classList.toggle('idle'), 320);
        }
      }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  }

  document.addEventListener('keydown', (e) => {
    if (!S.open || e.altKey || e.metaKey || e.ctrlKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'select' && e.key !== 'Escape') return;
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); nav(-1); break;
      case 'ArrowRight': e.preventDefault(); nav(1); break;
      case 'Escape': e.preventDefault(); if (S.show.on) stopSlideshow(); else close(); break;
      case ' ': if (tag !== 'button') { e.preventDefault(); togglePause(); } break;
      case 'i': case 'I': toggleInfo(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'l': case 'L': PL.like(S.photoId); break;
      case 'z': case 'Z': act.zoom(); break;
      case '+': case '=': { const { w, h } = stageSize(); zoomTo(z.s * 1.5, w / 2, h / 2); break; }
      case '-': { const { w, h } = stageSize(); zoomTo(z.s / 1.5, w / 2, h / 2); break; }
      case '0': { const { w, h } = stageSize(); zoomTo(1, w / 2, h / 2); break; }
      case 'Tab': { // keep focus inside the dialog
        const f = [...root.querySelectorAll('button:not([hidden]),select,.lb-tags a')].filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (!f.length) break;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        break;
      }
      default: return;
    }
    poke();
  });

  // ---------- entry points ----------
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[data-index]'); // grid tiles and the album's opening photo
    if (a) { e.preventDefault(); open(Number(a.dataset.index)); return; }
    if (e.target.closest('#btn-slideshow')) startSlideshow(0);
  });
  if (D.openId) {
    const i = photos.findIndex((p) => p.id === D.openId);
    if (i >= 0) open(i, { push: false });
  }
})();
