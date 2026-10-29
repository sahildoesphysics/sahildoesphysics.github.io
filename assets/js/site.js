/* Site-wide: the Hall-staircase menu, the light/dark switch and the footer year. */
(() => {
  'use strict';
  const rootEl = document.documentElement;

  /* ---------- menu ---------- */
  const btn = document.getElementById('menu-button');
  const panel = document.getElementById('site-menu');
  if (btn && panel) {
    const links = () => [...panel.querySelectorAll('a')];
    const isOpen = () => btn.getAttribute('aria-expanded') === 'true';
    function open(focusFirst) {
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-label', 'Close menu');
      if (focusFirst) (panel.querySelector('[aria-current="page"]') || links()[0]).focus();
    }
    function close(returnFocus) {
      if (!isOpen()) return;
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', 'Open menu');
      if (returnFocus) btn.focus();
    }
    btn.addEventListener('click', (e) => {
      if (isOpen()) close(false);
      else open(e.detail === 0);   // keyboard activation moves focus into the menu
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && !isOpen()) { e.preventDefault(); open(true); }
    });
    panel.addEventListener('keydown', (e) => {
      const items = links(), i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    });
    document.addEventListener('click', (e) => {
      if (isOpen() && !panel.contains(e.target) && !btn.contains(e.target)) close(false);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(true); });
    panel.addEventListener('focusout', (e) => {
      if (isOpen() && e.relatedTarget && !panel.contains(e.relatedTarget) && e.relatedTarget !== btn) close(false);
    });
  }

  /* ---------- theme ---------- */
  const themeBtn = document.getElementById('theme-toggle');
  const prefersDark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const current = () => rootEl.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light');
  function label() {
    if (!themeBtn) return;
    const next = current() === 'dark' ? 'light' : 'dark';
    themeBtn.setAttribute('aria-label', `Switch to ${next} theme`);
    themeBtn.title = `Switch to ${next} theme`;
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      rootEl.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) { /* storage unavailable */ }
      label();
    });
    label();
  }

  const y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());
})();
