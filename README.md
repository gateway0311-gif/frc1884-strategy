# FRC 1884 Strategy

Fastify + TypeScript + SQLite scaffold for the FRC strategy app.

## Griffins Hub

The hub is scouting and strategy in one page, served at `/hub`. The original pages at `/strategy` and `/scouting` are unchanged and keep working.

What each person sees depends on the code they sign in with:

| Role | Sees |
|---|---|
| Scout | Their assigned robot for each match, the entry form, pit scouting |
| Scout manager | Who is signed in and what each scout is writing, every entry, assignment overrides |
| Strategist | Compiled team figures, match analysis, AI briefs, match plans, pick list |
| Lead | Everything, plus event setup and settings |

### Try it locally

```bash
npm install
npm run build          # builds the server and the hub page
SCOUT_CODE=scout MANAGER_CODE=manager STRATEGIST_CODE=strategist LEAD_CODE=lead npm run seed:demo
SCOUT_CODE=scout MANAGER_CODE=manager STRATEGIST_CODE=strategist LEAD_CODE=lead npm start
```

Open `http://localhost:3000/hub` and sign in with one of the codes. `seed:demo` creates a made-up event whose schedule straddles the current time, with entries already in it, so every page has something to show.

While working on the hub page itself, run `npm run dev` (server) and `npm run dev:web` (page, with live reload on port 5173) side by side.

### Settings on the server

| Variable | Needed for |
|---|---|
| `SCOUT_CODE`, `MANAGER_CODE`, `STRATEGIST_CODE`, `LEAD_CODE` | Sign-in. A role with no code cannot be signed in to. Use four different codes. |
| `SESSION_SECRET` | Keeping people signed in across a server restart. At least 16 characters. |
| `TBA_API_KEY` | Importing the schedule, results, teams and rankings. Automatic robot assignment follows this schedule. |
| `ANTHROPIC_API_KEY` | AI briefs. Without it the strategy page works, minus the briefs. |
| `BRIEF_MODEL` | Optional. The model that writes briefs (default `claude-sonnet-5-5`). |

The Admin page shows which of these are set.

### How it fits together

- `src/shared/` is used by both the server and the page: the game definition, the match clock, the assignment planner and the roles.
- `src/hub/` is the hub's server logic; `src/routes/hub/` its routes, all under `/api/hub`.
- `web/` is the page (Vite, React, TypeScript). It builds into `public/hub`, which is not committed.
- `src/db/migrations.ts` holds numbered schema changes. Add a new one; never edit one that has shipped.
- Entries are saved on the phone first and sent in the background, so a dropped signal loses nothing.
- Every write is announced on a live stream (`/api/hub/events/:eventKey/stream`), which is how other screens update without a reload.

### A new season

Everything that changes with the game lives in one definition:

1. Copy `src/shared/games/rebuilt2026.ts`, change the scoring, ranking points, forms and metrics, and list it in `src/shared/games/index.ts`.
2. Add the field drawing in `web/src/games/` and list it in `web/src/games/index.tsx`. Without one, a plain field is used.
3. Choose the game when setting up the event in Admin.

### Tests

```bash
npm run check      # types, server and page
npm test           # unit and route tests
npm run test:e2e   # the hub in a real browser, against the demo event
```

`main` deploys itself, so these run on every pull request (`.github/workflows/ci.yml`).

## Stack

- Fastify for HTTP and API serving
- TypeScript for backend code
- SQLite for low-friction local development
- Static frontend served from `public/`; the hub page is built into `public/hub` from `web/`

## Getting started

```bash
npm install
npm run dev
```

The app serves:

- frontend: `http://localhost:3000/`
- health: `http://localhost:3000/api/health`
- events: `http://localhost:3000/api/events`
- teams: `http://localhost:3000/api/events/:eventKey/teams`
- matches: `http://localhost:3000/api/events/:eventKey/matches`
- strategy plans: `http://localhost:3000/api/events/:eventKey/strategy-plans`
- Statbotics ingest: `POST http://localhost:3000/api/integrations/statbotics/events/:eventKey/ingest`

## Current structure

- `public/`: current frontend assets
- `src/server.ts`: Fastify entrypoint
- `src/db/`: SQLite bootstrap and seed logic
- `src/routes/`: API routes
- `data/app.db`: local database file created at runtime

## Notes

- The frontend is still the existing prototype, now served by Fastify.
- The database schema is normalized so scouting, strategy plans, external snapshots, and analytics can move into the backend incrementally.
- `Statbotics` should be added as an upstream ingestion source, not queried directly from the browser.
- The migration path is incremental: keep the current UI working, add server-backed routes, then switch frontend tabs one at a time.

## Environment variables

Optional integrations are gated by env vars. Server boots without them; routes that depend on a key return `503` with `error_code` until the key is set.

- `TBA_API_KEY` — The Blue Alliance v3 API key, used by `/api/integrations/tba/...` ingest routes.
- `ANTHROPIC_API_KEY` — Anthropic API key, used by `/api/coach/match-brief/.../generate` to produce per-match Claude tactical briefs (Strategist + Driver views, with prompt caching). Set on the systemd unit (`Environment=ANTHROPIC_API_KEY=...`) and restart the service to enable.

## Production

Deployment assets for `jpclawhq` live in:

- `deploy/systemd/frc1884-strategy.service`
- `deploy/nginx/griffins1884.org.conf`
- `scripts/deploy-jpclawhq.sh`
- `docs/deploy-jpclawhq.md`
