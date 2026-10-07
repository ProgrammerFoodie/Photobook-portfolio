/* Landing page: the closed book invites a click (it breathes, glints and rises when you hover or press it)
   and opens only when clicked or tapped.

   Two numbers drive the whole book in CSS:  --p  how far it is open (0 closed … 1 open)
                                             --v  which page a phone shows (0 left page … 1 right page)
   so the cover, the slide, the shadows and the shading always stay in sync. They are animated here with a
   tiny requestAnimationFrame engine, so no special browser feature is needed.

   Layouts:  landscape screens (desktop, tablets, phones sideways) show the two-page spread;
             portrait screens show the book one page at a time: tap the cover, then swipe or tap the
             folded corner to turn the page.
   "Reduce motion": the same book, but everything jumps instead of moving.
   Without this script the CSS opens the book by itself on a timer (landscape) or stacks the pages (portrait). */
(() => {
  'use strict';
  const stage = document.querySelector('.stage:not(.solo)');
  const book = stage && stage.querySelector('.book');
  if (!book) return;

  const wideQuery = matchMedia('(min-width:640px) and (min-height:340px) and (min-aspect-ratio:5/4)');
  const calmQuery = matchMedia('(prefers-reduced-motion:reduce)');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let stop = () => {};

  // ---- CSS-style cubic-bezier easing ----
  const bezier = (x1, y1, x2, y2) => {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) { // Newton's method
        const err = sx(t) - x;
        if (Math.abs(err) < 1e-5) return sy(t);
        const d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= err / d;
      }
      let lo = 0, hi = 1; t = x; // bisection fallback
      while (lo < hi) {
        const v = sx(t);
        if (Math.abs(v - x) < 1e-5) break;
        if (x > v) lo = t; else hi = t;
        t = (hi + lo) / 2;
      }
      return sy(t);
    };
  };
  const EASE = {
    out: bezier(0.2, 0.7, 0.2, 1),
    inOut: bezier(0.42, 0, 0.58, 1),
    openBook: bezier(0.5, 0.03, 0.2, 1),
    turn: bezier(0.4, 0.05, 0.2, 1),
  };

  function setup() {
    stop();
    stop = () => {};
    if (wideQuery.matches) stop = start(false);
    else if (innerHeight >= 420 && innerWidth >= 280) stop = start(true);
  }
  wideQuery.addEventListener('change', setup);
  calmQuery.addEventListener('change', setup);
  setup();

  function start(pager) {
    const calm = calmQuery.matches;
    const undo = [];
    const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); undo.push(() => target.removeEventListener(type, fn, opts)); };
    const add = (el) => { stage.append(el); undo.push(() => el.remove()); return el; };
    const button = (cls, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.setAttribute('aria-label', label);
      return add(b);
    };

    stage.classList.add('manual');
    if (pager) stage.classList.add('pager');

    // ---- animating the two numbers ----
    const values = { '--p': 0, '--v': 0 };
    const runs = {};
    const put = (name, v) => { values[name] = v; stage.style.setProperty(name, String(v)); };
    const cancel = (name) => { if (runs[name]) { runs[name].dead = true; runs[name] = null; } };
    put('--p', 0);
    put('--v', 0);

    // glide to a value; the promise says whether it arrived (false if something else took over)
    const tween = (name, to, ms, ease) => {
      cancel(name);
      if (calm || ms <= 0) { put(name, to); return Promise.resolve(true); }
      const from = values[name];
      const t0 = performance.now();
      const run = { dead: false };
      runs[name] = run;
      return new Promise((resolve) => {
        const step = (now) => {
          if (run.dead) return resolve(false);
          const k = clamp((now - t0) / ms, 0, 1);
          put(name, from + (to - from) * ease(k));
          if (k < 1) requestAnimationFrame(step);
          else { if (runs[name] === run) runs[name] = null; resolve(true); }
        };
        requestAnimationFrame(step);
      });
    };

    // a repeating pattern: [[position 0..1, value], …] over `ms`, after `delay`
    const cycle = (name, points, ms, delay) => {
      cancel(name);
      if (calm) return;
      const run = { dead: false };
      runs[name] = run;
      const t0 = performance.now() + delay;
      const step = (now) => {
        if (run.dead) return;
        if (now >= t0) {
          const phase = ((now - t0) % ms) / ms;
          let i = 0;
          while (i < points.length - 2 && phase > points[i + 1][0]) i++;
          const [a, va] = points[i];
          const [b, vb] = points[i + 1];
          put(name, va + (vb - va) * EASE.inOut(clamp((phase - a) / (b - a || 1), 0, 1)));
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    let opened = false;
    let hovering = false;
    let peek = () => {};

    // calm for a moment, then the cover lifts a little and settles, over and over
    const breathe = () => cycle('--p', [[0, 0], [0.2, 0], [0.46, 0.075], [0.78, 0], [1, 0]], 5600, 1600);

    // ---- the invisible, keyboard-reachable control over the closed cover ----
    // (kept outside the 3D scene so it doesn't flicker while the cover tilts)
    const hit = button('hit', 'Open the book');
    // a visible hint for people who don't know the cover opens (the button itself stays invisible);
    // it goes away with the button once the book is open
    const hint = document.createElement('span');
    hint.className = 'open-cue';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = 'Open the book';
    hit.append(hint);
    const settle = () => {
      if (opened) return;
      tween('--p', 0, 700, EASE.inOut).then((arrived) => { if (arrived && !hovering && !opened) breathe(); });
    };
    on(hit, 'pointerenter', (e) => {
      if (opened || e.pointerType !== 'mouse') return;
      hovering = true;
      tween('--p', 0.115, 650, EASE.out); // the cover rises and swings slightly open
    });
    on(hit, 'pointerleave', (e) => { if (e.pointerType === 'mouse') { hovering = false; settle(); } });
    on(hit, 'pointerdown', () => { if (!opened) tween('--p', 0.1, 200, EASE.out); }); // press feedback
    on(hit, 'pointercancel', () => { hovering = false; settle(); });
    on(hit, 'click', open);

    // The photos must be decoded before the pages start animating: a photo that finishes arriving while its
    // layer is already animating in 3D can fail to repaint. (Gives up waiting after 6 s so it can't hang.)
    const photos = [...stage.querySelectorAll('img')].map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()));
    const ready = Promise.race([Promise.all(photos), new Promise((resolve) => setTimeout(resolve, 6000))]);

    function open() {
      if (opened) return;
      opened = true;
      tween('--p', 0.12, 220, EASE.out); // answers the tap at once, even if photos are still arriving
      ready.then(() => {
        if (!stage.isConnected) return;
        stage.classList.add('open'); // starts the page animations and removes the click target
        tween('--p', 1, pager ? 2100 : 2400, EASE.openBook).then((arrived) => {
          if (!arrived) return;
          stage.classList.add('opened');
          if (pager) { stage.classList.add('view-left'); peek(); }
        });
      });
    }

    // ---- phones: turning pages ----
    if (pager) {
      const leaf = stage.querySelector('.leaf');
      const pageWidth = () => (leaf && leaf.offsetWidth) || 300;
      let view = 0;

      // now and then the book slides a hair toward the next page, showing its edge
      peek = () => cycle('--v', [[0, 0], [0.55, 0], [0.78, 0.07], [1, 0]], 4200, 2600);
      const setView = (to, ms = 700) => {
        view = to;
        stage.classList.toggle('view-left', to === 0);
        stage.classList.toggle('view-right', to === 1);
        tween('--v', to, ms, EASE.turn);
      };

      on(button('turn next', 'Next page'), 'click', () => setView(1));
      on(button('turn prev', 'Previous page'), 'click', () => setView(0));
      on(document, 'keydown', (e) => {
        if (!opened || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === 'ArrowRight') setView(1);
        else if (e.key === 'ArrowLeft') setView(0);
      });

      // drag the page with your finger; let go and it settles on the nearer page
      let drag = null;
      let muteClick = false;
      on(stage, 'pointerdown', (e) => {
        if (!opened || e.target.closest('.turn,.cue')) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), v0: view, live: false };
      });
      on(stage, 'pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.live) {
          if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
          drag.live = true;
          cancel('--v');
          try { stage.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        }
        put('--v', clamp(drag.v0 - dx / pageWidth(), 0, 1));
      });
      const release = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const d = drag;
        drag = null;
        if (!d.live) return;
        muteClick = true;
        setTimeout(() => { muteClick = false; }, 80);
        const dx = e.clientX - d.x;
        const speed = dx / Math.max(1, performance.now() - d.t);
        let to = d.v0;
        if (Math.abs(dx) > pageWidth() * 0.18 || Math.abs(speed) > 0.45) to = dx < 0 ? 1 : 0;
        setView(to, 450);
      };
      on(stage, 'pointerup', release);
      on(stage, 'pointercancel', release);
      on(stage, 'click', (e) => { if (muteClick) { e.preventDefault(); e.stopPropagation(); } }, true);
    }

    breathe();

    return () => {
      cancel('--p');
      cancel('--v');
      undo.forEach((fn) => fn());
      stage.classList.remove('manual', 'pager', 'open', 'opened', 'view-left', 'view-right');
      stage.style.removeProperty('--p');
      stage.style.removeProperty('--v');
    };
  }
})();
