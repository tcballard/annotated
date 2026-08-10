// Media-pipeline drain: the real bottleneck is transcode, which scales with
// capture rate, not request rate — so it is measured separately from the HTTP
// profiles. Enqueue N video publishes against the API (rotating actors to
// respect the 30/min/actor publish bucket), spawn 1..2 real workers against
// the load database, poll job rows to drained, and emit clips/min per worker
// plus the queue depth at which time-to-ready exceeds the budget.
//
//   BASE_URL=http://127.0.0.1:8788 \
//   LOAD_DATABASE_URL=postgresql://.../annotated_load \
//   LOAD_MEDIA_FIXTURE_URL=https://.../small.mp4 \
//     npm run load:media-drain -- --jobs 30 --workers 2 --kill-one
//
// The fixture must be a small public mp4/m4a: the worker enforces the same
// SSRF rules as production (server/ssrf.js), so loopback and private hosts
// are rejected — by the drain up front, rather than by every job later.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { assertPublicUrl } from '../server/ssrf.js';
import { loadDir, pgSslOption, readConfig, requireBaseUrl, requireLoadDatabaseUrl } from './guards.mjs';

const config = readConfig().mediaDrain;
const args = process.argv.slice(2);
const option = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const jobsWanted = Number(option('--jobs', config.jobs));
const workerCount = Math.min(2, Math.max(1, Number(option('--workers', config.workers))));
const killOne = args.includes('--kill-one');
const timeoutMs = Number(option('--timeout-min', 15)) * 60_000;

const baseUrl = requireBaseUrl();
const databaseUrl = requireLoadDatabaseUrl();
const fixtureUrl = process.env.LOAD_MEDIA_FIXTURE_URL || option('--fixture', '');
if (!fixtureUrl) throw new Error('LOAD_MEDIA_FIXTURE_URL is required: a small public mp4/m4a the worker is allowed to fetch.');
if (killOne && workerCount < 2) throw new Error('--kill-one needs --workers 2: the surviving worker proves lease recovery.');

const { actors } = JSON.parse(readFileSync(path.join(loadDir, 'actors.json'), 'utf8'));
if (!actors?.length) throw new Error('actors.json is empty. Run: npm run load:actors');

const pool = new pg.Pool({ connectionString: databaseUrl, max: 3, ssl: pgSslOption() });
const runId = `drain-${Date.now().toString(36)}`;
const TERMINAL = new Set(['ready', 'failed', 'cancelled', 'superseded', 'dead-letter']);

const spawnWorker = (index) => {
  const child = spawn(process.execPath, ['server/media-worker-main.js'], {
    env: {
      ...process.env,
      ANNOTATED_STORAGE: 'postgres',
      DATABASE_URL: databaseUrl,
      MEDIA_WORKER_ID: `${runId}-w${index}`,
      MEDIA_WORKER_POLL_MS: '2000',
      // Shortened so --kill-one observes lease recovery in one run; the
      // production default is 600000 and 30000 is the worker's floor.
      MEDIA_WORKER_LEASE_MS: String(config.workerLeaseMs || 60_000),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = { id: `${runId}-w${index}`, pid: child.pid, child, exited: null, bootError: '' };
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => { record.bootError += String(chunk).slice(0, 2000); });
  child.on('exit', (code, signal) => { record.exited = { code, signal, at: Date.now() }; });
  return record;
};

const enqueue = async () => {
  await assertPublicUrl(fixtureUrl);
  const jobs = [];
  const perActorTimes = new Map();
  for (let index = 0; index < jobsWanted; index += 1) {
    const actor = actors[index % actors.length];
    // Pace each actor under the 30/min publish bucket. With enough actors
    // this never sleeps; with few it degrades to a legal rate instead of 429s.
    const now = Date.now();
    const recent = (perActorTimes.get(actor.id) || []).filter((at) => now - at < 60_000);
    if (recent.length >= config.publishesPerActorPerMinute) {
      await sleep(60_000 - (now - recent[0]) + 250);
    }
    const unique = `${runId}-${index}`;
    const response = await fetch(`${baseUrl}/api/annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${actor.token}` },
      body: JSON.stringify({
        sourceUrl: `https://example.com/load-videos/${unique}`,
        sourceType: 'video',
        sourceTitle: `Drain clip ${unique}`,
        mediaUrl: fixtureUrl,
        clipStart: 0,
        clipEnd: config.clipSeconds,
        commentaryMode: 'text',
        commentary: `Media drain ${unique}.`,
        clientRequestId: unique,
        visibility: 'unlisted',
      }),
    });
    if (response.status !== 201 && response.status !== 200) {
      throw new Error(`Publish ${index} failed: ${response.status} ${await response.text()}`);
    }
    const { annotation } = await response.json();
    perActorTimes.set(actor.id, [...(perActorTimes.get(actor.id) || []), Date.now()]);
    const depth = await pool.query("SELECT count(*)::int AS depth FROM annotated_media_jobs WHERE status IN ('queued','processing')");
    jobs.push({ annotationId: annotation.id, enqueuedAt: Date.now(), queueDepthAtEnqueue: depth.rows[0].depth, status: 'queued', workerIds: [], attempts: 0, leaseRecovered: false, readyAt: null, terminalAt: null, failureClass: null });
  }
  return jobs;
};

