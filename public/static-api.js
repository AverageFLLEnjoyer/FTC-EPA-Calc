'use strict';
/**
 * Serves the same answers as the Node server's /api routes, but from the precomputed JSON
 * files that export.js writes (data/<season>/...). Used when the site is hosted as plain files.
 * Works in the browser (window.StaticApi) and in Node (for tests).
 */
(function (root) {
  function create(fetchJson) {
    const cache = new Map();
    const load = (p) => {
      if (!cache.has(p)) cache.set(p, fetchJson(p).catch((e) => { cache.delete(p); throw e; }));
      return cache.get(p);
    };
    const missing = (what, season) => new Error(`No ${what} data for this season (${season}).`);

    return async function api(season, path, params = {}) {
      const d = `data/${season}`;
      let m;
      if (path === '/summary') return load(`${d}/summary.json`);
      if (path === '/filters') return load(`${d}/filters.json`);
      if (path === '/teams') {
        const { country, region, q, sort = 'epa' } = params;
        const limit = Math.min(200, Number(params.limit) || 50), offset = Number(params.offset) || 0;
        let rows = (await load(`${d}/teams.json`)).rows;
        if (country) rows = rows.filter((r) => r.country === country);
        if (region) rows = rows.filter((r) => r.region === region);
        if (q) {
          const s = String(q).toLowerCase().trim();
          rows = rows.filter((r) => String(r.team).startsWith(s) || (r.name || '').toLowerCase().includes(s));
        }
        if (sort !== 'epa' && ['auto', 'tele', 'end', 'unitless', 'max', 'n'].includes(sort)) {
          rows = [...rows].sort((a, b) => (b[sort] ?? -1e9) - (a[sort] ?? -1e9));
        }
        return { version: 0, total: rows.length, rows: rows.slice(offset, offset + limit) };
      }
      if (path === '/events') {
        const { country, region, q } = params;
        let evs = (await load(`${d}/events.json`)).events;
        if (country) evs = evs.filter((e) => e.country === country);
        if (region) evs = evs.filter((e) => e.region === region);
        if (q) { const s = String(q).toLowerCase(); evs = evs.filter((e) => (e.name || '').toLowerCase().includes(s) || e.key.toLowerCase().includes(s)); }
        return { events: evs.slice(0, 300) };
      }
      if ((m = /^\/team\/(\d+)$/.exec(path))) {
        try { return await load(`${d}/team/${m[1]}.json`); } catch { throw missing('team', season); }
      }
      if ((m = /^\/event\/([\w-]+)$/.exec(path))) {
        try { return await load(`${d}/event/${m[1]}.json`); } catch { throw missing('event', season); }
      }
      throw new Error('unknown route ' + path);
    };
  }
  root.StaticApi = { create };
})(typeof window !== 'undefined' ? window : module.exports);
