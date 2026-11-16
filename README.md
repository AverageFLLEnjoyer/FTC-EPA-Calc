# FTC EPA

An FTCScout-style site that ranks FIRST Tech Challenge teams by **EPA (Expected Points Added)**, the rating Statbotics uses for FRC, computed from The Orange Alliance (TOA) match data.

## Run it

Needs Node 18+. No npm install, no dependencies.

1. Sign in at theorangealliance.org, open your account page and generate an API key.
2. Start the server:

```bash
TOA_KEY=your_key_here node server.js
# open http://localhost:3000
```

The first run downloads every event of the season (about 2 requests per event, throttled to 3 per second, so a full season takes roughly half an hour). Everything is cached in `./cache`, finished events are never fetched again, and the site shows rankings as data arrives.

| Variable | Default | Purpose |
|---|---|---|
| `TOA_KEY` | none | Your TOA API key (required for the first download) |
| `SEASON` | `2526` | Season shown first. `2526` = 2025-26, `2627` = 2026-27 |
| `TOA_RPS` | `3` | Max API requests per second. Lower it if TOA returns 429s |
| `INGEST_REGIONS` | all | Comma list of TOA region keys, e.g. `USWA,USCA`, for a quick partial load |
| `MAX_EVENTS` | all | Cap on events, handy for testing |
| `PORT` | `3000` | Web port |

The key stays on the server. The browser only talks to `/api/*`.

## Put it online for free (GitHub Pages + Actions)

A scheduled GitHub Action downloads new matches every 3 hours, recomputes EPA, and publishes a static site. Nothing runs on a server and your key stays secret. See `HOSTING.md` for the step-by-step.

## Pages

- **Teams**: world ranking with country, region and search filters; sort by EPA, Auto, Teleop or Endgame.
- **Team**: world/country/region rank, component EPA, EPA-over-the-season chart, events, every match with predicted score and win %.
- **Events**: every event with the strength of its field.
- **Event**: teams ranked by EPA after the event, plus all matches.
- **Model**: how EPA is computed here and how well it predicted this season.

## The model (`epa.js`)

Same structure as Statbotics: each team has a rating in points, an alliance's predicted score is the sum of its teams' ratings, and after each match every team moves toward the surprise.

```
e    = (scoreOwn - predOwn - M * (scoreOpp - predOpp)) / (1 + M)
EPA += K(n) * e / teamsOnAlliance
```

Changes for FTC: 2-robot alliances (prior is half the early-season mean alliance score), shorter K and M schedules because FTC teams play far fewer matches, playoffs weighted 0.5, ratings carried across events in date order. Auto and Endgame EPA use M = 0 and Teleop is the remainder, as in Statbotics. All constants are in `DEFAULTS` at the top of `epa.js`.

Two choices of mine, not from Statbotics: the alliance error is divided across the alliance's robots, and the K/M schedules above are guesses to be tuned. The site reports prediction accuracy so you can tune them: change `DEFAULTS`, restart, and compare the "winner called right" number.

## Tests

`node test/run.js` runs the real pipeline against a fake TOA server (`test/mock-toa.js`) with hidden team strengths and checks that EPA recovers them.

## Things I could not verify

I had no TOA key and the API docs page would not load for me, so the real API was never called. The client follows TOA v3 as documented by its Node wrapper and my knowledge of its response shape. Check these first if the real data looks wrong:

- Endpoints used: `/event?season_key=`, `/event/{key}/matches`, `/event/{key}/matches/participants`, `/team/{n}`.
- Match fields read: `red_score`, `blue_score`, `red_auto_score`, `red_end_score` (and blue), `scheduled_time`, `match_name`. If auto/end fields are missing, those columns simply do not appear.
- Participant fields read: `team_key`, `station` (1x red, 2x blue), `station_status` (0 = no-show).
- Qualification vs playoff is read from the match key (`...-Q012-1` is a qual).
- Final scores include penalty points awarded by opponents. Statbotics excludes foul points; this version does not.

`data.js` (`normalizeMatches`) is the one place to adjust if a field name differs.