const pollOnce = async (jobs, previous) => {
  const ids = jobs.map((job) => job.annotationId);
  const { rows } = await pool.query(
    'SELECT annotation_id, status, worker_id, attempts, lease_until, failure_class FROM annotated_media_jobs WHERE annotation_id = ANY($1)',
    [ids],
  );
  const doubleClaims = [];
  for (const row of rows) {
    const job = jobs.find((item) => item.annotationId === row.annotation_id);
    if (!job) continue;
    const before = previous.get(row.annotation_id);
    if (row.worker_id && !job.workerIds.includes(row.worker_id)) {
      // A second worker on the same job is legal only after a lease expired
      // or a retry bumped attempts — anything else is a double claim.
      if (job.workerIds.length > 0) {
        const leaseExpired = before?.lease_until && new Date(before.lease_until).getTime() <= Date.now();
        const retried = Number(row.attempts) > Number(before?.attempts ?? 0);
        if (leaseExpired || retried) job.leaseRecovered = true;
        else doubleClaims.push({ annotationId: row.annotation_id, workers: [...job.workerIds, row.worker_id] });
      }
      job.workerIds.push(row.worker_id);
    }
    job.attempts = Number(row.attempts);
    if (row.status === 'ready' && !job.readyAt) job.readyAt = Date.now();
    if (TERMINAL.has(row.status) && !job.terminalAt) { job.terminalAt = Date.now(); job.failureClass = row.failure_class || null; }
    job.status = row.status;
    previous.set(row.annotation_id, row);
  }
  return doubleClaims;
};

