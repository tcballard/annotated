import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mediaWorkDirectory, removeMediaFile, removeStoredMedia, storeMediaFile } from './media-store.js';
import { readStore, updateStore } from './store.js';
import { assertPublicUrl } from './ssrf.js';
import { parseSourceUrl } from './source-resolver.js';

const maxConcurrentJobs = Number(process.env.MEDIA_WORKER_CONCURRENCY || 2);
const ytdlpBinary = process.env.YTDLP_BIN || 'yt-dlp';
const maxAttempts = Math.max(1, Number(process.env.MEDIA_WORKER_MAX_ATTEMPTS || 3));
const retryDelayMs = Math.max(100, Number(process.env.MEDIA_WORKER_RETRY_DELAY_MS || 1500));
const queue = [];
const activeProcesses = new Map();
const cancelledJobs = new Set();
let activeJobs = 0;

const directMediaUrl = (value) => /\.(?:mp4|webm|mov|m3u8|mp3|m4a|wav|ogg|aac|flac)(?:$|\?)/i.test(value);
const outputFor = (sourceType, id) => sourceType === 'video'
  ? { fileName: `${id}.mp4`, mimeType: 'video/mp4' }
  : { fileName: `${id}.webm`, mimeType: 'audio/webm' };

export const buildFfmpegArgs = (job, input, outputPath) => {
  const duration = Math.max(0, Math.min(90, Number(job.clipEnd) - Number(job.clipStart)));
  if (!duration) throw new Error('Media clips must have a positive duration.');
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, Number(job.clipStart) || 0)), '-i', input, '-t', String(duration)];
  if (job.sourceType === 'video') args.push('-vf', 'scale=-2:240', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart');
  else args.push('-vn', '-c:a', 'libopus', '-b:a', '64k');
  args.push(outputPath);
  return args;
};

export const validateMediaProbe = (sourceType, probe) => {
  const duration = Number(probe?.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Media output has no measurable duration.');
  if (duration > 90.05) throw new Error('Media output exceeds the 90-second limit.');
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  if (!streams.some((stream) => stream.codec_type === 'audio')) throw new Error('Media output contains no audio stream.');
  if (sourceType === 'video') {
    const video = streams.find((stream) => stream.codec_type === 'video');
    const height = Number(video?.height);
    if (!Number.isFinite(height) || height <= 0) throw new Error('Video output has no measurable height.');
    if (height > 240) throw new Error('Video output exceeds the 240p limit.');
  }
  if (sourceType !== 'video' && streams.some((stream) => stream.codec_type === 'video')) throw new Error('Audio output unexpectedly contains a video stream.');
  return { duration, streams };
};

const run = (command, args, { maxOutput = 64_000, jobId = '' } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (jobId) activeProcesses.set(jobId, child);
  let stdout = '';
  let stderr = '';
  const cleanup = () => { if (jobId && activeProcesses.get(jobId) === child) activeProcesses.delete(jobId); };
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-maxOutput); });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-maxOutput); });
  child.on('error', (error) => { cleanup(); reject(error); });
  child.on('close', (code, signal) => {
    cleanup();
    if (jobId && cancelledJobs.has(jobId)) return reject(new Error('Media processing cancelled by the owner.'));
    if (code === 0) return resolve({ stdout, stderr });
    reject(new Error(stderr.trim() || `${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`));
  });
});

export const checkMediaRuntime = async ({ runCommand = run, includeProvider = process.env.NODE_ENV === 'production' } = {}) => {
  const checks = [
    ['ffmpeg', 'ffmpeg', ['-version']],
    ['ffprobe', 'ffprobe', ['-version']],
  ];
  if (includeProvider) checks.push(['provider extractor', ytdlpBinary, ['--version']]);
  for (const [label, command, args] of checks) {
    try {
      await runCommand(command, args, { maxOutput: 2_000 });
    } catch (error) {
      throw new Error(`Media runtime ${label} is unavailable: ${error.message}`);
    }
  }
  return { status: 'ready', checks: checks.map(([label]) => label) };
};

