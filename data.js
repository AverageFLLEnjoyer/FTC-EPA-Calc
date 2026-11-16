'use strict';
/**
 * Season dataset: download events/matches from TOA, normalize, run EPA, answer queries.
 */
const toa = require('./toa');
const { computeEPA, round } = require('./epa');

const DAY = 86400e3;
const datasets = new Map(); // season -> dataset

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const mode = (arr) => {
  const c = new Map();
  for (const v of arr) if (v) c.set(v, (c.get(v) || 0) + 1);
  let best = null, n = 0;
  for (const [k, v] of c) if (v > n) { best = k; n = v; }
  return best;
};

function levelOf(key) {
  // e.g. 2526-WA-TELT-Q008-1 (qual), ...-SF001-1, ...-F001-1, ...-E006-1
  const m = /-([A-Z]+)\d+-\d+$/.exec(key || '');
  return m && m[1] === 'Q' ? 'qual' : 'playoff';
}
function orderOf(key) {
  const m = /-([A-Z]+)(\d+)-(\d+)$/.exec(key || '');
  if (!m) return 0;
  return (m[1] === 'Q' ? 0 : 1e6) + Number(m[2]) * 10 + Number(m[3]);
}

/** Accepts either {participants:[...]} embedded in matches or a separate participants list. */
function normalizeMatches(ev, rawMatches, rawParts, stat = {}) {
  if (!Array.isArray(rawMatches)) throw new Error('matches response was not a list: ' + JSON.stringify(rawMatches).slice(0, 160));
  if (rawParts && !Array.isArray(rawParts)) throw new Error('participants response was not a list: ' + JSON.stringify(rawParts).slice(0, 160));
  const bump = (k) => { stat[k] = (stat[k] || 0) + 1; };
  const parts = new Map();
  const add = (p) => {
    const mk = p.match_key; if (!mk) return;
    if (!parts.has(mk)) parts.set(mk, []);
    parts.get(mk).push(p);
  };
  (rawParts || []).forEach(add);
  const out = [];
  for (const m of rawMatches || []) {
    const list = (m.participants && m.participants.length ? m.participants : parts.get(m.match_key)) || [];
    const red = [], blue = [];
    for (const p of list) {
      const team = num(p.team_key);
      if (!Number.isFinite(team)) continue;
      // station: 11/12/13 red, 21/22/23 blue. station_status 0 = no-show (does not play).
      if (p.station_status === 0 || p.station_status === '0') continue;
      const st = Number(p.station);
      (st >= 20 ? blue : red).push(team);
    }
    const rs = num(m.red_score), bs = num(m.blue_score);
    bump('rawMatches');
    if (!(rs >= 0) || !(bs >= 0)) { bump('dropNoScore'); continue; }
    if (!red.length || !blue.length) { bump('dropNoTeams'); continue; }
    const t0 = Date.parse(m.scheduled_time || m.start_time || '') || ev.t;
    out.push({
      key: m.match_key, eventKey: ev.key, level: levelOf(m.match_key), order: orderOf(m.match_key),
      name: m.match_name || m.match_key.split('-').slice(-2, -1)[0],
      t: t0,
      red: { teams: red, score: rs, auto: num(m.red_auto_score), end: num(m.red_end_score) },
      blue: { teams: blue, score: bs, auto: num(m.blue_auto_score), end: num(m.blue_end_score) },
    });
  }
  return out;
}

