/* Landing page: the closed book invites a click (it breathes, glints and rises when you hover),
   and opens only when clicked. One number, --p (0 = closed … 1 = open), drives the whole book in CSS,
   so the cover, the slide, the shadows and the shading always stay in sync.
   Without this script (or without @property support) the CSS opens the book by itself on a timer. */
(() => {
  'use strict';
  const stage = document.querySelector('.stage:not(.solo)');
  const book = stage && stage.querySelector('.book');
  const desktop = matchMedia('(min-width:1000px) and (min-height:560px)').matches;
  const still = matchMedia('(prefers-reduced-motion:reduce)').matches;
  if (!book || !desktop || still || typeof CSSPropertyRule === 'undefined' || !stage.animate) return;

  stage.classList.add('manual');

  // invisible, keyboard-reachable control sitting exactly over the closed cover (kept outside the 3D scene
  // so it doesn't flicker while the cover tilts)
  const hit = document.createElement('button');
  hit.type = 'button';
  hit.className = 'hit';
  hit.setAttribute('aria-label', 'Open the book');
  stage.append(hit);

  const progress = () => parseFloat(getComputedStyle(stage).getPropertyValue('--p')) || 0;
  let anim = null;
  let opened = false;
  let hovering = false;

  const tween = (to, ms, easing) => {
    const from = progress();
    if (anim) anim.cancel();
    anim = stage.animate([{ '--p': from }, { '--p': to }], { duration: ms, easing, fill: 'forwards' });
    return anim;
  };

  // calm for a moment, then the cover lifts a little and settles, over and over
  const breathe = () => {
    if (anim) anim.cancel();
    anim = stage.animate([
      { '--p': 0, offset: 0, easing: 'ease-in-out' },
      { '--p': 0, offset: 0.2, easing: 'ease-in-out' },
      { '--p': 0.075, offset: 0.46, easing: 'ease-in-out' },
      { '--p': 0, offset: 0.78 },
      { '--p': 0, offset: 1 },
    ], { duration: 5600, delay: 1600, iterations: Infinity });
  };

  hit.addEventListener('pointerenter', () => {
    if (opened) return;
    hovering = true;
    tween(0.115, 650, 'cubic-bezier(.2,.7,.2,1)'); // the cover rises and swings slightly open
  });
  hit.addEventListener('pointerleave', () => {
    if (opened) return;
    hovering = false;
    tween(0, 800, 'ease-in-out').finished.then(() => { if (!hovering && !opened) breathe(); }, () => {});
  });

  hit.addEventListener('click', () => {
    if (opened) return;
    opened = true;
    stage.classList.add('open'); // starts the page animations and removes the click target
    const done = tween(1, 2400, 'cubic-bezier(.5,.03,.2,1)');
    done.finished.then(() => {
      stage.style.setProperty('--p', '1');
      done.cancel();
      stage.classList.add('opened');
    }, () => {});
  });

  breathe();
})();
