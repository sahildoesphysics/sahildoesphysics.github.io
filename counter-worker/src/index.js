/*
 * Visitor counter for the website, as a Cloudflare Worker backed by a D1 (SQLite) database.
 *
 *   POST /hit    count one visit from the caller's country, return the totals
 *   GET  /stats  return the totals
 *
 * Only a two-letter country code (from Cloudflare's own geolocation, request.cf.country) and a
 * running count are stored. No IP addresses, cookies or user agents are kept.
 */

const SCHEMA = 'CREATE TABLE IF NOT EXISTS visits (country TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0)';
let schemaReady = null; // the table is created on first use, so no separate setup step is needed

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pingdom|uptime/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const originOk = allowed.length === 0 || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed.length === 0 ? '*' : originOk ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (!schemaReady) schemaReady = env.DB.prepare(SCHEMA).run().catch((e) => { schemaReady = null; throw e; });
      await schemaReady;
      if (url.pathname === '/hit' && request.method === 'POST') {
        if (!originOk) return json({ error: 'origin not allowed' }, 403, cors);
        const ua = request.headers.get('User-Agent') || '';
        if (ua && !BOT.test(ua)) {
          let cc = String((request.cf && request.cf.country) || 'XX').toUpperCase();
          if (!/^[A-Z]{2}$/.test(cc) || cc === 'T1') cc = 'XX'; // T1 = Tor, XX = unknown
          await env.DB.prepare(
            'INSERT INTO visits (country, count) VALUES (?1, 1) ON CONFLICT(country) DO UPDATE SET count = count + 1'
          ).bind(cc).run();
        }
        return json(await stats(env), 200, { ...cors, 'Cache-Control': 'no-store' });
      }
      if (url.pathname === '/stats' && request.method === 'GET') {
        return json(await stats(env), 200, { ...cors, 'Cache-Control': 'public, max-age=60' });
      }
      return json({ error: 'not found' }, 404, cors);
    } catch (err) {
      return json({ error: 'counter unavailable' }, 500, cors);
    }
  },
};

async function stats(env) {
  const { results } = await env.DB.prepare('SELECT country, count FROM visits ORDER BY count DESC, country ASC').all();
  const countries = (results || []).map((r) => ({ code: r.country, count: r.count }));
  const total = countries.reduce((s, c) => s + c.count, 0);
  return { total, countries };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
