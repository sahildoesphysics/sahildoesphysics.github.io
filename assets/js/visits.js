/*
 * Visitor counter with country flags, shown in the footer of every page.
 * Talks to the Cloudflare Worker in /counter-worker. Paste its URL into ENDPOINT below (one place for
 * the whole site). Until then the block stays hidden.
 * Each browser session counts once, whichever pages it opens; visits from localhost are never counted.
 */
// Your counter's address, e.g. 'https://site-visit-counter.yourname.workers.dev'
const ENDPOINT = '';

(() => {
  'use strict';
  const box = document.getElementById('visits');
  if (!box) return;
  const list = document.getElementById('visits-flags');
  const totalEl = document.getElementById('visits-total');
  const nEl = document.getElementById('visits-n');
  const moreBtn = document.getElementById('visits-more');
  const note = document.getElementById('visits-note');
  const SHOW = 24;
  const flagBase = box.dataset.flags || 'assets/flags/';

  let names = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { /* older browsers */ }
  const nameOf = (code) => {
    if (code === 'XX') return 'Unknown location';
    try { return (names && names.of(code)) || code; } catch (e) { return code; }
  };
  const fmt = (n) => Number(n).toLocaleString('en');
  const GLOBE = '<svg viewBox="0 0 20 15" aria-hidden="true"><rect width="20" height="15" rx="2" fill="currentColor" opacity=".12"/><circle cx="10" cy="7.5" r="5" fill="none" stroke="currentColor" stroke-width="1"/><path d="M5 7.5h10M10 2.5c-2.2 2.8-2.2 7.2 0 10M10 2.5c2.2 2.8 2.2 7.2 0 10" fill="none" stroke="currentColor" stroke-width=".8"/></svg>';

  function flagEl(code) {
    const name = nameOf(code);
    if (code === 'XX' || !/^[A-Z]{2}$/.test(code)) {
      const s = document.createElement('span');
      s.className = 'visits-globe'; s.innerHTML = GLOBE; s.setAttribute('role', 'img'); s.setAttribute('aria-label', name);
      return s;
    }
    const img = document.createElement('img');
    img.src = `${flagBase}${code.toLowerCase()}.svg`;
    img.alt = name; img.width = 20; img.height = 15; img.loading = 'lazy'; img.decoding = 'async';
    img.addEventListener('error', () => img.replaceWith(flagEl('XX')), { once: true });
    return img;
  }

  function render(data) {
    const countries = (data.countries || []).filter((c) => c && c.count > 0)
      .sort((a, b) => (a.code === 'XX') - (b.code === 'XX') || b.count - a.count);
    const known = countries.filter((c) => c.code !== 'XX').length;
    totalEl.textContent = fmt(data.total || 0);
    nEl.textContent = `${fmt(known)} ${known === 1 ? 'country' : 'countries'}`;
    list.textContent = '';
    countries.forEach((c, i) => {
      const li = document.createElement('li');
      li.title = `${nameOf(c.code)}: ${fmt(c.count)} ${c.count === 1 ? 'visit' : 'visits'}`;
      if (i >= SHOW) li.hidden = true;
      const n = document.createElement('span');
      n.className = 'visits-n'; n.textContent = fmt(c.count);
      li.append(flagEl(c.code), n);
      list.append(li);
    });
    if (moreBtn) {
      const extra = countries.length - SHOW;
      moreBtn.hidden = extra <= 0;
      moreBtn.textContent = `+${extra} more`;
      moreBtn.onclick = () => {
        list.querySelectorAll('li[hidden]').forEach((li) => { li.hidden = false; });
        moreBtn.hidden = true;
      };
    }
    box.hidden = false;
  }

  // preview only: example data so the layout can be judged before the counter is deployed
  if (box.hasAttribute('data-demo')) {
    const demo = [['IN', 412], ['US', 198], ['FR', 87], ['DE', 64], ['GB', 41], ['NL', 29], ['CH', 22], ['JP', 18],
      ['CA', 15], ['IT', 12], ['CN', 11], ['SI', 9], ['KR', 7], ['ES', 6], ['OM', 5], ['AU', 4], ['BR', 3], ['XX', 3]];
    render({ total: demo.reduce((s, d) => s + d[1], 0), countries: demo.map(([code, count]) => ({ code, count })) });
    if (note) note.hidden = false;
    return;
  }

  const endpoint = (box.dataset.endpoint || ENDPOINT).trim().replace(/\/+$/, '');
  if (!endpoint) return;
  const local = location.protocol === 'file:' || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
  let seen = false;
  try { seen = sessionStorage.getItem('visit-counted') === '1'; } catch (e) { /* storage blocked */ }
  const count = (!local || box.hasAttribute('data-count-local')) && !seen;

  fetch(endpoint + (count ? '/hit' : '/stats'), { method: count ? 'POST' : 'GET', mode: 'cors', credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((data) => {
      if (count) { try { sessionStorage.setItem('visit-counted', '1'); } catch (e) { /* ignore */ } }
      render(data);
    })
    .catch(() => { /* counter unreachable: leave the block hidden */ });
})();
