'use strict';
const $ = (s) => document.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1));
const pct = (v) => (v == null ? '—' : Math.round(v * 100) + '%');
const dt = (s) => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };

const state = { season: null, seasons: [], summary: null, rank: { country: '', region: '', q: '', sort: 'epa', offset: 0 }, ev: { country: '', region: '', q: '' }, filters: { countries: [], regions: [] } };
try { state.season = localStorage.getItem('season'); } catch { /* storage may be blocked */ }

let staticApi = null; // set at boot when the site is hosted as plain files (see static-api.js)
async function api(path, params = {}) {
  if (staticApi) return staticApi(state.season, path, params);
  const u = new URL('/api' + path, location.origin);
  u.searchParams.set('season', state.season);
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) u.searchParams.set(k, v);
  const r = await fetch(u);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

const loc = (r) => [r.city, r.state, r.country].filter(Boolean).join(', ');
const teamLink = (r) => `<a href="#/team/${r.team}"><b>${r.team}</b></a>${r.name ? `<small>${esc(r.name)}</small>` : ''}`;
const opts = (list, cur, all) => `<option value="">${all}</option>` + list.map((o) => `<option value="${esc(o.key)}"${o.key === cur ? ' selected' : ''}>${esc(o.key)} (${o.n})</option>`).join('');

