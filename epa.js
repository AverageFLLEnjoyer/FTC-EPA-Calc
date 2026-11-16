'use strict';
/**
 * EPA (Expected Points Added) adapted for FIRST Tech Challenge.
 *
 * Origin: Statbotics' EPA for FRC (Abhijit Gupta). EPA starts from Elo, but works
 * in point units, is not zero-sum, and is updated as an exponential moving average
 * of "how many points did this team's alliance score above/below expectation".
 *
 * FRC -> FTC changes:
 *  - Alliances have 2 robots instead of 3, so the prior is (mean alliance score / 2)
 *    and the alliance error is split across 2 teams.
 *  - FTC teams play far fewer matches per season, so the K and M schedules (which
 *    Statbotics indexes by matches played) are compressed. All knobs live in DEFAULTS.
 *  - Teams carry their rating across events within one season (events are replayed
 *    in date order), so a team's EPA at State is informed by its League Meets.
 *
 * Update for each team T on alliance A against opponent alliance B:
 *   errA = scoreA - sum(EPA of A), errB = scoreB - sum(EPA of B)       (pre-match ratings)
 *   e    = (errA - M * errB) / (1 + M)
 *   EPA_T += K(n_T) * levelWeight * e / |A|
 * Auto / Endgame component EPAs use the same update with M = 0; Teleop EPA is the
 * remainder (EPA - Auto - Endgame), as in Statbotics.
 */

const DEFAULTS = {
  kEarly: 0.5, kLate: 0.3, kRampStart: 4, kRampEnd: 10, // K by matches played (n)
  mStart: 8, mEnd: 24,                                   // margin weight M ramps 0 -> 1
  playoffWeight: 0.5,                                    // playoffs move ratings less
  baselineFrac: 0.1, baselineMin: 40, baselineMax: 600,  // matches used for priors/units
  unitSpread: 250,                                       // "unitless" EPA: 250 per stdev
};

const normCdf = (x) => {
  // Abramowitz-Stegun erf approximation
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return 0.5 * (1 + Math.sign(x) * y);
};
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

function kFor(n, c) {
  if (n <= c.kRampStart) return c.kEarly;
  if (n >= c.kRampEnd) return c.kLate;
  return c.kEarly + ((c.kLate - c.kEarly) * (n - c.kRampStart)) / (c.kRampEnd - c.kRampStart);
}
function mFor(n, c) {
  if (n <= c.mStart) return 0;
  if (n >= c.mEnd) return 1;
  return (n - c.mStart) / (c.mEnd - c.mStart);
}

/**
 * @param matches  chronologically sorted. Each:
 *   { key, eventKey, t (ms), level: 'qual'|'playoff',
 *     red:  { teams: [n,n], score, auto?, end? },
 *     blue: { teams: [n,n], score, auto?, end? } }
 * @returns { teams: Map<number, TeamState>, predictions: Map<matchKey, pred>, stats }
 */
