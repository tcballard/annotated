// The media worker as its own service: the same leased queue the API can
// drive in-process, polled here on an interval so transcode CPU never
// shares a core with request latency. The lease semantics (workerId +
// leaseUntil, claims under the store) already make multiple workers safe —
// run as many as the queue depth earns.
//
// This process boundary is also the language seam: everything the worker
// owns is orchestration around ffmpeg and yt-dlp behind a queue protocol.
// If profiling ever demands it, this one component can be rewritten (in
// Rust, say) against the same claims and leases without the API noticing.
//
// Run: MEDIA_WORKER_CONCURRENCY=4 node server/media-worker-main.js
import { checkMediaRuntime, recoverMediaJobs } from './media-worker.js';
import { checkStore, closeStore, invalidateReadCache } from './store.js';

const intervalMs = Math.max(2_000, Number(process.env.MEDIA_WORKER_POLL_MS || 15_000));

await checkStore(); // refuses a stale schema, exactly like the API's readiness gate
const runtime = await checkMediaRuntime();
console.log(JSON.stringify({ event: 'media_worker_started', intervalMs, runtime: runtime.status || 'ok' }));

const poll = async () => {
  // Jobs are enqueued by the API process; without this, our read cache
  // would never learn they exist. LISTEN/NOTIFY also drops it on writes —
  // this is the belt to that suspender for missed notifications.
  invalidateReadCache();
  await recoverMediaJobs();
};

await poll();
const timer = setInterval(() => { poll().catch((error) => console.error('media worker poll failed:', error.message)); }, intervalMs);

const stop = async () => {
  clearInterval(timer);
  await closeStore().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
