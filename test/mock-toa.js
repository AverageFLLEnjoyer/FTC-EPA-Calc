'use strict';
// Fake TOA API with synthetic seasons so the site can be developed/tested offline.
// Hidden true strengths let test/run.js check that EPA actually recovers them.
const http = require('http');
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

const COUNTRIES = [['USA', 'USWA', 'WA'], ['USA', 'USCA', 'CA'], ['Canada', 'CAON', 'ON'], ['Australia', 'AUQLD', 'QLD'], ['Brazil', 'BRSP', 'SP']];
const N_TEAMS = 260;
const truth = {};
const home = {};
for (let i = 0; i < N_TEAMS; i++) {
  const n = 1000 + i * 7;
  truth[n] = Math.max(2, 22 + 12 * gauss());
  home[n] = i % COUNTRIES.length;
}
const teamsByRegion = COUNTRIES.map((_, r) => Object.keys(truth).filter((n) => home[n] === r).map(Number));

const events = [], matchesByEvent = {}, partsByEvent = {};
let evNo = 0;
const start = Date.parse('2025-10-04');
for (let round = 0; round < 10; round++) {
  for (let r = 0; r < COUNTRIES.length; r++) {
    const pool = teamsByRegion[r];
    for (let k = 0; k < 2; k++) {
      const key = `2526-${COUNTRIES[r][1]}-E${evNo++}`;
      const t0 = start + round * 14 * 86400e3 + k * 86400e3;
      events.push({ event_key: key, season_key: '2526', region_key: COUNTRIES[r][1], event_name: `${COUNTRIES[r][2]} Meet ${evNo}`, start_date: new Date(t0).toISOString(), end_date: new Date(t0).toISOString(), city: 'Testville', state_prov: COUNTRIES[r][2], country: COUNTRIES[r][0], event_type_key: 'LGMEET' });
      const roster = pool.slice().sort(() => rnd() - 0.5).slice(0, 18);
      const ms = [], ps = [];
      for (let q = 1; q <= 36; q++) {
        const s = roster.slice().sort(() => rnd() - 0.5).slice(0, 4);
        const mk = `${key}-Q${String(q).padStart(3, '0')}-1`;
        const red = [s[0], s[1]], blue = [s[2], s[3]];
        const sc = (t) => t.reduce((a, n) => a + truth[n], 0) + 9 * gauss();
        const ra = red.reduce((a, n) => a + truth[n] * 0.3, 0), ba = blue.reduce((a, n) => a + truth[n] * 0.3, 0);
        const rs = Math.round(Math.max(0, sc(red))), bs = Math.round(Math.max(0, sc(blue)));
        ms.push({ match_key: mk, event_key: key, tournament_level: 1, match_name: `Quals ${q}`, red_score: rs, blue_score: bs, red_auto_score: Math.round(ra), blue_auto_score: Math.round(ba), red_tele_score: rs - Math.round(ra), blue_tele_score: bs - Math.round(ba), red_end_score: 0, blue_end_score: 0, scheduled_time: new Date(t0 + q * 600e3).toISOString() });
        [11, 12].forEach((st, i) => ps.push({ match_participant_key: `${mk}-${st}`, match_key: mk, team_key: String(red[i]), station: st, station_status: 1 }));
        [21, 22].forEach((st, i) => ps.push({ match_participant_key: `${mk}-${st}`, match_key: mk, team_key: String(blue[i]), station: st, station_status: 1 }));
      }
      matchesByEvent[key] = ms; partsByEvent[key] = ps;
    }
  }
}

const srv = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/^\/api/, '');
  if (!req.headers['x-toa-key']) { res.writeHead(401); return res.end('{}'); }
  const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  let m;
  if (p === '/event') return send(events);
  if ((m = /^\/event\/([\w-]+)\/matches\/participants$/.exec(p))) return send(partsByEvent[m[1]] || []);
  if ((m = /^\/event\/([\w-]+)\/matches$/.exec(p))) return send(matchesByEvent[m[1]] || []);
  if ((m = /^\/team\/(\d+)$/.exec(p))) return send([{ team_key: m[1], team_name_short: `Robo ${m[1]}`, city: 'Testville', rookie_year: 2015 }]);
  res.writeHead(404); res.end('[]');
});

module.exports = { truth, srv, nEvents: events.length };
if (require.main === module) srv.listen(Number(process.env.MOCK_PORT || 4010), () => console.log('mock TOA on', srv.address().port));
