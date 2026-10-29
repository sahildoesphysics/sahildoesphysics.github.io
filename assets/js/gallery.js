/*
 * Gallery: a magnifying loupe on hover (mouse and trackpad only) and a lightbox on click or tap,
 * with the arrow keys moving between photos. Also used for the small figures on the research page.
 */
(() => {
  'use strict';
  const photos = [...document.querySelectorAll('.postcard-photo')];
  if (!photos.length) return;

  /* ---------- loupe ---------- */
  const canHover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const ZOOM = 2.6;
  if (canHover) {
    photos.forEach((btn) => {
      const img = btn.querySelector('img');
      const lens = btn.querySelector('.loupe');
      if (!img || !lens) return;
      let primed = false;
      const move = (e) => {
        // offsetX/Y are in the photo's own (unrotated) coordinates, so the tilt doesn't matter
        const w = img.offsetWidth, h = img.offsetHeight;
        const x = Math.max(0, Math.min(w, e.offsetX)), y = Math.max(0, Math.min(h, e.offsetY));
        const L = lens.offsetWidth;
        lens.style.transform = `translate(${x - L / 2}px, ${y - L / 2}px)`;
        lens.style.backgroundSize = `${w * ZOOM}px ${h * ZOOM}px`;
        lens.style.backgroundPosition = `${L / 2 - x * ZOOM}px ${L / 2 - y * ZOOM}px`;
      };
      img.addEventListener('pointerenter', (e) => {
        if (!primed) {
          // the small image shows at once; the full-resolution one takes over when it arrives
          lens.style.backgroundImage = `url("${btn.dataset.full}"), url("${img.currentSrc || img.src}")`;
          primed = true;
        }
        move(e);
        btn.classList.add('is-looking');
      });
      img.addEventListener('pointermove', move);
      img.addEventListener('pointerleave', () => btn.classList.remove('is-looking'));
    });
  }

  /* ---------- lightbox ---------- */
  const dlg = document.getElementById('lightbox');
  if (!dlg) return;
  const big = document.getElementById('lightbox-img');
  const title = document.getElementById('lightbox-title');
  const meta = document.getElementById('lightbox-meta');
  const many = photos.length > 1;
  dlg.querySelectorAll('.lb-prev, .lb-next').forEach((b) => { b.hidden = !many; });
  let index = 0;

  function show(i) {
    index = (i + photos.length) % photos.length;
    const btn = photos[index];
    const img = btn.querySelector('img');
    big.src = img.currentSrc || img.src;           // instant, then swap in the full size
    const full = new Image();
    full.onload = () => { if (photos[index] === btn) big.src = btn.dataset.full; };
    full.src = btn.dataset.full;
    big.alt = img.alt;
    title.textContent = btn.dataset.title || '';
    meta.textContent = btn.dataset.meta || '';
  }
  function open(i) {
    show(i);
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); }
    else dlg.setAttribute('open', '');
  }
  function close() {
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }

  photos.forEach((btn, i) => btn.addEventListener('click', () => open(i)));
  document.getElementById('lb-close').addEventListener('click', close);
  document.getElementById('lb-prev').addEventListener('click', () => show(index - 1));
  document.getElementById('lb-next').addEventListener('click', () => show(index + 1));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });   // click on the backdrop
  dlg.addEventListener('keydown', (e) => {
    if (!many) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
  });
  dlg.addEventListener('close', () => photos[index].focus({ preventScroll: true }));
})();
