# Load-test runbook

A repeatable procedure for producing comparable, publishable load evidence.
The harness lives in `load/`; committed reports live in `docs/load-reports/`.
Budgets live in `docs/PERFORMANCE.md` — when a budget changes, it changes
there first and the harness inherits it.

## The two environments

**Local (docker-compose or bare processes) is for developing the harness
only.** Loopback numbers are never published — the evidence discipline in
`docs/RELEASE.md` forbids mislabelled loopback timings, and `load/report.mjs`
stamps any loopback run `LOCAL DEVELOPMENT — not publishable evidence`.

**Publishable runs use a disposable environment:**

1. Deploy the archived evidence-bearing production image to a fresh Railway
   environment (or equivalent) with its **own** PostgreSQL and object store.
   Never attach the canonical staging database. Every harness entry point
   hard-refuses `annotated-staging.up.railway.app`.
2. Set `PUBLIC_ORIGIN` (and `APP_ORIGIN`) to the disposable environment's own
   URL — `/api/oembed` only embeds its own origin, so a mismatched
   `PUBLIC_ORIGIN` turns the oembed slice of the mix into 400s.
3. The production image boots with `AUTH_REQUIRED=true` (NODE_ENV is
   production), which requires `APP_ORIGIN` plus `X_CLIENT_ID`,
   `X_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` to be
   **present** (`assertAuthConfiguration` checks presence, not validity).
   Placeholder values are fine: the harness never exercises OAuth consent —
   sessions are minted directly in the database with the real token
   semantics.
4. Seed the corpus:
   `LOAD_DATABASE_URL=... ALLOW_DESTRUCTIVE_LOAD=true PGSSL=disable npm run load:relational`
   (the k6 setup phase fails fast when the feed exposes fewer than 10
   annotations).
5. Enable and reset query stats before each run:
   `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` then
   `SELECT pg_stat_statements_reset();`
6. Record platform CPU/memory for the run (provider dashboard screenshots or
   metrics export) — a ceiling without saturation data cannot be attributed.
7. Run the profile (below), render the report, commit it.
8. Tear the environment down.
9. **Repeat the soak on a different day before publishing.** One run on
   shared CPU is an anecdote; two runs that agree are evidence.

## Commands

```bash
# 1. Mint actors (users + bearer sessions, exact server token semantics)
LOAD_DATABASE_URL=postgresql://.../annotated_load npm run load:actors

# 2. HTTP profiles (k6 must be on PATH — https://k6.io/docs/get-started/installation/)
BASE_URL=https://<disposable-host> npm run load:smoke
BASE_URL=https://<disposable-host> npm run load:soak
BASE_URL=https://<disposable-host> npm run load:ramp

# 3. Media drain (transcode throughput, measured separately)
BASE_URL=... LOAD_DATABASE_URL=... LOAD_MEDIA_FIXTURE_URL=https://<public-small-mp4> \
  npm run load:media-drain -- --jobs 30 --workers 2 --kill-one

# 4. Render the committed report
npm run load:report -- --k6 load/out/<date>-<profile>.summary.json \
  --drain load/out/<date>-drain.json \
  --environment "Railway disposable, <plan>" \
  --cause "<named ceiling cause — ramp runs only>"
```

## What the profiles mean

- **smoke** — 2 minutes, ≤10 req/s. Proves harness, actors, corpus, and
  thresholds wire up. Run it first, always.
- **soak** — 30 req/s warm-up (discarded via the `warm` scenario tag), then
  300 req/s for 10 minutes pass/fail, then a 600 req/s two-minute burst.
  Graceful-degradation bar: p95 under 500ms, zero 5xx. 429s are not failures;
  they are the limiter working.
- **ramp** — climbs to 3,000 req/s until something breaks. The deliverable is
  the ceiling **and its named cause**: pg_stat_statements top query, Node
  event-loop saturation, pool exhaustion, or platform CPU. The report stays
  marked UNATTRIBUTED until `--cause` is supplied.

## Traffic-mix rationale

70% feed (keyset walks to random depth 1–8), 15% permalink + oembed, 8%
search, 5% likes, 2% article publishes. Mutations use distinct minted actors
because the limiter buckets per `(ip, actor, action)` — anonymous mutation
load from one box shares one bucket and 429s within seconds, measuring the
limiter instead of the product. `/api/annotations/:id/open` is per-IP **by
design** (public counter, `actor: null`, 120/min): it is excluded from
throughput scenarios, and a 429 from it is correct limiter behaviour, never
an API failure. Source-metadata resolution (`/api/sources/...`) is excluded
entirely: it fetches third-party origins, and load-testing other people's
servers is not evidence, it is abuse.

## Answers to the open questions (verified against code)

1. **Operator metrics gating.** `GET /api/operator/metrics` requires
   `OPERATOR_METRICS_TOKEN` (≥24 chars) via `Authorization: Bearer`, compared
   timing-safe; anything else gets a 404 (`operatorMetricsAllowed`,
   `server/index.js`). The drain script therefore polls
   `annotated_media_jobs` directly over `LOAD_DATABASE_URL` — no operator
   token needed in the load environment. Set the token and poll the endpoint
   instead if the database is not reachable from the load box.
2. **Booting the disposable environment.** With `AUTH_REQUIRED` unset and
   `NODE_ENV` not production, `assertAuthConfiguration` returns early —
   provider env vars are not required at all. In the production image
   (`NODE_ENV=production`), `AUTH_REQUIRED` is forced true and boot requires
   `APP_ORIGIN` + client id/secret for every enabled provider to be present;
   placeholder values satisfy the presence check (see step 3 above).
3. **Publish status and seeder columns.** `POST /api/annotations` returns
   **201** on create and **200** on idempotent replay (same
   `clientRequestId`). `annotated_users` NOT NULL columns without defaults
   are exactly `id`, `handle`, `display_name`; the seeder also sets `bio`
   (defaulted) and `is_demo = true` so load actors can never inflate real
   totals.

## Sandbox / CI notes

- Nothing here runs in CI, deliberately. The DB regression suite
  (`npm run load:relational`) already gates database budgets; HTTP load runs
  are operator-driven.
- The k6 binary is external (no npm dependency). `load/actors.json` holds
  live bearer tokens and is gitignored; treat it like a credential file.
- The media worker enforces production SSRF rules (`server/ssrf.js`):
  loopback/private fixture URLs are rejected. Local drain development needs a
  small **public** mp4 (`LOAD_MEDIA_FIXTURE_URL`); in an egress-restricted
  sandbox the drain still proves enqueue pacing, SKIP LOCKED claim integrity,
  kill/lease recovery, and honest failure states (`failed`/`dead-letter`) —
  clips/min needs the disposable environment.
