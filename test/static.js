'use strict';
// Checks export.js output and the static client against the mock TOA (run: node test/static.js)
const os = require('os'), path = require('path'), fs = require('fs'), { spawnSync } = require('child_process');
const { srv } = require('./mock-toa');
srv.listen(0, () => {
  const env = { ...process.env, TOA_BASE: `http://127.0.0.1:${srv.address().port}/api`, TOA_KEY: 'test', TOA_RPS: '1000', SEASONS: '2526', NAMES_TOP: '5', CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'epa-static-')) };
  srv.unref();
  require('child_process').spawn(process.execPath, ['export.js'], { cwd: path.join(__dirname, '..'), env, stdio: 'inherit' }).on('exit', async (code) => {
    if (code) { console.log('FAIL: export exited', code); process.exit(1); }
    const dist = path.join(__dirname, '..', 'dist');
    const { create } = require('../public/static-api.js').StaticApi ? require('../public/static-api.js').StaticApi : {};
    const api = create(async (p) => { const f = path.join(dist, p); if (!fs.existsSync(f)) throw new Error('404 ' + p); return JSON.parse(fs.readFileSync(f, 'utf8')); });
    const meta = JSON.parse(fs.readFileSync(path.join(dist, 'data/meta.json'), 'utf8'));
    const sum = await api('2526', '/summary');
    const all = await api('2526', '/teams', { limit: 50 });
    const ca = await api('2526', '/teams', { country: 'Canada', limit: 5 });
    const srch = await api('2526', '/teams', { q: String(all.rows[0].team) });
    const ev = await api('2526', '/events', { country: 'Brazil' });
    const t = await api('2526', '/team/' + all.rows[0].team);
    const e = await api('2526', '/event/' + ev.events[0].key);
    let missing = ''; try { await api('2526', '/team/99999999'); } catch (x) { missing = x.message; }
    const checks = {
      meta: meta.default === '2526' && meta.seasons.length === 1,
      summary: sum.teams === 260 && sum.model.accuracy > 0.65,
      teamsPaged: all.rows.length === 50 && all.total === 260,
      countryFilter: ca.rows.length === 5 && ca.rows.every((r) => r.country === 'Canada') && ca.total === 52,
      search: srch.rows[0].team === all.rows[0].team,
      eventsFilter: ev.events.length > 0 && ev.events.every((x) => x.country === 'Brazil'),
      teamPage: t.history.length > 0 && t.matches.length > 0 && t.row.team === all.rows[0].team,
      namesTop: !!all.rows[0].name && t.row.name === all.rows[0].name,
      eventPage: e.teams.length > 0 && e.matches.length > 0,
      missing: /No team data/.test(missing),
      assets: ['index.html', 'app.js', 'static-api.js', 'style.css', '.nojekyll'].every((f) => fs.existsSync(path.join(dist, f))),
    };
    console.log(checks);
    const ok = Object.values(checks).every(Boolean);
    const sz = spawnSync('du', ['-sh', dist]).stdout.toString().trim();
    console.log('dist size:', sz, ok ? '\nPASS' : '\nFAIL');
    process.exit(ok ? 0 : 1);
  });
});
