# Performance testing: results, limits, and the path to scale

This document uses Simplified Technical English. Sentences are short. Each
sentence gives one fact. All numbers come from tests that you can run again.

**Where we measured.** We measured on one shared computer. The load
generator, the API, and the database used the same computer. Loopback
networking connected them. These numbers are development evidence. They are
not deployment evidence. The procedure in [`load/RUNBOOK.md`](../load/RUNBOOK.md)
makes deployment evidence: use a separate load computer, run the test twice,
on two different days.

**The test computer.** Record the same facts for every future test bench.

| Component | Value |
| --- | --- |
| CPU | Intel Xeon at 2.10 GHz, 4 virtual cores |
| Virtualization | Yes. The hypervisor flag is present. Neighbor load can change results |
| Memory | 15.7 GiB |
| Kernel | Linux 6.18.5, x86_64 |
| Node.js | v22.22.2 |
| PostgreSQL | 16.13, same host, default configuration |
| Load generator | k6 v0.57.0, same host |
| Network | Loopback only. No real network path |

One API process served every test. The four cores carried the API, the
database, and the load generator together. A production instance does not
share its cores with a load generator. For deployment numbers, record the
provider, the instance type, the vCPU count, the memory, and the PostgreSQL
plan in the run report; `load/report.mjs` has the environment field for this
purpose.

## 1. The tests we did

| Test | Tool | What it proves |
| --- | --- | --- |
| Database regression budgets | `npm run load:relational` | Query latency stays inside budgets at 100,000 annotations and 1,000,000 interactions |
| HTTP smoke and soak profiles | `load/k6-annotated.js` | The full traffic mix runs at a controlled request rate with thresholds |
| Rate ladder, 300–2,500 req/s | k6 arrival-rate probes | The read path holds each launch-scenario rate |
| Ceiling hunt with CPU attribution | k6 + per-process sampling | Where the server breaks, and the component that breaks first |
| Media drain | `load/media-drain.mjs` | Transcode throughput, no double claims, lease recovery after a worker dies |
| Outage recovery | `test/outage-recovery.test.js` + live fire | The process survives a database outage and recovers without a restart |
| Mutation ladder | k6 probes, 600 minted actors | Likes and publishes hold launch-scale write rates inside the publish budget |
| Web vitals budgets | `test/web-vitals.test.js` | The home page and the permalink page render inside LCP and CLS budgets |
| Degraded backend | `test/degraded-backend.test.js` | A slow API does not block rendering; a dead API gives an honest page |

## 2. The results

All results are from the 100,000-annotation corpus unless the row says a
different corpus.

| Measure | Result |
| --- | --- |
| Database budget, worst case | 2.57 ms at p95, against a 100 ms budget |
| One cold feed page, no cache | 5–6 ms; the same cost as at 2,000 annotations |
| One signed-in feed page | 5–9 ms; the cache does not serve signed-in readers |
| One cached feed page | 0.4 ms |
| 300 req/s, full mix, 2 minutes | 0.6 ms median; 142 ms p95; zero server errors |
| 800 req/s, read path | 0.4 ms median; 9 ms p95; zero failures |
| 1,500 req/s, read path | 0.4 ms median; 1 ms p95; zero failures |
| 2,500 req/s, read path | 0.4 ms median; 2 ms p95; zero failures |
| Likes, 400 per second, 600 actors | 6 ms median; 18 ms p95; zero 429; zero server errors |
| Publishes, 600 per second, 2,400 actors | 4.6 ms median; 18 ms p95; zero 429; zero server errors |
| Media drain, two workers | 4.8 clips per minute per worker; zero double claims; 2 of 2 leases recovered |
| Web vitals, home and permalink | LCP under 100 ms; CLS 0.000 |

## 3. The limits

| Path | Limit | Cause |
| --- | --- | --- |
| Anonymous reads, one instance | Holds 2,500 req/s. Breaks between 3,000 and 4,000 req/s | The Node event loop saturates. One cached response costs about 0.35 ms of JavaScript time. The database stays idle |
| Signed-in reads, one instance | Holds 600 req/s. We did not find the break point | Most of the cost is parallel database wait, not JavaScript time |
| Mutations, one instance | Likes hold 400/s; break not found. Publishes hold 600/s; the path breaks between 600 and 1,000/s, near 850/s | The write path is row-native. At 600 publishes/s the p95 is 18 ms, against a 300 ms budget |
| PostgreSQL | Not reached | The worst query uses 3% of its budget at full corpus |
| Media pipeline | Linear with capture rate | Transcode uses CPU. Add worker processes to add throughput |

Two limits came from the test environment, not from the product. The
14-minute soak failed its p95 thresholds. The evidence points to the load
generator, which shared the CPU cores with the server. The break point
between 3,000 and 4,000 req/s is also blurred by this sharing. A separate
load computer removes both distortions.

## 4. The defects the tests found, now corrected

1. The database re-planned the feed query on every request. Cost: 2.6 ms per
   request. Correction: named prepared statements. One exception: the search
   query keeps its custom plan, because a generic plan made its p95 worse
   than 2 seconds.
2. A cached rejection made a database outage permanent. The API served the
   first connection error until a restart. Correction: the readiness probes
   clear on failure and retry.
3. A clean database restart stopped the process. An unhandled pool error
   event ended Node. Correction: both pools log the error and continue.
4. Every anonymous request paid the full page cost. Correction: a one-second
   cache for signed-out feed pages. This moved the ceiling from about 150
   req/s to about 2,500 req/s on one instance.

## 5. What is necessary to scale

For the first 10,000 users: nothing. The measured capacity is more than
three times the expected peak of about 90 req/s.

For a launch burst near 100,000 users (peak estimate 800 req/s, worst minute
2,500 req/s), do the steps in [`LAUNCH.md`](LAUNCH.md):

1. Put a CDN in front of the origin. The origin already sends the correct
   cache headers. Media already redirects to object storage.
2. Measure the per-instance ceiling with `npm run load:ramp` on deployment
   hardware. Set the fleet size: divide the peak estimate by the ceiling,
   round up, add one.
3. Set the crowd-mode rate limits for the per-IP actions. Carrier NAT puts
   many readers behind one address.
4. Confirm the PostgreSQL connection count: instances × 15 must fit inside
   `max_connections`.
5. Add media workers to match the capture rate. The queue makes more workers
   safe without coordination.
6. Run the soak and the ramp in a disposable environment, twice, on two
   different days. Publish the reports to `docs/load-reports/`.

A rewrite is not on this list. The rule in
[`PERFORMANCE.md`](PERFORMANCE.md) stands: implement the API in Rust only
when deployed traces show that Node is the next constraint, at a rate the
product needs. The measured Node ceiling is about 2,500 req/s per instance
for cached reads. A launch fleet of two or three instances, behind a CDN,
covers the worst minute of the 100,000-user scenario with margin.

## 6. What we did not measure

- Deployment hardware, a real network path, and CDN behavior.
- Likes above 400 per second.
- More than one API instance under load at the same time.
- Real provider media (YouTube, podcasts) under transcode load.
- Signed-in rates above 600 req/s.

Each item has a procedure in the runbooks. None of them blocks the current
release.