/* ---------- chart ---------- */
function lineChart(points, { w = 1000, h = 300 } = {}) {
  if (points.length < 2) return '<div class="empty">Not enough matches yet to draw a trend.</div>';
  const m = { l: 44, r: 14, t: 12, b: 26 };
  const ys = points.map((p) => p.epa);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = Math.max(1, (hi - lo) * 0.12); lo = Math.max(0, lo - pad); hi += pad;
  const nice = (hi - lo) / 4, step = [1, 2, 5, 10, 20, 25, 50].find((s) => s >= nice) || 100;
  const y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step;
  const X = (i) => m.l + (i / (points.length - 1)) * (w - m.l - m.r);
  const Y = (v) => h - m.b - ((v - y0) / (y1 - y0)) * (h - m.t - m.b);
  let grid = '';
  for (let v = y0; v <= y1; v += step) grid += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.epa).toFixed(1)}`).join('');
  let marks = '', prev = null;
  points.forEach((p, i) => { if (p.e !== prev) { marks += `<line x1="${X(i)}" x2="${X(i)}" y1="${m.t}" y2="${h - m.b}" stroke="var(--line)" stroke-dasharray="3 4"/>`; prev = p.e; } });
  const last = points[points.length - 1];
  const dates = `<text x="${m.l}" y="${h - 6}">${esc(dt(points[0].t))}</text><text x="${w - m.r}" y="${h - 6}" text-anchor="end">${esc(dt(last.t))}</text>`;
  return `<div class="chart" id="chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="EPA over the season">${grid}${marks}
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="${X(points.length - 1)}" cy="${Y(last.epa)}" r="4.5" fill="var(--accent)"/>${dates}
    <circle id="hov" r="5" fill="var(--surface)" stroke="var(--accent)" stroke-width="2" style="display:none"/></svg><div class="tip" id="tip" hidden></div></div>`;
}
function wireChart(points, w = 1000, h = 300) {
  const box = $('#chart'); if (!box) return;
  const svg = box.querySelector('svg'), hov = $('#hov'), tip = $('#tip');
  const m = { l: 44, r: 14 };
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((x - m.l) / (w - m.l - m.r)) * (points.length - 1))));
    const p = points[i];
    const cx = m.l + (i / (points.length - 1)) * (w - m.l - m.r);
    hov.style.display = ''; hov.setAttribute('cx', cx);
    // Read the y position back from the drawn path so the dot sits exactly on the line.
    const path = svg.querySelector('path');
    const cy = path.getPointAtLength((i / (points.length - 1)) * path.getTotalLength()).y;
    hov.setAttribute('cy', cy);
    tip.hidden = false; tip.textContent = `${f1(p.epa)} EPA · ${dt(p.t)}`;
    tip.style.left = (cx / w) * r.width + 12 + 'px'; tip.style.top = (cy / h) * r.height + 12 + 'px';
  });
  svg.addEventListener('pointerleave', () => { hov.style.display = 'none'; tip.hidden = true; });
}

/* ---------- views ---------- */
async function viewRank() {
  const R = state.rank;
  if (!$('#rk')) {
    app.innerHTML = `<h1>FTC team rankings by EPA</h1><p class="sub" id="sub"></p>
      <div class="stats" id="stats"></div>
      <div class="filters" id="rk">
        <input type="search" id="q" placeholder="Search team number or name" aria-label="Search teams">
        <select id="country" aria-label="Country"></select><select id="region" aria-label="Region"></select>
        <div class="tabs" id="sorts"></div></div>
      <div id="list"></div>`;
    $('#q').addEventListener('input', debounce((e) => { R.q = e.target.value; R.offset = 0; loadList(); }));
    $('#country').addEventListener('change', (e) => { R.country = e.target.value; R.offset = 0; loadList(); });
    $('#region').addEventListener('change', (e) => { R.region = e.target.value; R.offset = 0; loadList(); });
    $('#sorts').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { R.sort = b.dataset.s; R.offset = 0; loadList(); } });
  }
  const s = state.summary;
  $('#sub').textContent = `Expected Points Added for every team in the ${seasonLabel(state.season)} season, from The Orange Alliance match data.`;
  $('#stats').innerHTML = [['Teams', s.teams], ['Events', s.events], ['Matches', s.matches], ['Winner called right', s.model ? pct(s.model.accuracy) : '—']]
    .map(([k, v]) => `<div class="stat"><b>${typeof v === 'number' ? v.toLocaleString() : v}</b><span>${k}</span></div>`).join('');
  const cs = state.filters.countries, rg = state.filters.regions.filter((r) => true);
  $('#country').innerHTML = opts(cs, R.country, 'All countries');
  $('#region').innerHTML = opts(rg, R.region, 'All regions');
  const comps = s.model && s.model.components;
  const sorts = [['epa', 'EPA'], ...(comps && comps.auto ? [['auto', 'Auto']] : []), ...(comps && comps.auto && comps.end ? [['tele', 'Teleop']] : []), ...(comps && comps.end ? [['end', 'Endgame']] : [])];
  $('#sorts').innerHTML = sorts.map(([k, l]) => `<button data-s="${k}" class="${R.sort === k ? 'on' : ''}">${l}</button>`).join('');
  await loadList();
}

async function loadList() {
  const R = state.rank, box = $('#list'); if (!box) return;
  $('#sorts').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.s === R.sort));
  const d = await api('/teams', { country: R.country, region: R.region, q: R.q, sort: R.sort, limit: 50, offset: R.offset });
  if (!d.rows.length) { box.innerHTML = `<div class="empty">${state.summary.status.phase === 'ready' ? 'No teams match these filters.' : 'Teams will appear as match data is downloaded.'}</div>`; return; }
  const top = Math.max(...d.rows.map((r) => r.epa), 1);
  const comp = state.summary.model && state.summary.model.components;
  box.innerHTML = `<div class="tbl"><table><thead><tr><th>#</th><th class="l">Team</th><th class="l">Location</th><th>EPA</th>
    ${comp.auto ? '<th>Auto</th>' : ''}${comp.auto && comp.end ? '<th>Teleop</th>' : ''}${comp.end ? '<th>Endgame</th>' : ''}<th>Rating</th><th>Record</th><th>Events</th></tr></thead><tbody>
    ${d.rows.map((r, i) => `<tr><td class="num">${R.country || R.region || R.q || R.sort !== 'epa' ? R.offset + i + 1 : r.rank}</td>
      <td class="l team">${teamLink(r)}</td><td class="l muted">${esc([r.state, r.country].filter(Boolean).join(', '))}</td>
      <td><div class="epa"><i style="width:${Math.max(2, (Math.max(r.epa, 0) / top) * 90)}px"></i><b>${f1(r.epa)}</b></div></td>
      ${comp.auto ? `<td>${f1(r.auto)}</td>` : ''}${comp.auto && comp.end ? `<td>${f1(r.tele)}</td>` : ''}${comp.end ? `<td>${f1(r.end)}</td>` : ''}
      <td>${r.unitless}</td><td><span class="w">${r.w}</span>-<span class="lo">${r.l}</span>-${r.t}</td><td>${r.events}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="pager"><span>${R.offset + 1}–${R.offset + d.rows.length} of ${d.total.toLocaleString()}</span>
    <button id="prev" ${R.offset ? '' : 'disabled'}>Prev</button><button id="next" ${R.offset + 50 < d.total ? '' : 'disabled'}>Next</button></div>`;
  $('#prev').onclick = () => { R.offset = Math.max(0, R.offset - 50); loadList(); window.scrollTo(0, 0); };
  $('#next').onclick = () => { R.offset += 50; loadList(); window.scrollTo(0, 0); };
}

async function viewTeam(n) {
  app.innerHTML = '<p class="muted">Loading team…</p>';
  let d;
  try { d = await api('/team/' + n); } catch (e) { app.innerHTML = `<h1>Team ${esc(n)}</h1><div class="empty">${esc(e.message)}</div>`; return; }
  const r = d.row, comp = state.summary.model.components;
  const loc2 = (r.info && [r.info.city, r.info.state, r.info.country].filter(Boolean).join(', ')) || loc(r);
  app.innerHTML = `<div class="hero"><div><h1>${r.team}${r.name ? ` <span class="muted">${esc(r.name)}</span>` : ''}</h1><p class="sub">${esc(loc2)} · ${seasonLabel(state.season)}</p></div>
    <div class="ranks"><div class="rk"><b>${r.rank}</b><span>World</span></div>
    ${r.country ? `<div class="rk"><b>${r.countryRank}</b><span>${esc(r.country)}</span></div>` : ''}
    ${r.region ? `<div class="rk"><b>${r.regionRank}</b><span>${esc(r.region)}</span></div>` : ''}
    <div class="rk"><b>${r.pct}%</b><span>Percentile</span></div></div></div>
    <div class="parts"><div class="part main"><b>${f1(r.epa)}</b><span>EPA</span></div>
    ${comp.auto ? `<div class="part"><b>${f1(r.auto)}</b><span>Auto</span></div>` : ''}
    ${comp.auto && comp.end ? `<div class="part"><b>${f1(r.tele)}</b><span>Teleop</span></div>` : ''}
    ${comp.end ? `<div class="part"><b>${f1(r.end)}</b><span>Endgame</span></div>` : ''}
    <div class="part"><b>${f1(r.max)}</b><span>Season max</span></div><div class="part"><b>${r.unitless}</b><span>Unitless rating</span></div>
    <div class="part"><b>${r.w}-${r.l}-${r.t}</b><span>Record</span></div></div>
    <h2>EPA over the season</h2>${lineChart(d.history)}
    <h2>Events</h2><div class="tbl"><table><thead><tr><th class="l">Event</th><th class="l">Date</th><th>EPA after</th><th>Record</th></tr></thead><tbody>
    ${d.events.map((e) => `<tr><td class="l"><a href="#/event/${esc(e.key)}">${esc(e.name)}</a></td><td class="l muted">${dt(e.start)}</td><td><b>${f1(e.epaEnd)}</b></td><td><span class="w">${e.w}</span>-<span class="lo">${e.l}</span>-${e.t}</td></tr>`).join('')}</tbody></table></div>
    <h2>Matches</h2>${matchTable(d.matches, r.team)}`;
  wireChart(d.history);
}

function matchTable(ms, focus) {
  if (!ms.length) return '<div class="empty">No matches.</div>';
  const side = (list) => list.map((t) => `<a href="#/team/${t}" ${t === focus ? 'style="font-weight:700"' : ''}>${t}</a>`).join(' ');
  return `<div class="tbl"><table><thead><tr><th class="l">Match</th><th class="l red">Red</th><th class="l blue">Blue</th><th>Score</th><th>Predicted</th><th>Red win %</th></tr></thead><tbody>
  ${ms.map((m) => {
    const win = m.rs > m.bs ? 'red' : m.bs > m.rs ? 'blue' : '';
    const mine = focus ? (m.red.includes(focus) ? 'red' : 'blue') : null;
    const res = focus && win ? (win === mine ? 'w' : 'lo') : '';
    return `<tr><td class="l"><a href="#/event/${esc(m.event)}">${esc(m.name)}</a></td><td class="l red">${side(m.red)}</td><td class="l blue">${side(m.blue)}</td>
    <td class="${res}"><span class="red">${m.rs}</span> – <span class="blue">${m.bs}</span></td>
    <td class="muted">${m.pr == null ? '—' : `${f1(m.pr)} – ${f1(m.pb)}`}</td><td>${pct(m.p)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

async function viewEvents() {
  const E = state.ev;
  if (!$('#ef')) {
    app.innerHTML = `<h1>Events</h1><p class="sub">Every event with match data, newest first, with the strength of its field in EPA.</p>
    <div class="filters" id="ef"><input type="search" id="eq" placeholder="Search events" aria-label="Search events"><select id="ec" aria-label="Country"></select><select id="er" aria-label="Region"></select></div><div id="elist"></div>`;
    $('#eq').addEventListener('input', debounce((e) => { E.q = e.target.value; loadEvents(); }));
    $('#ec').addEventListener('change', (e) => { E.country = e.target.value; loadEvents(); });
    $('#er').addEventListener('change', (e) => { E.region = e.target.value; loadEvents(); });
  }
  $('#ec').innerHTML = opts(state.filters.countries, E.country, 'All countries');
  $('#er').innerHTML = opts(state.filters.regions, E.region, 'All regions');
  await loadEvents();
}
async function loadEvents() {
  const E = state.ev, d = await api('/events', E), box = $('#elist'); if (!box) return;
  box.innerHTML = d.events.length ? `<div class="tbl"><table><thead><tr><th class="l">Event</th><th class="l">Date</th><th class="l">Location</th><th>Teams</th><th>Matches</th><th>Top EPA</th><th>Top-8 avg</th></tr></thead><tbody>
  ${d.events.map((e) => `<tr><td class="l"><a href="#/event/${esc(e.key)}"><b>${esc(e.name)}</b></a></td><td class="l muted">${dt(e.start)}</td><td class="l muted">${esc([e.city, e.state, e.country].filter(Boolean).join(', '))}</td>
  <td>${e.teams}</td><td>${e.matches}</td><td><b>${f1(e.topEpa)}</b></td><td>${f1(e.avgTop8)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No events found.</div>';
}

async function viewEvent(key) {
  app.innerHTML = '<p class="muted">Loading event…</p>';
  let d;
  try { d = await api('/event/' + key); } catch (e) { app.innerHTML = `<h1>${esc(key)}</h1><div class="empty">${esc(e.message)}</div>`; return; }
  const e = d.event;
  app.innerHTML = `<h1>${esc(e.name)}</h1><p class="sub">${dt(e.start)} · ${esc([e.city, e.state, e.country].filter(Boolean).join(', '))}${e.website ? ` · <a href="${esc(e.website)}" target="_blank" rel="noopener" style="text-decoration:underline">website</a>` : ''}</p>
  <h2>Teams by EPA</h2><div class="tbl"><table><thead><tr><th>#</th><th class="l">Team</th><th>EPA after event</th><th>EPA now</th><th>World rank</th><th>Record</th></tr></thead><tbody>
  ${d.teams.map((t, i) => `<tr><td class="num">${i + 1}</td><td class="l team">${teamLink(t)}</td><td><b>${f1(t.epaEnd)}</b></td><td>${f1(t.epaNow)}</td><td>${t.rank}</td><td><span class="w">${t.w}</span>-<span class="lo">${t.l}</span>-${t.t}</td></tr>`).join('')}</tbody></table></div>
  <h2>Matches</h2>${matchTable(d.matches)}`;
}

async function viewAbout() {
  const s = state.summary, m = s.model, c = m && m.config;
  app.innerHTML = `<h1>How EPA works for FTC</h1><div class="prose">
  <p>EPA (Expected Points Added) rates a team by the points it adds to an alliance's score, in the game's own units. It comes from FRC's Statbotics, which built it on Elo but measured in points, so a team's EPA reads like an OPR that updates after every match.</p>
  <h2>Update rule</h2>
  <p>Before each match, an alliance's predicted score is the sum of its teams' EPA. Afterwards every team moves toward what the alliance actually scored:</p>
  <pre>e = (scoreOwn − predOwn − M × (scoreOpp − predOpp)) / (1 + M)
EPA += K(n) × e / teamsOnAlliance</pre>
  <p><b>K</b> is the learning rate. It starts at ${c ? c.kEarly : 0.5} for a team's first ${c ? c.kRampStart : 4} matches and settles at ${c ? c.kLate : 0.3} by match ${c ? c.kRampEnd : 10}. <b>M</b> blends in the opponent's surprise, from 0 (pure offense) up to 1 (pure margin) between match ${c ? c.mStart : 8} and ${c ? c.mEnd : 24}. Playoff matches count ${c ? c.playoffWeight : 0.5}× as much as qualifiers. Ratings carry across events within a season, in date order.</p>
  <h2>What changes from FRC to FTC</h2>
  <ul><li>FTC alliances have 2 robots, so a new team starts at half the average alliance score seen in the season's first matches.</li>
  <li>FTC teams play far fewer matches, so the K and M schedules are shortened. Statbotics' FRC values are in <code>epa.js</code> comments and every constant is in one <code>DEFAULTS</code> object.</li>
  <li>Auto, Teleop and Endgame EPA follow Statbotics: Auto and Endgame use the same update on their own scores with M = 0, and Teleop is whatever is left of total EPA.</li></ul>
  <h2>Unitless rating</h2><p>"Rating" rescales EPA so seasons look alike: 1500 is a first-week average team and each early-season standard deviation of alliance score is worth 250.</p>
  ${m ? `<h2>Track record this season</h2><p>Before every match is replayed, the model predicts a winner. It was right for <b>${pct(m.accuracy)}</b> of ${m.scored.toLocaleString()} scored matches (Brier ${m.brier == null ? '—' : m.brier.toFixed(3)}). Mean alliance score ${m.meanAlliance}, typical margin error ${m.sdMargin} points.</p>` : ''}
  </div>`;
}

/* ---------- plumbing ---------- */
const seasonLabel = (k) => (k && k.length === 4 ? `20${k.slice(0, 2)}–${k.slice(2)}` : k || '');
function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function route() {
  const [, kind, arg] = location.hash.slice(1).split('/');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === (kind === 'team' || !kind ? 'rank' : kind === 'event' ? 'events' : kind)));
  window.scrollTo(0, 0);
  try {
    if (kind === 'team') await viewTeam(arg);
    else if (kind === 'event') await viewEvent(arg);
    else if (kind === 'events') await viewEvents();
    else if (kind === 'about') await viewAbout();
    else await viewRank();
  } catch (e) { app.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

async function refreshSummary() {
  state.summary = await api('/summary');
  state.filters = await api('/filters');
  const s = state.summary, b = $('#banner'), st = s.status;
  if (st.phase === 'error') { b.hidden = false; b.textContent = st.error; }
  else if (st.phase !== 'ready') {
    b.hidden = false;
    b.textContent = `Downloading ${seasonLabel(state.season)} from The Orange Alliance: ${st.done || 0} of ${st.total || '…'} events. Rankings update as data arrives.`;
  } else b.hidden = true;
  if (s.generatedAt) { const u = $('#updated'); if (u) u.textContent = 'Data updated ' + new Date(s.generatedAt).toLocaleString() + '.'; }
  const c = st.counts || {};
  if (st.phase !== 'error' && (st.done || 0) >= 5 && !s.teams) {
    b.hidden = false;
    b.textContent = `No teams yet after ${st.done} events. Matches seen: ${c.rawMatches || 0}, skipped for no score: ${c.dropNoScore || 0}, skipped for no teams: ${c.dropNoTeams || 0}, request errors: ${st.errors || 0}${st.lastError ? ' (' + st.lastError + ')' : ''}. Run node probe.js to see the raw data.`;
  }
  return s;
}

async function boot() {
  let cfg = null;
  try { // Hosted as plain files? Then data/meta.json exists and is real JSON.
    const r = await fetch('data/meta.json');
    if ((r.headers.get('content-type') || '').includes('json')) {
      cfg = { ...(await r.json()), hasKey: true };
      staticApi = StaticApi.create(async (p) => { const x = await fetch(p); if (!x.ok) throw new Error(x.statusText); return x.json(); });
    }
  } catch { /* fall through to the server API */ }
  if (!cfg) cfg = await (await fetch('/api/seasons')).json();
  state.seasons = cfg.seasons;
  if (!state.season || !cfg.seasons.includes(state.season)) state.season = cfg.default;
  $('#season').innerHTML = cfg.seasons.map((k) => `<option value="${k}"${k === state.season ? ' selected' : ''}>${seasonLabel(k)}</option>`).join('');
  $('#season').addEventListener('change', async (e) => {
    state.season = e.target.value; try { localStorage.setItem('season', state.season); } catch { /* ignore */ }
    state.rank.offset = 0; await refreshSummary(); route();
  });
  $('#jump').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#jumpq').value.trim(); if (/^\d+$/.test(v)) location.hash = '#/team/' + v; });
  addEventListener('hashchange', route);
  if (!cfg.hasKey) { const b = $('#banner'); b.hidden = false; b.textContent = 'TOA_KEY is not set on the server, so only cached data can load. See the README.'; }
  await refreshSummary(); await route();
  if (staticApi) return; // static data never changes while the page is open
  let lastVersion = state.summary.version;
  setInterval(async () => {
    const prev = state.summary.status.phase;
    const s = await refreshSummary().catch(() => null);
    if (s && (s.version !== lastVersion || (prev !== 'ready' && s.status.phase === 'ready'))) {
      lastVersion = s.version;
      if (!location.hash.startsWith('#/team') && !location.hash.startsWith('#/event') && location.hash !== '#/about') route();
    }
  }, s_interval());
}
function s_interval() { return 4000; }
boot();
