import { randomUUID } from 'node:crypto';
import { queryDatabase, readStore, storageDescription, transactDatabase, updateStore } from './store.js';
import { mapAnnotation, mapMedia, writeLegacy } from './product-repository.js';

const queryNative = storageDescription() === 'postgres' && process.env.ANNOTATED_RELATIONAL_READS !== 'legacy';
const iso = (value) => value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : null;
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const mapMediaJob = (row) => row ? {
  id: row.id,
  annotationId: row.annotation_id,
  ownerId: row.owner_id,
  sourceUrl: row.source_url,
  sourceMediaUrl: row.media_url,
  mediaUrl: row.media_url,
  provider: row.provider,
  sourceType: row.source_type,
  clipStart: number(row.clip_start),
  clipEnd: number(row.clip_end),
  status: row.status,
  attempts: number(row.attempts),
  workerId: row.worker_id,
  traceId: row.trace_id,
  leaseUntil: iso(row.lease_until),
  retryAt: iso(row.retry_at),
  startedAt: iso(row.started_at),
  completedAt: iso(row.completed_at),
  error: row.error,
  failureClass: row.failure_class,
  isDemo: row.is_demo === true,
  createdAt: iso(row.created_at),
} : null;

const legacyJob = (job) => ({
  id: job.id,
  annotationId: job.annotationId,
  ownerId: job.ownerId || null,
  sourceUrl: job.sourceUrl,
  sourceMediaUrl: job.sourceMediaUrl || job.mediaUrl || '',
  mediaUrl: job.mediaUrl || job.sourceMediaUrl || '',
  provider: job.provider || null,
  sourceType: job.sourceType,
  clipStart: number(job.clipStart),
  clipEnd: number(job.clipEnd),
  status: job.status,
  attempts: number(job.attempts),
  workerId: job.workerId || null,
  traceId: job.traceId || job.id,
  leaseUntil: job.leaseUntil || null,
  retryAt: job.retryAt || null,
  startedAt: job.startedAt || null,
  completedAt: job.completedAt || null,
  error: job.error || null,
  failureClass: job.failureClass || null,
  createdAt: job.createdAt,
});

export const atomicClaimSql = `WITH candidate AS (
  SELECT job.id FROM annotated_media_jobs job
  JOIN annotated_annotations annotation ON annotation.id=job.annotation_id
  WHERE job.attempts < $4
    AND annotation.status='published' AND annotation.media_status<>'cancelled'
    AND ($1::text IS NULL OR job.id=$1)
    AND (
      (job.status='queued' AND coalesce(job.retry_at,job.created_at)<=now())
      OR (job.status='processing' AND (job.lease_until IS NULL OR job.lease_until<=now()))
    )
  ORDER BY coalesce(job.retry_at,job.created_at),job.created_at,job.id
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE annotated_media_jobs job
SET status='processing',worker_id=$2,lease_until=now()+($3::bigint*interval '1 millisecond'),
    started_at=coalesce(job.started_at,now()),updated_at=now()
FROM candidate WHERE job.id=candidate.id RETURNING job.*`;

export async function enqueueMediaRecord(input, { id = randomUUID(), traceId = randomUUID(), createdAt = new Date().toISOString() } = {}) {
  const job = legacyJob({ id, ...input, ownerId: input.ownerId || null, traceId, attempts: 0, status: 'queued', createdAt });
  if (!queryNative) {
    await updateStore((store) => ({
      ...store,
      mediaJobs: [...(store.mediaJobs || []), job],
      annotations: store.annotations.map((annotation) => annotation.id === input.annotationId ? { ...annotation, mediaStatus: 'queued', mediaError: null } : annotation),
    }));
    return job;
  }
  await transactDatabase(async (client) => {
    const selected = await client.query('SELECT * FROM annotated_annotations WHERE id=$1 FOR UPDATE', [input.annotationId]);
    if (!selected.rows[0]) throw new Error('Cannot enqueue media for a missing annotation.');
    const annotation = mapAnnotation(selected.rows[0]);
    job.ownerId ||= annotation.authorId;
    await writeLegacy(client, 'mediaJobs', job.id, job);
    await writeLegacy(client, 'annotations', annotation.id, { ...annotation, mediaStatus: 'queued', mediaError: null });
  });
  return job;
}