export const shouldAbortMediaJob = (job, store, cancelled = cancelledJobs) => cancelled.has(job.id) || (store.mediaJobs || []).some((item) => item.id === job.id && item.status === 'cancelled');

export const resolveInput = async (job, { lookup } = {}) => {
  const sourceUrl = (await assertPublicUrl(parseSourceUrl(job.sourceUrl).toString(), { lookup })).toString();
  const mediaUrl = job.mediaUrl ? (await assertPublicUrl(parseSourceUrl(job.mediaUrl).toString(), { lookup })).toString() : '';
  if (mediaUrl && directMediaUrl(mediaUrl)) return mediaUrl;
  if (directMediaUrl(sourceUrl)) return sourceUrl;
  if (job.provider === 'youtube' || job.provider === 'podcast' || job.sourceType === 'podcast' || /(?:youtube\.com|youtu\.be)/i.test(sourceUrl)) {
    const format = job.sourceType === 'video' ? 'best[height<=240]/best' : 'bestaudio/best';
    const result = await run(ytdlpBinary, ['--no-playlist', '--format', format, '--get-url', sourceUrl], { jobId: job.id });
    const input = result.stdout.trim().split(/\s+/)[0];
    if (!input) throw new Error('The media provider returned no playable stream.');
    return validatePlayableInput(input, { lookup });
  }
  throw new Error('No playable media stream was found for this source.');
};

export async function validatePlayableInput(value, { lookup } = {}) {
  return (await assertPublicUrl(parseSourceUrl(value).toString(), { lookup })).toString();
}

const updateAnnotation = (annotationId, changes) => updateStore((store) => ({
  ...store,
  annotations: store.annotations.map((annotation) => annotation.id === annotationId ? { ...annotation, ...changes } : annotation),
}));

const runJob = async (job) => {
  const current = await readStore();
  const annotation = current.annotations.find((item) => item.id === job.annotationId);
  if (!annotation || annotation.mediaStatus === 'cancelled') return;
  await updateAnnotation(job.annotationId, { mediaStatus: 'processing', mediaError: null });
  const assetId = randomUUID();
  const output = outputFor(job.sourceType, assetId);
  const key = `clips/${output.fileName}`;
  const outputPath = path.join(mediaWorkDirectory, output.fileName);
  let storedAsset;
  try {
    await mkdir(mediaWorkDirectory, { recursive: true });
    const input = await resolveInput(job);
    const args = buildFfmpegArgs(job, input, outputPath);
    await run('ffmpeg', args, { jobId: job.id });
    const probeResult = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,height', '-of', 'json', outputPath], { jobId: job.id });
    let probe;
    try { probe = JSON.parse(probeResult.stdout); } catch { throw new Error('Media output inspection returned invalid data.'); }
    validateMediaProbe(job.sourceType, probe);
    const completed = await readStore();
    if (shouldAbortMediaJob(job, completed)) {
      await removeMediaFile(outputPath);
      cancelledJobs.delete(job.id);
      return;
    }
    const asset = await storeMediaFile(outputPath, { id: assetId, key, mimeType: output.mimeType });
    storedAsset = { id: assetId, key, fileName: asset.fileName || key, mimeType: output.mimeType };
    let published = false;
    await updateStore((store) => {
      if (shouldAbortMediaJob(job, store)) return store;
      published = true;
      return {
        ...store,
        media: [...(store.media || []), { id: assetId, key, fileName: asset.fileName, mimeType: output.mimeType, bytes: asset.bytes, kind: 'clip', createdAt: new Date().toISOString() }],
        annotations: store.annotations.map((annotation) => annotation.id === job.annotationId ? { ...annotation, mediaAssetId: assetId, mediaStatus: 'ready', mediaError: null } : annotation),
        mediaJobs: (store.mediaJobs || []).map((item) => item.id === job.id ? { ...item, status: 'ready', completedAt: new Date().toISOString() } : item),
      };
    });
    if (!published) {
      await removeStoredMedia(storedAsset).catch(() => {});
      await removeMediaFile(outputPath);
      cancelledJobs.delete(job.id);
      return;
    }
    await removeMediaFile(outputPath);
  } catch (error) {
    if (storedAsset) await removeStoredMedia(storedAsset).catch(() => {});
    await removeMediaFile(outputPath);
    const latest = await readStore();
    if (shouldAbortMediaJob(job, latest)) {
      cancelledJobs.delete(job.id);
      return;
    }
    const attempts = Number(job.attempts || 0) + 1;
    const retry = attempts < maxAttempts;
    let recordedFailure = false;
    await updateStore((store) => {
      if (shouldAbortMediaJob(job, store)) return store;
      recordedFailure = true;
      return {
        ...store,
        annotations: store.annotations.map((item) => item.id === job.annotationId ? { ...item, mediaStatus: retry ? 'queued' : 'failed', mediaError: retry ? `Retrying media processing (${attempts}/${maxAttempts}).` : error.message } : item),
        mediaJobs: (store.mediaJobs || []).map((item) => item.id === job.id ? { ...item, status: retry ? 'queued' : 'failed', attempts, error: error.message, retryAt: retry ? new Date(Date.now() + retryDelayMs * attempts).toISOString() : null, completedAt: retry ? null : new Date().toISOString() } : item),
      };
    });
    if (!recordedFailure) {
      cancelledJobs.delete(job.id);
      return;
    }
    if (retry) setTimeout(() => { queue.push({ ...job, attempts, status: 'queued' }); drain(); }, retryDelayMs * attempts);
  }
};