async function ingest(ds, { maxEvents = Infinity, regions = null } = {}) {
  ds.status = { phase: 'events', done: 0, total: 0, error: null, startedAt: Date.now() };
  try {
    const raw = await toa.events(ds.season);
    const now = Date.now();
    const events = raw.map((e) => ({
      key: e.event_key, name: e.event_name || e.event_key,
      start: e.start_date, end: e.end_date, t: Date.parse(e.start_date) || 0,
      city: e.city, state: e.state_prov, country: e.country, region: e.region_key,
      league: e.league_key, type: e.event_type_key, venue: e.venue, website: e.website,
    })).filter((e) => e.key && e.t && e.t < now + 1 * DAY)
      .filter((e) => !regions || regions.includes(e.region))
      .sort((a, b) => a.t - b.t).slice(0, maxEvents);
    ds.status.total = events.length;
    ds.status.phase = 'matches';
    ds.eventList = events;

    let cursor = 0, sinceCompute = 0;
    const failed = [];
    let queue = events;
    const worker = async () => {
      while (cursor < queue.length) {
        const ev = queue[cursor++];
        try {
          const finished = (Date.parse(ev.end) || ev.t) < now - 3 * DAY;
          const ttl = finished ? Infinity : 3600e3;
          const rawM = await toa.matches(ev.key, ttl);
          const embedded = rawM.some((m) => m.participants && m.participants.length);
          const rawP = embedded ? [] : await toa.participants(ev.key, ttl);
          ds.status.counts = ds.status.counts || {};
          const ms = normalizeMatches(ev, rawM, rawP, ds.status.counts);
          if (ms.length) { ds.rawByEvent.set(ev.key, ms); ds.eventMeta.set(ev.key, ev); }
        } catch (e) {
          ds.status.errors = (ds.status.errors || 0) + 1;
          ds.status.lastError = String(e.message || e);
          if (/TOA_KEY/.test(ds.status.lastError)) throw e;
          failed.push(ev);
          continue; // not counted as done; retried below
        }
        ds.status.done++;
        if (++sinceCompute >= 150) { sinceCompute = 0; compute(ds); }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    // Retry events that failed (usually rate limits), up to 3 more rounds.
    for (let round = 0; round < 3 && failed.length; round++) {
      queue = failed.splice(0); cursor = 0;
      ds.status.retrying = queue.length;
      await Promise.all(Array.from({ length: 2 }, worker));
    }
    ds.status.retrying = 0; ds.status.gaveUp = failed.length;
    compute(ds);
    ds.status.phase = 'ready';
  } catch (e) {
    ds.status.phase = 'error';
    ds.status.error = String(e.message || e);
  }
}

function compute(ds) {
  const all = [];
  for (const ms of ds.rawByEvent.values()) all.push(...ms);
  all.sort((a, b) => a.t - b.t || a.eventKey.localeCompare(b.eventKey) || (a.level === b.level ? a.order - b.order : a.level === 'qual' ? -1 : 1));
  // Within an event, keep quals before playoffs even if timestamps are missing.
  const res = computeEPA(all);
  ds.matches = all;
  ds.epa = res;

  // Team location = most common location among the events they played.
  const loc = new Map();
  for (const m of all) {
    const ev = ds.eventMeta.get(m.eventKey);
    for (const t of [...m.red.teams, ...m.blue.teams]) {
      let l = loc.get(t); if (!l) { l = { c: [], r: [], s: [], city: [] }; loc.set(t, l); }
      if (m.level === 'qual') { l.c.push(ev.country); l.r.push(ev.region); l.s.push(ev.state); l.city.push(ev.city); }
    }
  }
  const rows = [];
  for (const s of res.teams.values()) {
    const l = loc.get(s.team) || { c: [], r: [], s: [], city: [] };
    rows.push({
      team: s.team, epa: round(s.epa), auto: s.auto == null ? null : round(s.auto), tele: s.tele == null ? null : round(s.tele),
      end: s.end == null ? null : round(s.end), unitless: Math.round(s.unitless), max: round(s.max),
      n: s.n, w: s.wins, l: s.losses, t: s.ties, events: s.events.size,
      country: mode(l.c), region: mode(l.r), state: mode(l.s), city: mode(l.city),
      name: (ds.names.get(s.team) || {}).name || null,
    });
  }
  rows.sort((a, b) => b.epa - a.epa);
  rows.forEach((r, i) => { r.rank = i + 1; r.pct = round(100 * (1 - i / Math.max(1, rows.length)), 1); });
  const rankWithin = (key, rankKey) => {
    const seen = new Map();
    for (const r of rows) { const g = r[key] || '?'; const n = (seen.get(g) || 0) + 1; seen.set(g, n); r[rankKey] = n; }
  };
  rankWithin('country', 'countryRank'); rankWithin('region', 'regionRank');
  ds.rows = rows;
  ds.rowByTeam = new Map(rows.map((r) => [r.team, r]));

  ds.byTeam = new Map();
  ds.byEvent = new Map();
  for (const m of all) {
    for (const t of [...m.red.teams, ...m.blue.teams]) {
      if (!ds.byTeam.has(t)) ds.byTeam.set(t, []);
      ds.byTeam.get(t).push(m);
    }
    if (!ds.byEvent.has(m.eventKey)) ds.byEvent.set(m.eventKey, []);
    ds.byEvent.get(m.eventKey).push(m);
  }

  const countC = new Map(), regionC = new Map();
  for (const r of rows) {
    if (r.country) countC.set(r.country, (countC.get(r.country) || 0) + 1);
    if (r.region) regionC.set(r.region, (regionC.get(r.region) || 0) + 1);
  }
  ds.filters = {
    countries: [...countC].map(([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n),
    regions: [...regionC].map(([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n),
  };
  ds.version++;
}

function get(season) {
  let ds = datasets.get(season);
  if (!ds) {
    ds = { season, version: 0, rawByEvent: new Map(), eventMeta: new Map(), names: new Map(), rows: [], matches: [],
      byTeam: new Map(), byEvent: new Map(), filters: { countries: [], regions: [] }, epa: null, status: { phase: 'idle' } };
    datasets.set(season, ds);
    const regions = process.env.INGEST_REGIONS ? process.env.INGEST_REGIONS.split(',') : null;
    ingest(ds, { maxEvents: Number(process.env.MAX_EVENTS || Infinity), regions });
  }
  return ds;
}

const matchOut = (ds, m) => {
  const p = ds.epa.predictions.get(m.key) || {};
  return {
    key: m.key, event: m.eventKey, level: m.level, name: m.name, t: m.t,
    red: m.red.teams, blue: m.blue.teams, rs: m.red.score, bs: m.blue.score,
    pr: p.predRed == null ? null : round(p.predRed, 1), pb: p.predBlue == null ? null : round(p.predBlue, 1),
    p: p.pRed == null ? null : round(p.pRed, 3),
  };
};

function queryTeams(ds, { country, region, q, sort = 'epa', limit = 50, offset = 0 }) {
  let rows = ds.rows;
  if (country) rows = rows.filter((r) => r.country === country);
  if (region) rows = rows.filter((r) => r.region === region);
  if (q) {
    const s = String(q).toLowerCase().trim();
    rows = rows.filter((r) => String(r.team).startsWith(s) || (r.name || '').toLowerCase().includes(s));
  }
  if (sort !== 'epa' && ['auto', 'tele', 'end', 'unitless', 'max', 'n'].includes(sort)) {
    rows = [...rows].sort((a, b) => (b[sort] ?? -1e9) - (a[sort] ?? -1e9));
  }
  const total = rows.length;
  const page = rows.slice(offset, offset + Math.min(200, limit));
  page.forEach((r) => prefetchName(ds, r.team));
  return { total, rows: page };
}

const nameQueue = new Set();
async function prefetchName(ds, n) {
  if (process.env.NO_NAMES === '1' || ds.names.has(n) || nameQueue.has(n) || !toa.hasKey()) return;
  nameQueue.add(n);
  try {
    const raw = await toa.team(n);
    const t = Array.isArray(raw) ? raw[0] : raw;
    if (t) ds.names.set(n, { name: t.team_name_short || t.team_name_long || null, city: t.city, state: t.state_prov, country: t.country, rookie: t.rookie_year });
    const r = ds.rowByTeam.get(n); if (r && t) r.name = ds.names.get(n).name;
  } catch { /* names are optional */ } finally { nameQueue.delete(n); }
}

function teamDetail(ds, n) {
  const r = ds.rowByTeam.get(n);
  if (!r) return null;
  prefetchName(ds, n);
  const s = ds.epa.teams.get(n);
  const evs = new Map();
  for (const h of s.history) evs.set(h.e, h); // last history point per event = EPA at event end
  const events = [...evs].map(([k, h]) => {
    const meta = ds.eventMeta.get(k) || {};
    const ms = (ds.byEvent.get(k) || []).filter((m) => m.red.teams.includes(n) || m.blue.teams.includes(n));
    let w = 0, l = 0, t = 0;
    for (const m of ms) {
      const red = m.red.teams.includes(n); const d = (m.red.score - m.blue.score) * (red ? 1 : -1);
      if (d > 0) w++; else if (d < 0) l++; else t++;
    }
    return { key: k, name: meta.name, start: meta.start, city: meta.city, country: meta.country, epaEnd: h.epa, w, l, t };
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const hist = s.history;
  const step = Math.max(1, Math.floor(hist.length / 400));
  return {
    row: { ...r, name: (ds.names.get(n) || {}).name || r.name, info: ds.names.get(n) || null },
    history: hist.filter((_, i) => i % step === 0 || i === hist.length - 1),
    events,
    matches: (ds.byTeam.get(n) || []).map((m) => matchOut(ds, m)),
  };
}

function queryEvents(ds, { country, region, q, limit }) {
  let evs = [...ds.eventMeta.values()];
  if (country) evs = evs.filter((e) => e.country === country);
  if (region) evs = evs.filter((e) => e.region === region);
  if (q) { const s = String(q).toLowerCase(); evs = evs.filter((e) => (e.name || '').toLowerCase().includes(s) || e.key.toLowerCase().includes(s)); }
  return evs.sort((a, b) => b.t - a.t).slice(0, Number(limit) || 300).map((e) => {
    const ms = ds.byEvent.get(e.key) || [];
    const teams = new Set(ms.flatMap((m) => [...m.red.teams, ...m.blue.teams]));
    const epas = [...teams].map((t) => (ds.rowByTeam.get(t) || {}).epa).filter((v) => v != null).sort((a, b) => b - a);
    return { ...e, matches: ms.length, teams: teams.size, topEpa: epas[0] ?? null, avgTop8: epas.length ? round(epas.slice(0, 8).reduce((s, v) => s + v, 0) / Math.min(8, epas.length)) : null };
  });
}

function eventDetail(ds, key) {
  const meta = ds.eventMeta.get(key);
  if (!meta) return null;
  const ms = ds.byEvent.get(key) || [];
  const atEvent = new Map();
  for (const m of ms) for (const t of [...m.red.teams, ...m.blue.teams]) {
    const hs = ds.epa.teams.get(t).history; // last entry for this event
    for (let i = hs.length - 1; i >= 0; i--) if (hs[i].e === key) { atEvent.set(t, hs[i]); break; }
  }
  const teams = [...atEvent].map(([t, h]) => {
    const r = ds.rowByTeam.get(t) || {};
    const own = ms.filter((m) => m.red.teams.includes(t) || m.blue.teams.includes(t));
    let w = 0, l = 0, ti = 0;
    for (const m of own) { const d = (m.red.score - m.blue.score) * (m.red.teams.includes(t) ? 1 : -1); if (d > 0) w++; else if (d < 0) l++; else ti++; }
    return { team: t, name: r.name, epaEnd: h.epa, epaNow: r.epa, rank: r.rank, w, l, t: ti, country: r.country };
  }).sort((a, b) => b.epaEnd - a.epaEnd);
  return { event: meta, teams, matches: ms.map((m) => matchOut(ds, m)) };
}

function summary(ds) {
  const s = ds.epa && ds.epa.stats;
  return {
    season: ds.season, status: ds.status, version: ds.version,
    teams: ds.rows.length, events: ds.eventMeta.size, matches: ds.matches.length,
    model: s && { accuracy: s.accuracy, brier: s.brier, scored: s.scored, meanAlliance: round(s.mean0, 1), sdAlliance: round(s.sd0, 1),
      components: s.components, sdMargin: round(s.sdMargin, 1), config: s.config },
  };
}

module.exports = { get, queryTeams, teamDetail, queryEvents, eventDetail, summary, normalizeMatches, compute, ingest };
