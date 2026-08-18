// The media worker as its own service: an atomic PostgreSQL lease queue polled
// here so transcode CPU never shares a core with request latency. The lease
// semantics (workerId + leaseUntil + SKIP LOCKED) make multiple workers safe —
// run as many as the queue depth earns.
//
// This process boundary is also the language seam: everything the worker
// owns is orchestration around ffmpeg and yt-dlp behind a queue protocol.
// If profiling ever demands it, this one component can be rewritten (in
// Rust, say) against the same claims and leases without the API noticing.
//
// Run: MEDIA_WORKER_CONCURRENCY=4 node server/media-worker-main.js
import { checkStore, closeStore } from './store.js';

process.env.ANNOTATED_PROCESS_ROLE = 'media-worker';
const {
  checkMediaRuntime,
  mediaWorkerExecution,
  mediaWorkerId,
  mediaWorkerRetryPolicy,
  recoverMediaJobs,
} = await import('./media-worker.js');
const { resolveS3MaxAttempts } = await import('./object-store.js');
const { mediaQueueSnapshot } = await import('./media-job-repository.js');

const intervalMs = Number(process.env.MEDIA_WORKER_POLL_MS || 2_000);
if (!Number.isSafeInteger(intervalMs) || intervalMs < 2_000) throw new Error('MEDIA_WORKER_POLL_MS must be an integer of at least 2000.');

await checkStore(); // refuses a stale schema, exactly like the API's readiness gate
const runtime = await checkMediaRuntime();
console.log(JSON.stringify({
  event: 'media_worker_started',
  workerId: mediaWorkerId,
  intervalMs,
  concurrency: mediaWorkerExecution.concurrency,
  mediaJobMaxAttempts: mediaWorkerRetryPolicy.maxAttempts,
  s3MaxAttempts: resolveS3MaxAttempts(),
  runtime: runtime.status || 'ok',
}));

let polling = false;
const poll = async () => {
  if (polling) return;
  polling = true;
  try {
    await recoverMediaJobs();
    console.log(JSON.stringify({ event: 'media_worker_heartbeat', workerId: mediaWorkerId, queue: await mediaQueueSnapshot() }));
  } finally {
    polling = false;
  }
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