export async function claimMediaRecord({ jobId = null, workerId, leaseMs, maxAttempts }) {
  if (!queryNative) {
    let claimed = null;
    await updateStore((store) => {
      const now = Date.now();
      const candidate = (store.mediaJobs || []).filter((job) => (!jobId || job.id === jobId)
        && number(job.attempts) < maxAttempts
        && ((job.status === 'queued' && (!job.retryAt || Date.parse(job.retryAt) <= now)) || (job.status === 'processing' && (!job.leaseUntil || Date.parse(job.leaseUntil) <= now))))
        .sort((a, b) => String(a.retryAt || a.createdAt).localeCompare(String(b.retryAt || b.createdAt)) || a.id.localeCompare(b.id))[0];
      if (!candidate) return store;
      claimed = { ...candidate, status: 'processing', workerId, leaseUntil: new Date(now + leaseMs).toISOString(), startedAt: candidate.startedAt || new Date(now).toISOString() };
      return { ...store, mediaJobs: store.mediaJobs.map((job) => job.id === candidate.id ? claimed : job), annotations: store.annotations.map((annotation) => annotation.id === candidate.annotationId ? { ...annotation, mediaStatus: 'processing', mediaError: null } : annotation) };
    });
    return claimed;
  }
  return transactDatabase(async (client) => {
    const result = await client.query(atomicClaimSql, [jobId, workerId, leaseMs, maxAttempts]);
    if (!result.rows[0]) return null;
    const job = mapMediaJob(result.rows[0]);
    await writeLegacy(client, 'mediaJobs', job.id, job);
    const selected = await client.query('SELECT * FROM annotated_annotations WHERE id=$1 FOR UPDATE', [job.annotationId]);
    if (!selected.rows[0]) throw new Error('Claimed media job has no annotation.');
    const annotation = mapAnnotation(selected.rows[0]);
    if (annotation.status !== 'published' || annotation.mediaStatus === 'cancelled') return null;
    await writeLegacy(client, 'annotations', annotation.id, { ...annotation, mediaStatus: 'processing', mediaError: null });
    return job;
  });
}

export async function recoverableMediaJobIds(limit = 100) {
  if (!queryNative) {
    const now = Date.now();
    return ((await readStore()).mediaJobs || []).filter((job) => (job.status === 'queued' && (!job.retryAt || Date.parse(job.retryAt) <= now)) || (job.status === 'processing' && (!job.leaseUntil || Date.parse(job.leaseUntil) <= now))).slice(0, limit).map((job) => job.id);
  }
  const result = await queryDatabase(
    `SELECT job.id FROM annotated_media_jobs job JOIN annotated_annotations annotation ON annotation.id=job.annotation_id
     WHERE annotation.status='published' AND annotation.media_status<>'cancelled' AND (
       (job.status='queued' AND coalesce(job.retry_at,job.created_at)<=now()) OR
       (job.status='processing' AND (job.lease_until IS NULL OR job.lease_until<=now())))
     ORDER BY coalesce(job.retry_at,job.created_at),job.created_at,job.id LIMIT $1`,
    [Math.min(500, Math.max(1, number(limit, 100)))],
  );
  return result.rows.map((row) => row.id);
}

export async function mediaJobCancelled(jobId) {
  if (!queryNative) return ((await readStore()).mediaJobs || []).some((item) => item.id === jobId && item.status === 'cancelled');
  const result = await queryDatabase("SELECT EXISTS(SELECT 1 FROM annotated_media_jobs WHERE id=$1 AND status='cancelled') cancelled", [jobId]);
  return result.rows[0]?.cancelled === true;
}

