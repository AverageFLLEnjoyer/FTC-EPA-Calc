'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const data = require('./data');
const toa = require('./toa');

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_SEASON = process.env.SEASON || '2526';
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

// TOA season keys are the two-digit start and end years: 2526 = 2025-26 (DECODE), 2627 = 2026-27.
const SEASONS = ['2627', '2526', '2425', '2324', '2223', '2122', '2021', '1920', '1819', '1718', '1617'];

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  try {
    if (p.startsWith('/api/')) {
      if (p === '/api/seasons') return send(res, 200, { seasons: SEASONS, default: DEFAULT_SEASON, hasKey: toa.hasKey() });
      const season = SEASONS.includes(q.season) ? q.season : DEFAULT_SEASON;
      const ds = data.get(season);
      if (p === '/api/summary') return send(res, 200, data.summary(ds));
      if (p === '/api/filters') return send(res, 200, ds.filters);
      if (p === '/api/teams') return send(res, 200, { version: ds.version, ...data.queryTeams(ds, { ...q, limit: Number(q.limit) || 50, offset: Number(q.offset) || 0 }) });
      if (p === '/api/events') return send(res, 200, { events: data.queryEvents(ds, q) });
      let m;
      if ((m = /^\/api\/team\/(\d+)$/.exec(p))) {
        const d = data.teamDetail(ds, Number(m[1]));
        return d ? send(res, 200, d) : send(res, 404, { error: 'No matches for this team in ' + season });
      }
      if ((m = /^\/api\/event\/([\w-]+)$/.exec(p))) {
        const d = data.eventDetail(ds, m[1]);
        return d ? send(res, 200, d) : send(res, 404, { error: 'Event not found (or no matches played yet)' });
      }
      return send(res, 404, { error: 'unknown endpoint' });
    }
    // static
    let f = path.normalize(path.join(PUB, p === '/' ? 'index.html' : p));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
    send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream');
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`FTC EPA on http://localhost:${PORT}  (season ${DEFAULT_SEASON}, TOA ${toa.BASE})`);
  if (!toa.hasKey()) console.log('WARNING: TOA_KEY not set. Only cached data will load.');
  data.get(DEFAULT_SEASON); // start downloading right away
});
