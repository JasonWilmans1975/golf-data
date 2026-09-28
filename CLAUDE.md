# GolfCircle

Personal golf-tracking app for a small group of friends (~14 users today;
400k is an aspirational, not urgent, goal — see "Scale" below). Monorepo:
`backend/` (FastAPI) + `frontend/` (React/TS/Vite) + Supabase (Postgres,
Auth, Storage).

## Deploy topology (non-obvious — read before deploying anything)

- **Backend**: `api.slogs.co.za`, hosted on Render as a Docker service built
  from `backend/Dockerfile`. **Auto-deploys on push to `main`.** Runs
  `uvicorn app.main:app --workers 2`. Stays on the `api.slogs.co.za` domain
  even though the frontend moved off slogs.co.za entirely — only the
  frontend's domain changed, not the backend's.
- **Frontend has no CI/CD.** It's built locally (`npm run build` → `dist/`,
  base path `/`) and manually uploaded to cPanel at **golfcircle.me's
  document root — the only production domain**. slogs.co.za/handicap is
  retired; don't reintroduce dual-build complexity (base-path env vars, a
  second `.htaccess` RewriteBase, multi-origin CORS) unless the user asks
  for another domain again.
  - After any frontend change meant to go live: rebuild, rezip
    (`golfcircle-build.zip` — gitignored), tell the user to upload it to
    golfcircle.me's cPanel root. `zip -r` must NOT exclude dotfiles
    (`-x ".*"`) or `.htaccess` silently goes missing.
  - `frontend/public/.htaccess` handles SPA fallback, forced HTTP→HTTPS
    redirect, and cache headers.
- **Nightly batch sync**: a separate Render **Cron Job** resource (not the
  web service — own env vars, own "Root Directory: backend" setting since
  the Dockerfile lives at `backend/Dockerfile`) hits
  `POST /internal/sync-all` with header `x-cron-secret: $CRON_SECRET` at
  midnight UTC. That endpoint must respond instantly (`BackgroundTasks`) —
  the Cron Job's own request timeout will kill a long-running request and
  still report "succeeded" even though nothing happened.
- CORS: `FRONTEND_URL` (and `APP_URL`, used for the Strava OAuth redirect
  target) are single values again — `https://golfcircle.me`.

## Integrations (all optional, independently connectable per user)

Each has its own credentials table and a `GET /<name>/credentials/status`
(or `/strava/status`) endpoint returning `{"connected": bool}`:

- **Strava** — OAuth. Powers "My Rounds" and "World Map" (GPS routes).
- **handicaps.co.za** — scraped via Playwright (`handicap.py`), member
  number + password. Powers Handicap, Leaderboard, Tournaments.
- **Garmin** — `garminconnect` library, email + password. Powers Wellness.
- **Teesheet** — club booking site, scraped via Playwright
  (`teesheet.py`). Powers the Teesheet page.

The frontend gates nav items by which are connected
(`IntegrationsContext.tsx` + `AppNav.tsx`, the single shared nav component
— don't recreate the old pattern of copy-pasting the nav block into every
page). `SettingsPage.tsx` calls `refreshIntegrations()` after saving new
credentials so the nav updates without a reload.

## Architecture constraints worth knowing before changing sync code

- **`supabase-py` is a synchronous client.** Uvicorn here runs on a small
  worker count, so a blocking Supabase call made inline inside an
  `async def` route/function freezes that worker's entire event loop —
  including trivial unrelated requests (confirmed: CORS preflights stalling
  14s during a sync). Any new code path that does a *long chain* of
  sequential Supabase calls (bulk upserts, milestone/leaderboard checks,
  etc.) should follow the pattern already used in `sync_handicap_data`,
  `sync_garmin_data`, `sync_teesheet_data`: do the truly async part (HTTP
  fetch, Playwright) with `await`, then hand the synchronous Supabase-heavy
  tail off to `starlette.concurrency.run_in_threadpool`. A handful of
  individually-fast synchronous calls in a normal read endpoint is fine and
  not worth this treatment.
- **Feed is fan-out-on-read**, not fan-out-on-write. Deliberate — the
  current bottleneck is per-query latency, not the number of feed rows, so
  a denormalized feed table wasn't worth the complexity.
- **`posts.is_system_generated`** — daily-leaderboard and
  tournament-results posts display as "GolfCircle" (icon =
  `favicon.svg`) instead of the triggering user. Milestones and
  tournament-created/joined posts deliberately do NOT use this — the
  achiever/decision-maker is the point of those.
- **`handicap_scores.hidden_from_feed`** — set on all but a new
  connection's 2 most recent rounds during first sync, so connecting an
  account with years of history doesn't spam the Feed. Data still counts
  fully for stats/handicap/leaderboards; only Feed queries filter it out.
- **`handicap_credentials.invalid_since`** — set on a confirmed bad
  password (not other errors), cleared on next successful login. The
  nightly batch skips accounts with this set, to avoid hammering
  handicaps.co.za with known-bad logins.
- **`handicap_sync_state.home_course_id`** — each friend's most-played
  course, computed once per handicap sync (`_compute_home_course_id`) and
  cached rather than re-aggregated from full score history on every
  Friends-page load (that used to be the page's whole load-time cost).

## PWA (`vite-plugin-pwa`)

The app is installable (manifest + generated service worker). The service
worker (`globPatterns` in `vite.config.ts`) only precaches this build's own
static assets — it never touches `api.slogs.co.za`, so nothing about
rounds/friends/feed data is ever served from a cache. Keep it that way; if
someone asks for offline data access later, that needs an explicit,
deliberate runtime-caching rule, not a default. `frontend/public/.htaccess`
no-caches `sw.js`/`manifest.webmanifest` for the same reason it already
no-caches `index.html` — otherwise a long-cached `sw.js` means the PWA's
own update mechanism never runs. Icons live at `frontend/public/icon-*.png`
and `apple-touch-icon.png`, rendered from `favicon.svg` via ImageMagick
(`magick -background ... favicon.svg -resize ...`) — regenerate the same
way if the logo ever changes, and `chmod 644` the output (new files in
`public/` can land at `600` on this machine, which silently breaks them
after cPanel extraction).

## Schema

`supabase.sql` at the repo root is the source of truth for the schema —
there's no migration tool. When adding a column/table, append it there
*and* apply it directly against the production Supabase project (verify
via a column-existence check), since nothing applies this file
automatically.

## Scale

The user has floated rolling this out to ~400k users. Current architecture
(Playwright-scraping handicaps.co.za per user, single small Render
instance) does not support that. Treat 400k as a long-term aspiration to
keep in mind for design choices, not a near-term requirement to build for.