export async function completeMediaRecord(job, { asset, poster = null }) {
  if (!queryNative) {
    let published = false;
    await updateStore((store) => {
      const current = (store.mediaJobs || []).find((item) => item.id === job.id);
      if (!current || current.status === 'cancelled' || current.workerId !== job.workerId) return store;
      published = true;
      return {
        ...store,
        media: [...(store.media || []), asset, ...(poster ? [poster] : [])],
        annotations: store.annotations.map((annotation) => annotation.id === job.annotationId ? { ...annotation, mediaAssetId: asset.id, posterAssetId: poster?.id || null, mediaStatus: 'ready', mediaError: null } : annotation),
        mediaJobs: store.mediaJobs.map((item) => item.id === job.id ? { ...item, status: 'ready', workerId: null, leaseUntil: null, completedAt: new Date().toISOString() } : item),
      };
    });
    return published;
  }
  return transactDatabase(async (client) => {
    const selected = await client.query('SELECT * FROM annotated_media_jobs WHERE id=$1 FOR UPDATE', [job.id]);
    const current = mapMediaJob(selected.rows[0]);
    if (!current || current.status === 'cancelled' || current.workerId !== job.workerId) return false;
    const annotationResult = await client.query('SELECT * FROM annotated_annotations WHERE id=$1 FOR UPDATE', [job.annotationId]);
    if (!annotationResult.rows[0]) return false;
    const annotation = mapAnnotation(annotationResult.rows[0]);
    await writeLegacy(client, 'media', asset.id, asset);
    await client.query(`UPDATE annotated_media_artifacts SET sha256=$2,width=$3,height=$4,probe=$5::jsonb,verified_at=$6,rights_state=$7 WHERE id=$1`, [asset.id, asset.sha256 || null, asset.width || null, asset.height || null, JSON.stringify(asset.probe || null), asset.verifiedAt || null, asset.rightsState || 'unreviewed']);
    if (poster) await writeLegacy(client, 'media', poster.id, poster);
    await writeLegacy(client, 'annotations', annotation.id, { ...annotation, mediaAssetId: asset.id, posterAssetId: poster?.id || null, mediaStatus: 'ready', mediaError: null });
    await writeLegacy(client, 'mediaJobs', current.id, { ...current, status: 'ready', workerId: null, leaseUntil: null, completedAt: new Date().toISOString() });
    return true;
  });
}

// Posters are cosmetic and must not keep an otherwise verified clip in the
// processing state. Attach them after the clip is ready, but only while the
// annotation still points at the completed clip.
export async function attachMediaPoster(annotationId, mediaAssetId, poster) {
  if (!queryNative) {
    let attached = false;
    await updateStore((store) => {
      const annotation = (store.annotations || []).find((item) => item.id === annotationId);
      if (!annotation || annotation.mediaAssetId !== mediaAssetId || annotation.mediaStatus !== 'ready') return store;
      attached = true;
      return {
        ...store,
        media: [...(store.media || []), poster],
        annotations: store.annotations.map((item) => item.id === annotationId ? { ...item, posterAssetId: poster.id } : item),
      };
    });
    return attached;
  }
  return transactDatabase(async (client) => {
    const selected = await client.query('SELECT * FROM annotated_annotations WHERE id=$1 FOR UPDATE', [annotationId]);
    if (!selected.rows[0]) return false;
    const annotation = mapAnnotation(selected.rows[0]);
    if (annotation.mediaAssetId !== mediaAssetId || annotation.mediaStatus !== 'ready') return false;
    await writeLegacy(client, 'media', poster.id, poster);
    await writeLegacy(client, 'annotations', annotation.id, { ...annotation, posterAssetId: poster.id });
    return true;
  });
}

export async function failMediaRecord(job, { error, failureClass, maxAttempts, retryDelayMs }) {
  const attempts = number(job.attempts) + 1;
  const retry = attempts < maxAttempts;
  const now = new Date();
  const retryAt = retry ? new Date(now.getTime() + retryDelayMs * attempts).toISOString() : null;
  const status = retry ? 'queued' : 'dead-letter';
  const annotationStatus = retry ? 'queued' : 'failed';
  if (!queryNative) {
    let recorded = false;
    await updateStore((store) => {
      const current = (store.mediaJobs || []).find((item) => item.id === job.id);
      if (!current || current.status === 'cancelled' || current.workerId !== job.workerId) return store;
      recorded = true;
      return { ...store,
        annotations: store.annotations.map((item) => item.id === job.annotationId ? { ...item, mediaStatus: annotationStatus, mediaError: retry ? `Retrying media processing (${attempts}/${maxAttempts}).` : error } : item),
        mediaJobs: store.mediaJobs.map((item) => item.id === job.id ? { ...item, status, workerId: null, leaseUntil: null, attempts, error, failureClass, retryAt, completedAt: retry ? null : now.toISOString() } : item),
      };
    });
    return { recorded, retry, attempts, retryAt };
  }
  return transactDatabase(async (client) => {
    const selected = await client.query('SELECT * FROM annotated_media_jobs WHERE id=$1 FOR UPDATE', [job.id]);
    const current = mapMediaJob(selected.rows[0]);
    if (!current || current.status === 'cancelled' || current.workerId !== job.workerId) return { recorded: false, retry, attempts, retryAt };
    const annotationResult = await client.query('SELECT * FROM annotated_annotations WHERE id=$1 FOR UPDATE', [job.annotationId]);
    if (annotationResult.rows[0]) {
      const annotation = mapAnnotation(annotationResult.rows[0]);
      await writeLegacy(client, 'annotations', annotation.id, { ...annotation, mediaStatus: annotationStatus, mediaError: retry ? `Retrying media processing (${attempts}/${maxAttempts}).` : error });
    }
    await writeLegacy(client, 'mediaJobs', current.id, { ...current, status, workerId: null, leaseUntil: null, attempts, error, failureClass, retryAt, completedAt: retry ? null : now.toISOString() });
    return { recorded: true, retry, attempts, retryAt };
  });
}