function computeEPA(matches, opts = {}) {
  const c = { ...DEFAULTS, ...opts };
  const played = matches.filter((m) => m.red.teams.length && m.blue.teams.length &&
    Number.isFinite(m.red.score) && Number.isFinite(m.blue.score));

  const nBase = Math.min(c.baselineMax, Math.max(c.baselineMin, Math.round(played.length * c.baselineFrac)), played.length);
  const base = played.slice(0, nBase);
  const baseScores = base.flatMap((m) => [m.red.score, m.blue.score]);
  const mean0 = mean(baseScores) || 40;
  const sd0 = sd(baseScores) || 20;
  const hasComp = (k) => base.some((m) => Number.isFinite(m.red[k]) && Number.isFinite(m.blue[k]));
  // Only track a component when the game really scores it (a column of zeros means TOA doesn't split it out).
const compOn = { auto: false, end: false };
  const meanComp = (k) => mean(base.flatMap((m) => [m.red[k], m.blue[k]]).filter(Number.isFinite));
  compOn.auto = hasComp('auto') && meanComp('auto') > 0.5;
  compOn.end = hasComp('end') && meanComp('end') > 0.5;
  const avgTeams = mean(base.flatMap((m) => [m.red.teams.length, m.blue.teams.length])) || 2;
  const prior = {
    epa: mean0 / avgTeams,
    auto: compOn.auto ? meanComp('auto') / avgTeams : null,
    end: compOn.end ? meanComp('end') / avgTeams : null,
  };

  const teams = new Map();
  const get = (n) => {
    let s = teams.get(n);
    if (!s) {
      s = { team: n, epa: prior.epa, auto: prior.auto, end: prior.end, n: 0, nQual: 0, wins: 0, losses: 0, ties: 0,
        max: prior.epa, history: [], events: new Set() };
      teams.set(n, s);
    }
    return s;
  };

  const predictions = new Map();
  const margins = [];            // residual margin errors for the running sd
  let sdMargin = sd0 * 0.9;
  let correct = 0, counted = 0, brier = 0;

  for (const m of played) {
    const R = m.red.teams.map(get), B = m.blue.teams.map(get);
    const predR = R.reduce((s, x) => s + x.epa, 0);
    const predB = B.reduce((s, x) => s + x.epa, 0);
    const margin = predR - predB;
    const pRed = normCdf(margin / sdMargin);
    const actual = Math.sign(m.red.score - m.blue.score);

    // Score the prediction only once both alliances have some history.
    const experienced = [...R, ...B].every((x) => x.n >= 1);
    predictions.set(m.key, { predRed: predR, predBlue: predB, pRed, scored: experienced });
    if (experienced && actual !== 0) {
      counted++;
      if ((pRed > 0.5) === (actual > 0)) correct++;
      brier += (pRed - (actual > 0 ? 1 : 0)) ** 2;
    }
    if (experienced) {
      margins.push((m.red.score - m.blue.score) - margin);
      if (margins.length > 20) sdMargin = Math.max(8, sd(margins));
    }

    const w = m.level === 'playoff' ? c.playoffWeight : 1;
    const errR = m.red.score - predR, errB = m.blue.score - predB;
    const apply = (side, own, err, opp) => {
      for (const t of own) {
        const K = kFor(t.n, c) * w, M = mFor(t.n, c);
        const e = (err - M * opp) / (1 + M);
        t.epa += (K * e) / own.length;
        if (compOn.auto && Number.isFinite(side.auto)) {
          const ownPred = own.reduce((s, x) => s + x.auto, 0);
          t.auto += (K * (side.auto - ownPred)) / own.length;
        }
        if (compOn.end && Number.isFinite(side.end)) {
          const ownPred = own.reduce((s, x) => s + x.end, 0);
          t.end += (K * (side.end - ownPred)) / own.length;
        }
      }
    };
    // Alliances are disjoint, so updating red then blue never reads a rating the other side changed.
    apply(m.red, R, errR, errB);
    apply(m.blue, B, errB, errR);

    const res = actual;
    const bump = (list, won, lost) => list.forEach((t) => {
      t.n++; if (m.level !== 'playoff') t.nQual++;
      if (won) t.wins++; else if (lost) t.losses++; else t.ties++;
      t.events.add(m.eventKey);
      if (t.epa > t.max) t.max = t.epa;
      t.history.push({ k: m.key, e: m.eventKey, t: m.t, epa: round(t.epa), a: compOn.auto ? round(t.auto) : null, g: compOn.end ? round(t.end) : null });
    });
    bump(R, res > 0, res < 0); bump(B, res < 0, res > 0);
  }

  const tele = (s) => (compOn.auto && compOn.end ? s.epa - s.auto - s.end : null);
  for (const s of teams.values()) {
    s.tele = tele(s);
    s.unitless = 1500 + (c.unitSpread * (s.epa - prior.epa)) / sd0;
  }
  const stats = {
    matches: played.length, teams: teams.size, mean0, sd0, prior, components: compOn,
    accuracy: counted ? correct / counted : null, brier: counted ? brier / counted : null, scored: counted,
    sdMargin, config: c,
  };
  return { teams, predictions, stats };
}

function round(v, d = 2) { const f = 10 ** d; return Math.round(v * f) / f; }

module.exports = { computeEPA, DEFAULTS, normCdf, mean, sd, round };