const drain = () => {
  while (activeJobs < maxConcurrentJobs && queue.length) {
    const job = queue.shift();
    activeJobs += 1;
    void runJob(job).finally(() => { activeJobs -= 1; drain(); });
  }
};

export async function enqueueMediaJob(input) {
  const job = { id: randomUUID(), ...input, attempts: 0, status: 'queued', createdAt: new Date().toISOString() };
  await updateStore((store) => ({ ...store, mediaJobs: [...(store.mediaJobs || []), job], annotations: store.annotations.map((annotation) => annotation.id === input.annotationId ? { ...annotation, mediaStatus: 'queued', mediaError: null } : annotation) }));
  queue.push(job);
  drain();
  return job;
}

export async function cancelMediaJob(jobId, userId) {
  let cancelled = false;
  await updateStore((store) => {
    const job = (store.mediaJobs || []).find((item) => item.id === jobId);
    const annotation = job && store.annotations.find((item) => item.id === job.annotationId);
    if (!job || !annotation || annotation.authorId !== userId || ['ready', 'failed', 'cancelled'].includes(job.status)) return store;
    cancelled = true;
    return {
      ...store,
      annotations: store.annotations.map((item) => item.id === annotation.id ? { ...item, mediaStatus: 'cancelled', mediaError: 'Processing cancelled by the owner.' } : item),
      mediaJobs: (store.mediaJobs || []).map((item) => item.id === jobId ? { ...item, status: 'cancelled', completedAt: new Date().toISOString() } : item),
    };
  });
  if (cancelled) {
    const child = activeProcesses.get(jobId);
    if (child) {
      cancelledJobs.add(jobId);
      if (!child.killed) child.kill('SIGTERM');
    }
    for (let index = queue.length - 1; index >= 0; index -= 1) if (queue[index].id === jobId) queue.splice(index, 1);
  }
  return cancelled;
}

export async function recoverMediaJobs() {
  const store = await readStore();
  for (const annotation of store.annotations.filter((item) => item.status === 'published' && ['queued', 'processing'].includes(item.mediaStatus))) {
    const job = (store.mediaJobs || []).find((item) => item.annotationId === annotation.id && ['queued', 'processing'].includes(item.status) && Number(item.attempts || 0) < maxAttempts);
    if (job) queue.push({ ...job, status: 'queued' });
  }
  drain();
}
