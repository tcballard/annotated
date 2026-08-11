# Launch readiness — absorbing an audience-scale burst

The scenario this document exists for: a launch to an audience of millions,
converting to a first-week burst of up to ~100k users, then settling down.
At the standard model (10% peak concurrency × 5 requests/min per active
user) that is **~800 req/s sustained at peak, with viral moments at
1,500–2,500 req/s**. The demonstrated baseline is 300 req/s sustained and a
600 req/s burst on one instance (see `docs/load-reports/`); everything
between that baseline and the burst estimate is provisioning and rehearsal,
not engineering. This is the checklist.

## 1. Put a CDN in front (config, not code)

What the origin already does so the edge can carry the launch:

| Surface | Behaviour | Edge effect |
| --- | --- | --- |
| Clip/audio media | `302` to a signed URL, or to `S3_PUBLIC_BASE_URL` when set | Set `S3_PUBLIC_BASE_URL` to a CDN domain in front of the bucket — the heaviest bytes never touch Node |
| Public permalink HTML | `public, max-age=0, s-maxage=60, stale-while-revalidate=300` | A shared-link stampede lands on the CDN; unlisted/private stay `no-store` — visibility-gated pages are never edge-cacheable |
| OG share cards | ETag + `s-maxage=86400, stale-while-revalidate` | Every social scrape after the first is an edge hit |
| Hashed `/assets/*` | `public, max-age=31536000, immutable` | The app shell's JS/CSS downloads once per user, ever |
| Embed pages | `public, max-age=300` | Publisher embeds revalidate gently |
| Anonymous `/api/feed` | Origin-side 1-second micro-TTL cache (`x-cache` header) | The API defends itself even where the CDN passes through |

Setup: point the CDN at the origin with "respect origin headers" semantics,
no override rules needed. Verify with `curl -sI` on each row above.

## 2. Find the ceiling, size the fleet

1. Deploy the disposable environment (`load/RUNBOOK.md`) on the exact
   instance size production will use, with a **separate load box** — the
   sandbox soak proved that a co-tenant load generator manufactures phantom
   latency tails.
2. Run `npm run load:ramp` and take the per-instance ceiling **X** with its
   named cause from the report.
3. Fleet size = `ceil(peak_estimate / X) + 1`. For a 2,500 req/s worst
   minute and, say, X = 800: four instances. The API is share-nothing
   (cross-instance cache invalidation over LISTEN/NOTIFY, a
   database-backed limiter, migrate-before-serve deploys) — but rehearse
   N ≥ 2 once in the disposable environment before launch day; never
   discover multi-instance behaviour in production.
4. Run the soak twice on different days. Publish both reports to
   `docs/load-reports/`.

## 3. Crowd-mode rate limits

Per-IP limits that are correct for one reader are wrong for ten thousand
people behind one carrier NAT. The anonymous per-IP actions accept env
overrides, bounded so a typo cannot disable the limiter (cap 100,000/min):

```bash
RATE_LIMIT_OPEN_ORIGINAL=2400     # default 120/min per IP
RATE_LIMIT_ANNOTATION_EMBED=2400  # default 120
RATE_LIMIT_ANNOTATION_QR=1200     # default 120
```

Set these for launch week; unset to return to defaults. Authenticated
per-actor limits (publish 30/min, like 120/min) are per-person, not
per-crowd — leave them alone.

## 4. Size the boring things

- **Postgres connections**: each API instance holds up to `PG_POOL_MAX`
  (default 10) + 4 limiter connections + 1 listener. Fleet × ~15 must fit
  inside `max_connections` with margin for workers and psql. Four instances
  ≈ 60 connections — fine on any managed plan; check anyway.
- **Postgres plan**: one size up for launch week costs little and buys
  shared-buffer headroom; scale back down with the traffic.
- **Workers**: throughput is ~4.8 clips/min per worker (measured, small
  fixture). A signup wave publishing 1,000 clips/hour wants ~4 workers;
  `FOR UPDATE SKIP LOCKED` makes the fleet a slider — add processes, no
  coordination. Watch `queued` depth and `pickupP95Ms` via
  `/api/operator/metrics`.

## 5. Day-of monitoring (all already built)

- `/api/operator/metrics` (bearer `OPERATOR_METRICS_TOKEN`): media queue
  depth, pickup p95, failure classes.
- `x-cache` hit ratio on anonymous feed responses in the access log — a
  falling hit ratio under load means the CDN or the micro-TTL cache is
  misconfigured.
- 429 counts by action: a spike on `open-original` from few IPs is carrier
  NAT — raise the crowd override; a spike on `annotation`/`like` per-actor
  is abuse behaving as designed.
- Structured pool errors (`PostgreSQL pool error`) in logs: transient
  blips recover without restarts (the process survives database outages);
  a sustained stream means the database itself is sick.

## 6. What deliberately does NOT change for launch

No rewrite, no new datastore, no architecture change. The Rust gate
(docs/PERFORMANCE.md) fires on deployed traces showing Node as the
constraint — a launch burst served from edge caches and N small instances
does not approach it. Scale the fleet down when the week is over; the
steady state after drop-off lands back inside the proven baseline.
