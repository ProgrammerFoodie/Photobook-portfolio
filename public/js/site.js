/* Shared helpers for the public site: toasts, likes, sharing, saving photos. */
(() => {
  'use strict';
  const PL = (window.PL = {});
  const dataEl = document.getElementById('album-data');
  PL.data = dataEl ? JSON.parse(dataEl.textContent) : null;

  // ---- toasts ----
  PL.toast = (message, { action, onAction, ms = 3500 } = {}) => {
    const host = document.querySelector('.toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast';
    const span = document.createElement('span');
    span.textContent = message;
    el.append(span);
    const remove = () => el.remove();
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action;
      b.addEventListener('click', () => { remove(); onAction && onAction(); });
      el.append(b);
    }
    host.append(el);
    setTimeout(remove, action ? Math.max(ms, 8000) : ms);
  };

  PL.photo = (id) => PL.data && PL.data.photos.find((p) => p.id === id);

  // ---- likes (optimistic) ----
  PL.like = async (id) => {
    const p = PL.photo(id);
    if (!p) return;
    const before = { liked: p.liked, likes: p.likes };
    p.liked = p.liked ? 0 : 1;
    p.likes += p.liked ? 1 : -1;
    PL.syncLikes();
    try {
      const res = await fetch(`/api/like/${id}`, { method: 'POST', credentials: 'same-origin', headers: { 'X-Photolib': '1' } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
      const r = await res.json();
      p.liked = r.liked ? 1 : 0;
      p.likes = r.count;
    } catch (err) {
      Object.assign(p, before);
      PL.toast(err.message === 'Too many requests, please slow down.' ? err.message : "Couldn't save your like. Try again.");
    }
    PL.syncLikes();
  };
  PL.syncLikes = () => {
    document.querySelectorAll('.tile-like').forEach((b) => {
      const p = PL.photo(Number(b.dataset.id));
      if (p) b.setAttribute('aria-pressed', p.liked ? 'true' : 'false');
    });
    document.dispatchEvent(new CustomEvent('pl:likes'));
  };

  // ---- sharing ----
  PL.share = async (url, title) => {
    if (navigator.share) {
      try { await navigator.share({ url, title }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); PL.toast('Link copied'); }
    catch { window.prompt('Copy this link', url); }
  };

  // ---- saving a single photo ----
  const plainDownload = (id) => {
    const a = document.createElement('a');
    a.href = `/dl/p/${id}`;
    a.download = '';
    document.body.append(a);
    a.click();
    a.remove();
  };
  // On phones the share sheet offers "Save Image" (straight to Photos); elsewhere a normal download.
  PL.save = async (p) => {
    const coarse = window.matchMedia('(pointer:coarse)').matches;
    if (!(coarse && navigator.canShare && navigator.share)) return plainDownload(p.id);
    PL.toast('Preparing photo…');
    let file;
    try {
      const res = await fetch(`/dl/p/${p.id}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('download failed');
      const blob = await res.blob();
      file = new File([blob], `${PL.data.album.slug}-${String(PL.data.photos.indexOf(p) + 1).padStart(3, '0')}.jpg`, { type: blob.type || 'image/jpeg' });
      if (!navigator.canShare({ files: [file] })) return plainDownload(p.id);
    } catch { return plainDownload(p.id); }
    const share = () => navigator.share({ files: [file] });
    try { await share(); }
    catch (e) {
      if (e.name === 'AbortError') return;
      // The browser wants a fresh tap after the download finished.
      PL.toast('Photo ready', { action: 'Save', onAction: () => share().catch(() => plainDownload(p.id)) });
    }
  };

  // ---- album page wiring ----
  document.addEventListener('click', (e) => {
    const like = e.target.closest('.tile-like');
    if (like) { e.preventDefault(); PL.like(Number(like.dataset.id)); return; }
    if (e.target.closest('#btn-share-album') && PL.data) {
      PL.share(`${location.origin}${location.pathname}${location.search}`, PL.data.album.title); // keeps an active filter
    }
  });
})();