const run = async () => {
  console.log(`Enqueueing ${jobsWanted} video publishes (${actors.length} actors, fixture ${new URL(fixtureUrl).host})...`);
  const enqueueStarted = Date.now();
  const jobs = await enqueue();
  console.log(`Enqueued in ${((Date.now() - enqueueStarted) / 1000).toFixed(1)}s. Spawning ${workerCount} worker(s)...`);

  const workers = Array.from({ length: workerCount }, (_, index) => spawnWorker(index + 1));
  const drainStarted = Date.now();
  const previous = new Map();
  const allDoubleClaims = [];
  let killed = null;

  while (Date.now() - drainStarted < timeoutMs) {
    await sleep(config.pollMs);
    allDoubleClaims.push(...await pollOnce(jobs, previous));
    const terminal = jobs.filter((job) => job.terminalAt).length;
    const bootFailures = workers.filter((worker) => worker.exited && !killed?.ids?.includes(worker.id));
    if (bootFailures.length === workers.length && terminal === 0) {
      throw new Error(`Every worker exited before draining anything. First stderr: ${bootFailures[0].bootError || '(empty)'}`);
    }
    if (killOne && !killed && terminal + jobs.filter((job) => job.status === 'processing').length >= Math.ceil(jobsWanted / 3)) {
      // Kill only while the victim holds in-flight work — otherwise there is
      // no lease for the survivor to recover and the check proves nothing.
      const victim = workers.find((worker) => !worker.exited && jobs.some((job) => job.status === 'processing' && job.workerIds.at(-1) === worker.id));
      if (victim) {
        victim.child.kill('SIGKILL');
        // Everything the victim held is orphaned at this instant. A dead
        // worker cannot finish a job, so any of these reaching a terminal
        // state later IS a lease recovery — robust at any poll interval,
        // even when the reclaim and the finish fit inside one poll gap
        // (the completion path clears worker_id, so transient claims are
        // not reliably observable).
        const orphaned = jobs.filter((job) => job.status === 'processing' && job.workerIds.at(-1) === victim.id).map((job) => job.annotationId);
        killed = { ids: [victim.id], at: Date.now(), orphaned };
        console.log(`Killed ${victim.id} mid-drain holding ${orphaned.length} job(s); the survivor must reclaim after lease expiry (${config.workerLeaseMs || 60_000}ms).`);
      }
    }
    process.stdout.write(`\rdrained ${terminal}/${jobsWanted} (ready ${jobs.filter((job) => job.status === 'ready').length}, dead-letter ${jobs.filter((job) => job.status === 'dead-letter').length})   `);
    if (terminal === jobsWanted) break;
  }
  console.log('');
  for (const worker of workers) if (!worker.exited) worker.child.kill('SIGTERM');
  await sleep(500);

  const drainMinutes = (Date.now() - drainStarted) / 60_000;
  const ready = jobs.filter((job) => job.readyAt);
  const ttrSeries = ready.map((job) => ({ queueDepthAtEnqueue: job.queueDepthAtEnqueue, timeToReadySec: (job.readyAt - job.enqueuedAt) / 1000 })).sort((a, b) => a.queueDepthAtEnqueue - b.queueDepthAtEnqueue);
  const overBudget = ttrSeries.find((point) => point.timeToReadySec > config.timeToReadyBudgetSec);
  const summary = {
    runId,
    generatedAt: new Date().toISOString(),
    baseHost: new URL(baseUrl).host,
    fixtureHost: new URL(fixtureUrl).host,
    jobs: jobsWanted,
    workers: workerCount,
    killOne: Boolean(killed),
    drainMinutes: Number(drainMinutes.toFixed(2)),
    readyCount: ready.length,
    statusCounts: Object.fromEntries([...new Set(jobs.map((job) => job.status))].map((status) => [status, jobs.filter((job) => job.status === status).length])),
    failureClasses: Object.fromEntries([...new Set(jobs.map((job) => job.failureClass).filter(Boolean))].map((cls) => [cls, jobs.filter((job) => job.failureClass === cls).length])),
    clipsPerMinPerWorker: ready.length ? Number((ready.length / drainMinutes / workerCount).toFixed(2)) : 0,
    timeToReadyBudgetSec: config.timeToReadyBudgetSec,
    queueDepthWhereTtrExceedsBudget: overBudget ? overBudget.queueDepthAtEnqueue : null,
    ttrSeries,
    doubleClaims: allDoubleClaims,
    leaseRecoveries: killed
      ? jobs.filter((job) => killed.orphaned.includes(job.annotationId) && job.terminalAt && job.terminalAt > killed.at).length
      : jobs.filter((job) => job.leaseRecovered).length,
    orphanedAtKill: killed ? killed.orphaned.length : null,
    workerExits: workers.map((worker) => ({ id: worker.id, exited: worker.exited })),
  };
  mkdirSync(path.join(loadDir, 'out'), { recursive: true });
  const outPath = path.join(loadDir, 'out', `${new Date().toISOString().slice(0, 10)}-drain.json`);
  writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`clips/min/worker: ${summary.clipsPerMinPerWorker} · ready ${ready.length}/${jobsWanted} · double claims: ${allDoubleClaims.length} · lease recoveries: ${summary.leaseRecoveries}`);
  console.log(`Drain summary -> ${outPath}`);
  if (allDoubleClaims.length) {
    console.error('DOUBLE CLAIMS DETECTED — SKIP LOCKED leasing is not holding. This is a product bug, not a harness artefact.');
    process.exitCode = 1;
  }
};

run().then(() => pool.end()).catch(async (error) => {
  console.error(error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
