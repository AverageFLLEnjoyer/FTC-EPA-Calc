'use strict';
/**
 * Builds the static website into ./dist: the files from public/ plus precomputed JSON
 * (data/<season>/...). Run by the GitHub Action, or by hand: TOA_KEY=... node export.js
 *
 *   SEASONS    comma list of TOA season keys, first one is the default. Default "2627"
 *   NAMES_TOP  how many top-ranked teams per season get their team name looked up. Default 300
 */
process.env.NO_NAMES = '1'; // names are fetched explicitly below, not per page view
const fs = require('fs');
const path = require('path');
const toa = require('./toa');
const data = require('./data');

const SEASONS = (process.env.SEASONS || '2627').split(',').map((s) => s.trim()).filter(Boolean);
const NAMES_TOP = Number(process.env.NAMES_TOP || 300);
const OUT = path.join(__dirname, 'dist');
const write = (rel, obj) => {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(obj));
};

async function exportSeason(season) {
  console.log(`\n== Season ${season} ==`);
  const ds = data.get(season);
  let last = 0;
  while (ds.status.phase !== 'ready' && ds.status.phase !== 'error') {
    await new Promise((r) => setTimeout(r, 1000));
    if (Date.now() - last > 15000) { last = Date.now(); console.log(`  ${ds.status.phase}: ${ds.status.done || 0}/${ds.status.total || '?'} events, ${ds.status.errors || 0} errors`); }
  }
  if (ds.status.phase === 'error') throw new Error(`Season ${season} failed: ${ds.status.error}`);
  if (ds.status.gaveUp) console.log(`  warning: ${ds.status.gaveUp} events could not be downloaded this run`);
  if (!ds.rows.length) throw new Error(`Season ${season} has no matches yet. Is the season key right?`);

  // Team names for the top teams (cached for 30 days, so this is cheap after the first run).
  let named = 0;
  for (const r of ds.rows.slice(0, NAMES_TOP)) {
    if (ds.names.has(r.team)) continue;
    try {
      const raw = await toa.team(r.team);
      const t = Array.isArray(raw) ? raw[0] : raw;
      if (t) { ds.names.set(r.team, { name: t.team_name_short || t.team_name_long || null, city: t.city, state: t.state_prov, country: t.country, rookie: t.rookie_year }); named++; }
    } catch { /* names are optional */ }
  }
  data.compute(ds);
  console.log(`  ${ds.rows.length} teams, ${ds.eventMeta.size} events, ${ds.matches.length} matches (${named} new names)`);

  const d = `data/${season}`;
  write(`${d}/summary.json`, { ...data.summary(ds), generatedAt: new Date().toISOString() });
  write(`${d}/filters.json`, ds.filters);
  write(`${d}/teams.json`, { rows: ds.rows });
  write(`${d}/events.json`, { events: data.queryEvents(ds, { limit: 100000 }) });
  for (const r of ds.rows) write(`${d}/team/${r.team}.json`, data.teamDetail(ds, r.team));
  for (const key of ds.eventMeta.keys()) write(`${d}/event/${key}.json`, data.eventDetail(ds, key));
}

(async () => {
  if (!toa.hasKey()) throw new Error('TOA_KEY is not set');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(path.join(__dirname, 'public'), OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  const done = [];
  for (const s of SEASONS) { await exportSeason(s); done.push(s); }
  write('data/meta.json', { seasons: done, default: done[0], generatedAt: new Date().toISOString() });
  console.log('\nDone. Static site is in ./dist');
  process.exit(0);
})().catch((e) => { console.error('\nEXPORT FAILED:', e.message); process.exit(1); });
