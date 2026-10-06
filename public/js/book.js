/* Landing page: the closed book invites a click (it breathes, glints and rises when you hover or press it)
   and opens only when clicked or tapped.

   Two numbers drive the whole book in CSS:  --p  how far it is open (0 closed … 1 open)
                                             --v  which page a phone shows (0 left page … 1 right page)
   so the cover, the slide, the shadows and the shading always stay in sync.

   Layouts:  landscape screens (desktop, tablets, phones sideways) show the two-page spread;
             portrait screens show the book one page at a time: tap the cover, then swipe or tap the
             folded corner to turn the page.
   Without this script (or without @property support) the CSS opens the book by itself on a timer
   on landscape screens and shows the pages stacked on portrait ones. Reduced-motion users get the same. */
(() => {
  'use strict';
  const stage = document.querySelector('.stage:not(.solo)');
  const book = stage && stage.querySelector('.book');
  if (!book || typeof CSSPropertyRule === 'undefined' || !stage.animate) return;

  const wideQuery = matchMedia('(min-width:640px) and (min-height:340px) and (min-aspect-ratio:5/4)');
  const calmQuery = matchMedia('(prefers-reduced-motion:reduce)');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let stop = () => {};

  function setup() {
    stop();
    stop = () => {};
    if (calmQuery.matches) return;
    if (wideQuery.matches) stop = start(false);
    else if (innerHeight >= 420 && innerWidth >= 280) stop = start(true);
  }
  wideQuery.addEventListener('change', setup);
  calmQuery.addEventListener('change', setup);
  setup();

  function start(pager) {
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
    const anims = {};
    const read = (name) => parseFloat(getComputedStyle(stage).getPropertyValue(name)) || 0;
    const cancel = (name) => { if (anims[name]) { anims[name].cancel(); anims[name] = null; } };
    const hold = (name, value) => { cancel(name); stage.style.setProperty(name, String(value)); };
    const tween = (name, to, ms, easing) => {
      const from = read(name); // continues from wherever the value is right now: no jumps
      cancel(name);
      anims[name] = stage.animate([{ [name]: from }, { [name]: to }], { duration: ms, easing, fill: 'forwards' });
      return anims[name];
    };

    let opened = false;
    let hovering = false;
    let peek = () => {};

    // calm for a moment, then the cover lifts a little and settles, over and over
    const breathe = () => {
      cancel('--p');
      anims['--p'] = stage.animate([
        { '--p': 0, offset: 0, easing: 'ease-in-out' },
        { '--p': 0, offset: 0.2, easing: 'ease-in-out' },
        { '--p': 0.075, offset: 0.46, easing: 'ease-in-out' },
        { '--p': 0, offset: 0.78 },
        { '--p': 0, offset: 1 },
      ], { duration: 5600, delay: 1600, iterations: Infinity });
    };

    // ---- the invisible, keyboard-reachable control over the closed cover ----
    // (kept outside the 3D scene so it doesn't flicker while the cover tilts)
    const hit = button('hit', 'Open the book');
    const settle = () => {
      if (opened) return;
      tween('--p', 0, 700, 'ease-in-out').finished.then(() => { if (!hovering && !opened) breathe(); }, () => {});
    };
    on(hit, 'pointerenter', (e) => {
      if (opened || e.pointerType !== 'mouse') return;
      hovering = true;
      tween('--p', 0.115, 650, 'cubic-bezier(.2,.7,.2,1)'); // the cover rises and swings slightly open
    });
    on(hit, 'pointerleave', (e) => { if (e.pointerType === 'mouse') { hovering = false; settle(); } });
    on(hit, 'pointerdown', () => { if (!opened) tween('--p', 0.1, 200, 'ease-out'); }); // press feedback
    on(hit, 'pointercancel', () => { hovering = false; settle(); });
    on(hit, 'click', open);

    // The photos must be decoded before the pages start animating: a photo that finishes arriving while its
    // layer is already animating in 3D can fail to repaint. (Gives up waiting after 6 s so it can't hang.)
    const photos = [...stage.querySelectorAll('img')].map((img) => img.decode().catch(() => {}));
    const ready = Promise.race([Promise.all(photos), new Promise((resolve) => setTimeout(resolve, 6000))]);

    function open() {
      if (opened) return;
      opened = true;
      tween('--p', 0.12, 220, 'ease-out'); // answers the tap at once, even if photos are still arriving
      ready.then(() => {
        if (!stage.isConnected) return;
        stage.classList.add('open'); // starts the page animations and removes the click target
        const run = tween('--p', 1, pager ? 2100 : 2400, 'cubic-bezier(.5,.03,.2,1)');
        run.finished.then(() => {
          hold('--p', 1);
          stage.classList.add('opened');
          if (pager) { stage.classList.add('view-left'); peek(); }
        }, () => {});
      });
    }

    // ---- phones: turning pages ----
    if (pager) {
      const leaf = stage.querySelector('.leaf');
      const pageWidth = () => (leaf && leaf.offsetWidth) || 300;
      let view = 0;

      // now and then the book slides a hair toward the next page, showing its edge
      peek = () => {
        cancel('--v');
        anims['--v'] = stage.animate([
          { '--v': 0, offset: 0, easing: 'ease-in-out' },
          { '--v': 0, offset: 0.55, easing: 'ease-in-out' },
          { '--v': 0.07, offset: 0.78, easing: 'ease-in-out' },
          { '--v': 0, offset: 1 },
        ], { duration: 4200, delay: 2600, iterations: Infinity });
      };
      const setView = (to, ms = 700) => {
        view = to;
        stage.classList.toggle('view-left', to === 0);
        stage.classList.toggle('view-right', to === 1);
        tween('--v', to, ms, 'cubic-bezier(.4,.05,.2,1)').finished.then(() => hold('--v', to), () => {});
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
        stage.style.setProperty('--v', String(clamp(drag.v0 - dx / pageWidth(), 0, 1)));
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