export async function cancelMediaRecord(jobId, userId) {
  if (!queryNative) {
    let cancelled = false;
    await updateStore((store) => {
      const job = (store.mediaJobs || []).find((item) => item.id === jobId);
      const annotation = job && store.annotations.find((item) => item.id === job.annotationId);
      if (!job || !annotation || annotation.authorId !== userId || ['ready', 'failed', 'dead-letter', 'cancelled'].includes(job.status)) return store;
      cancelled = true;
      return { ...store,
        annotations: store.annotations.map((item) => item.id === annotation.id ? { ...item, mediaStatus: 'cancelled', mediaError: 'Processing cancelled by the owner.' } : item),
        mediaJobs: store.mediaJobs.map((item) => item.id === jobId ? { ...item, status: 'cancelled', workerId: null, leaseUntil: null, completedAt: new Date().toISOString() } : item),
      };
    });
    return cancelled;
  }
  return transactDatabase(async (client) => {
    const selected = await client.query(`SELECT j.*,a.author_id FROM annotated_media_jobs j JOIN annotated_annotations a ON a.id=j.annotation_id WHERE j.id=$1 FOR UPDATE OF j,a`, [jobId]);
    const row = selected.rows[0];
    if (!row || row.author_id !== userId || ['ready', 'failed', 'dead-letter', 'cancelled'].includes(row.status)) return false;
    const job = mapMediaJob(row);
    const annotationResult = await client.query('SELECT * FROM annotated_annotations WHERE id=$1', [job.annotationId]);
    const annotation = mapAnnotation(annotationResult.rows[0]);
    await writeLegacy(client, 'annotations', annotation.id, { ...annotation, mediaStatus: 'cancelled', mediaError: 'Processing cancelled by the owner.' });
    await writeLegacy(client, 'mediaJobs', job.id, { ...job, status: 'cancelled', workerId: null, leaseUntil: null, completedAt: new Date().toISOString() });
    return true;
  });
}

export async function retryMediaRecord(annotationId, userId) {
  if (!queryNative) {
    let job = null;
    await updateStore((store) => {
      const annotation = (store.annotations || []).find((item) => item.id === annotationId);
      const failed = [...(store.mediaJobs || [])].reverse().find((item) => item.annotationId === annotationId && ['failed', 'dead-letter'].includes(item.status) && annotation?.authorId === userId);
      if (!failed) return store;
      const now = new Date().toISOString();
      job = legacyJob({ ...failed, id: randomUUID(), traceId: randomUUID(), attempts: 0, status: 'queued', workerId: null, leaseUntil: null, retryAt: null, startedAt: null, completedAt: null, error: null, failureClass: null, createdAt: now });
      return { ...store,
        annotations: store.annotations.map((item) => item.id === annotationId ? { ...item, mediaStatus: 'queued', mediaError: null } : item),
        mediaJobs: [...store.mediaJobs.map((item) => item.id === failed.id ? { ...item, status: 'superseded', completedAt: now } : item), job],
      };
    });
    return job;
  }
  return transactDatabase(async (client) => {
    const selected = await client.query(
      `SELECT j.*,a.author_id FROM annotated_media_jobs j JOIN annotated_annotations a ON a.id=j.annotation_id
       WHERE j.annotation_id=$1 AND a.author_id=$2 AND j.status IN ('failed','dead-letter')
       ORDER BY j.created_at DESC,j.id DESC LIMIT 1 FOR UPDATE OF j,a`,
      [annotationId, userId],
    );
    if (!selected.rows[0]) return null;
    const failed = mapMediaJob(selected.rows[0]);
    const now = new Date().toISOString();
    const job = legacyJob({ ...failed, id: randomUUID(), traceId: randomUUID(), attempts: 0, status: 'queued', workerId: null, leaseUntil: null, retryAt: null, startedAt: null, completedAt: null, error: null, failureClass: null, createdAt: now });
    await writeLegacy(client, 'mediaJobs', failed.id, { ...failed, status: 'superseded', workerId: null, leaseUntil: null, completedAt: now });
    await writeLegacy(client, 'mediaJobs', job.id, job);
    const annotationResult = await client.query('SELECT * FROM annotated_annotations WHERE id=$1', [annotationId]);
    const annotation = mapAnnotation(annotationResult.rows[0]);
    await writeLegacy(client, 'annotations', annotation.id, { ...annotation, mediaStatus: 'queued', mediaError: null });
    return job;
  });
}

