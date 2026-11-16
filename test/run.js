'use strict';
// Offline check: run the real pipeline against the mock TOA and verify EPA recovers true strengths.
const os = require('os'), path = require('path'), fs = require('fs');
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'epa-test-'));
const { truth, srv, nEvents } = require('./mock-toa');

srv.listen(0, async () => {
  process.env.TOA_BASE = `http://127.0.0.1:${srv.address().port}/api`;
  process.env.TOA_KEY = 'test';
  process.env.TOA_RPS = '1000';
  process.env.CACHE_DIR = cache;
  const data = require('../data');
  const ds = data.get('2526');
  while (ds.status.phase !== 'ready' && ds.status.phase !== 'error') await new Promise((r) => setTimeout(r, 50));
  const s = data.summary(ds);
  console.log('status', s.status.phase, s.status.error || '', `events ${s.events}/${nEvents} teams ${s.teams} matches ${s.matches}`);
  console.log('model', JSON.stringify({ acc: s.model.accuracy, brier: s.model.brier, comps: s.model.components }));

  const xs = [], ys = [];
  for (const r of ds.rows) if (r.n >= 20) { xs.push(truth[r.team]); ys.push(r.epa); }
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
  const corr = sxy / Math.sqrt(sxx * syy);
  console.log(`corr(true strength, EPA) over ${xs.length} teams with 20+ matches: ${corr.toFixed(3)}`);

  const top = data.queryTeams(ds, { limit: 3 }).rows;
  console.log('top3', top.map((r) => `${r.team}:${r.epa}(true ${truth[r.team].toFixed(1)})`).join(' '));
  const td = data.teamDetail(ds, top[0].team);
  console.log('team detail ok:', td.history.length > 0, td.events.length, 'events', td.matches.length, 'matches');
  const ev = data.eventDetail(ds, ds.eventList[0].key);
  console.log('event detail ok:', ev.teams.length, 'teams', ev.matches.length, 'matches');
  console.log('filters', ds.filters.countries.map((c) => `${c.key}:${c.n}`).join(' '));

  const ok = s.status.phase === 'ready' && corr > 0.8 && s.model.accuracy > 0.65;
  console.log(ok ? 'PASS' : 'FAIL');
  srv.close(); fs.rmSync(cache, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
});
