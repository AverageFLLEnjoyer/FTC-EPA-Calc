'use strict';
// Debug helper: show what TOA actually returns for one event and what the site makes of it.
//   node probe.js                 (picks the first event of the season that has matches)
//   node probe.js 2526-USWA-XXXX  (a specific event key)
const toa = require('./toa');
const { normalizeMatches } = require('./data');

(async () => {
  const season = process.env.SEASON || '2526';
  let key = process.argv[2];
  if (!key) {
    const evs = await toa.events(season);
    console.log(`events returned: ${Array.isArray(evs) ? evs.length : typeof evs}`);
    if (Array.isArray(evs) && evs[0]) console.log('first event keys:', Object.keys(evs[0]).join(', '));
    const past = (Array.isArray(evs) ? evs : []).filter((e) => Date.parse(e.start_date) < Date.now()).slice(-20);
    for (const e of past.reverse()) {
      const m = await toa.matches(e.event_key, 0);
      if (Array.isArray(m) && m.length) { key = e.event_key; break; }
    }
  }
  if (!key) return console.log('No event with matches found.');
  console.log('\nevent:', key);
  const m = await toa.matches(key, 0);
  const p = await toa.participants(key, 0);
  console.log('matches:', Array.isArray(m) ? m.length : JSON.stringify(m).slice(0, 300));
  console.log('participants:', Array.isArray(p) ? p.length : JSON.stringify(p).slice(0, 300));
  console.log('\nFIRST MATCH (raw):\n' + JSON.stringify(Array.isArray(m) ? m[0] : m, null, 2));
  console.log('\nFIRST 4 PARTICIPANTS (raw):\n' + JSON.stringify(Array.isArray(p) ? p.slice(0, 4) : p, null, 2));
  const stat = {};
  try {
    const out = normalizeMatches({ key, t: Date.now() }, m, p, stat);
    console.log('\nnormalized matches:', out.length, JSON.stringify(stat));
    if (out[0]) console.log(JSON.stringify(out[0]));
  } catch (e) { console.log('\nnormalize failed:', e.message); }
})().catch((e) => console.log('probe failed:', e.message));