export async function deferMediaRecord(job, delayMs, reason = 'provider-backpressure') {
  const retryAt = new Date(Date.now() + Math.max(100, number(delayMs, 1000))).toISOString();
  if (!queryNative) {
    await updateStore((store) => ({ ...store, mediaJobs: store.mediaJobs.map((item) => item.id === job.id && item.workerId === job.workerId ? { ...item, status: 'queued', workerId: null, leaseUntil: null, retryAt, failureClass: reason } : item) }));
    return retryAt;
  }
  await transactDatabase(async (client) => {
    const selected = await client.query('SELECT * FROM annotated_media_jobs WHERE id=$1 AND worker_id=$2 FOR UPDATE', [job.id, job.workerId]);
    if (!selected.rows[0]) return;
    const current = mapMediaJob(selected.rows[0]);
    await writeLegacy(client, 'mediaJobs', current.id, { ...current, status: 'queued', workerId: null, leaseUntil: null, retryAt, failureClass: reason });
  });
  return retryAt;
}

export async function mediaQueueSnapshot() {
  if (!queryNative) {
    const jobs = (await readStore()).mediaJobs || [];
    const now = Date.now();
    const durations = (start, end) => jobs.map((job) => Date.parse(job[end] || '') - Date.parse(job[start] || '')).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
    const percentile95 = (values) => values.length ? values[Math.ceil(values.length * 0.95) - 1] : null;
    return {
      statuses: Object.fromEntries([...new Set(jobs.map((job) => job.status))].map((status) => [status, jobs.filter((job) => job.status === status).length])),
      oldestQueuedAgeMs: Math.max(0, ...jobs.filter((job) => job.status === 'queued').map((job) => now - Date.parse(job.createdAt || ''))),
      retries: jobs.reduce((total, job) => total + number(job.attempts), 0),
      expiredLeases: jobs.filter((job) => job.status === 'processing' && (!job.leaseUntil || Date.parse(job.leaseUntil) <= now)).length,
      failuresByClass: Object.fromEntries([...new Set(jobs.map((job) => job.failureClass).filter(Boolean))].map((failureClass) => [failureClass, jobs.filter((job) => job.failureClass === failureClass).length])),
      pickupP95Ms: percentile95(durations('createdAt', 'startedAt')),
      processingP95Ms: percentile95(durations('startedAt', 'completedAt')),
    };
  }
  const [statusResult, timingResult, failureResult] = await Promise.all([
    queryDatabase(
    `SELECT status,count(*)::integer count,
       coalesce(extract(epoch from (now()-(min(created_at) FILTER (WHERE status='queued'))))*1000,0)::bigint oldest_queued_age_ms,
       coalesce(sum(attempts),0)::bigint retries,
       count(*) FILTER (WHERE status='processing' AND (lease_until IS NULL OR lease_until<=now()))::integer expired_leases
     FROM annotated_media_jobs GROUP BY status`),
    queryDatabase(`SELECT
       percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch from (started_at-created_at))*1000) FILTER (WHERE started_at IS NOT NULL) pickup_p95_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch from (completed_at-started_at))*1000) FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL) processing_p95_ms
     FROM annotated_media_jobs`),
    queryDatabase("SELECT failure_class,count(*)::integer count FROM annotated_media_jobs WHERE failure_class IS NOT NULL GROUP BY failure_class"),
  ]);
  return {
    statuses: Object.fromEntries(statusResult.rows.map((row) => [row.status, number(row.count)])),
    oldestQueuedAgeMs: Math.max(0, ...statusResult.rows.map((row) => number(row.oldest_queued_age_ms))),
    retries: statusResult.rows.reduce((total, row) => total + number(row.retries), 0),
    expiredLeases: statusResult.rows.reduce((total, row) => total + number(row.expired_leases), 0),
    failuresByClass: Object.fromEntries(failureResult.rows.map((row) => [row.failure_class, number(row.count)])),
    pickupP95Ms: timingResult.rows[0]?.pickup_p95_ms === null ? null : number(timingResult.rows[0]?.pickup_p95_ms),
    processingP95Ms: timingResult.rows[0]?.processing_p95_ms === null ? null : number(timingResult.rows[0]?.processing_p95_ms),
  };
}

export const usesRelationalMediaJobs = () => queryNative;
