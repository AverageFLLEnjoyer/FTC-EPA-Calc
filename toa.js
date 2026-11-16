'use strict';
/**
 * Minimal The Orange Alliance API v3 client: key header, throttle, retry, and a
 * disk cache so the (large) season download is only paid once.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = (process.env.TOA_BASE || 'https://theorangealliance.org/api').replace(/\/$/, '');
const KEY = process.env.TOA_KEY || '';
const ORIGIN = process.env.TOA_ORIGIN || 'FTC-EPA';
const RPS = Number(process.env.TOA_RPS || 3);
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

let nextSlot = 0;
let interval = 1000 / RPS; // ms between requests; grows when TOA says 429, creeps back down when calm
let calm = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttle() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + interval;
  if (at > now) await wait(at - now);
}
function tooFast(retryAfterSec) {
  // Pause everyone, then run slower (max 1 request per 1.5s) until things are calm again.
  interval = Math.min(1500, interval * 1.5);
  calm = 0;
  nextSlot = Math.max(nextSlot, Date.now() + Math.max(5, retryAfterSec || 0) * 1000);
  console.log(`TOA rate limit hit: pausing, now ${(1000 / interval).toFixed(1)} requests/s`);
}
function ok() { if (++calm >= 50 && interval > 1000 / RPS) { interval = Math.max(1000 / RPS, interval / 1.2); calm = 0; } }

const cacheFile = (p) => path.join(CACHE_DIR, crypto.createHash('sha1').update(BASE + p).digest('hex') + '.json');

/** ttlMs: how long a cached copy is fresh. Infinity = forever. */
async function get(p, { ttlMs = 3600e3, force = false } = {}) {
  const f = cacheFile(p);
  if (!force) {
    try {
      const st = fs.statSync(f);
      if (Date.now() - st.mtimeMs < ttlMs) return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch { /* miss */ }
  }
  if (!KEY) throw new Error('TOA_KEY is not set. Generate a key on your myTOA account page and start with TOA_KEY=...');
  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    await throttle();
    try {
      const res = await fetch(BASE + p, {
        headers: { 'Content-Type': 'application/json', 'X-TOA-Key': KEY, 'X-Application-Origin': ORIGIN },
      });
      if (res.status === 429) { lastErr = new Error(`TOA 429 for ${p}`); tooFast(Number(res.headers.get('retry-after'))); continue; }
      if (res.status >= 500) { lastErr = new Error(`TOA ${res.status} for ${p}`); await wait(1500 * (attempt + 1)); continue; }
      if (res.status === 404) { fs.writeFileSync(f, '[]'); return []; }
      if (!res.ok) throw new Error(`TOA ${res.status} for ${p}`);
      const data = await res.json();
      ok();
      fs.writeFileSync(f, JSON.stringify(data));
      return data;
    } catch (e) { lastErr = e; await wait(800 * (attempt + 1)); }
  }
  // Stale cache beats failing outright.
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { throw lastErr; }
}

module.exports = {
  BASE, hasKey: () => !!KEY,
  events: (season) => get(`/event?season_key=${season}`, { ttlMs: 6 * 3600e3 }),
  matches: (ev, ttlMs) => get(`/event/${ev}/matches`, { ttlMs }),
  participants: (ev, ttlMs) => get(`/event/${ev}/matches/participants`, { ttlMs }),
  team: (n) => get(`/team/${n}`, { ttlMs: 30 * 24 * 3600e3 }),
};
