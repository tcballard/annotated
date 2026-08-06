import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mediaWorkDirectory, removeMediaFile, removeStoredMedia, storeMediaFile } from './media-store.js';
import { extractAudioPeaks } from './audio-peaks.js';
import { readStore, updateStore } from './store.js';
import { assertPublicUrl } from './ssrf.js';
import { parseSourceUrl } from './source-resolver.js';

const maxConcurrentJobs = Number(process.env.MEDIA_WORKER_CONCURRENCY || 2);
const ytdlpBinary = process.env.YTDLP_BIN || 'yt-dlp';
const maxAttempts = Math.max(1, Number(process.env.MEDIA_WORKER_MAX_ATTEMPTS || 3));
const retryDelayMs = Math.max(100, Number(process.env.MEDIA_WORKER_RETRY_DELAY_MS || 1500));
const workerId = process.env.MEDIA_WORKER_ID || randomUUID();
const leaseMs = Math.max(30_000, Number(process.env.MEDIA_WORKER_LEASE_MS || 600_000));
const processTimeoutMs = Math.max(10_000, Number(process.env.MEDIA_WORKER_PROCESS_TIMEOUT_MS || 300_000));
const ytdlpProxy = String(process.env.YTDLP_PROXY || '').trim();
const ytdlpCookiesFile = String(process.env.YTDLP_COOKIES_FILE || '').trim();
const ytdlpJsRuntime = String(process.env.YTDLP_JS_RUNTIME || 'node').trim();
const ytdlpPlayerClient = String(process.env.YTDLP_PLAYER_CLIENT || '').trim();
const queue = [];
const activeProcesses = new Map();
const cancelledJobs = new Set();
let activeJobs = 0;

const directMediaUrl = (value) => /\.(?:mp4|webm|mov|m3u8|mp3|m4a|wav|ogg|aac|flac)(?:$|\?)/i.test(value);
const outputFor = (sourceType, id) => sourceType === 'video'
  ? { fileName: `${id}.mp4`, mimeType: 'video/mp4' }
  : { fileName: `${id}.webm`, mimeType: 'audio/webm' };

const providerProtocols = new Set(['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:']);
const providerArgPattern = /^[A-Za-z0-9._,-]+$/;

export const validateProviderRuntimeConfig = ({ proxy = ytdlpProxy, cookiesFile = ytdlpCookiesFile, jsRuntime = ytdlpJsRuntime, playerClient = ytdlpPlayerClient } = {}) => {
  const normalized = {
    proxy: String(proxy || '').trim(),
    cookiesFile: String(cookiesFile || '').trim(),
    jsRuntime: String(jsRuntime || '').trim(),
    playerClient: String(playerClient || '').trim(),
  };
  if (normalized.proxy) {
    let parsed;
    try { parsed = new URL(normalized.proxy); } catch { throw new Error('YTDLP_PROXY must be a valid proxy URL.'); }
    if (!providerProtocols.has(parsed.protocol) || !parsed.hostname) throw new Error('YTDLP_PROXY must use an http, https, or socks proxy URL.');
  }
  if (normalized.cookiesFile && (!path.isAbsolute(normalized.cookiesFile) || normalized.cookiesFile.includes('\0'))) {
    throw new Error('YTDLP_COOKIES_FILE must be an absolute file path.');
  }
  if (normalized.jsRuntime && !providerArgPattern.test(normalized.jsRuntime)) throw new Error('YTDLP_JS_RUNTIME contains unsupported characters.');
  if (normalized.playerClient && !providerArgPattern.test(normalized.playerClient)) throw new Error('YTDLP_PLAYER_CLIENT contains unsupported characters.');
  return normalized;
};

export const buildProviderArgs = (job, sourceUrl, config = {}) => {
  const runtime = validateProviderRuntimeConfig({
    proxy: config.proxy ?? ytdlpProxy,
    cookiesFile: config.cookiesFile ?? ytdlpCookiesFile,
    jsRuntime: config.jsRuntime ?? ytdlpJsRuntime,
    playerClient: config.playerClient ?? ytdlpPlayerClient,
  });
  const format = job.sourceType === 'video' ? 'best[height<=240]/best' : 'bestaudio/best';
  const args = ['--no-playlist'];
  if (runtime.jsRuntime) args.push('--js-runtimes', runtime.jsRuntime);
  if (runtime.proxy) args.push('--proxy', runtime.proxy);
  if (runtime.cookiesFile) args.push('--cookies', runtime.cookiesFile);
  if (runtime.playerClient && (job.provider === 'youtube' || /(?:youtube\.com|youtu\.be)/i.test(sourceUrl))) {
    args.push('--extractor-args', `youtube:player_client=${runtime.playerClient}`);
  }
  args.push('--format', format, '--get-url', sourceUrl);
  return args;
};

export const buildFfmpegArgs = (job, input, outputPath) => {
  const duration = Math.max(0, Math.min(90, Number(job.clipEnd) - Number(job.clipStart)));
  if (!duration) throw new Error('Media clips must have a positive duration.');
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, Number(job.clipStart) || 0)), '-i', input, '-t', String(duration)];
  if (job.sourceType === 'video') args.push('-vf', 'scale=-2:240', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart');
  else args.push('-vn', '-c:a', 'libopus', '-b:a', '64k');
  args.push(outputPath);
  return args;
};

// A poster frame for video clips: one jpeg pulled from a third of the way in
// (talking heads usually face the camera by then; never past the clip's end).
export const buildPosterArgs = (clipSeconds, clipPath, posterPath) => {
  const seek = Math.max(0, Math.min(3, (Number(clipSeconds) || 0) / 3));
  return ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(seek), '-i', clipPath, '-frames:v', '1', '-q:v', '4', posterPath];
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

const run = (command, args, { maxOutput = 64_000, jobId = '', timeoutMs = processTimeoutMs } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (jobId) activeProcesses.set(jobId, child);
  let stdout = '';
  let stderr = '';
  let settled = false;
  let timedOut = false;
  let timeoutHandle;
  let killHandle;
  const cleanup = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (killHandle) clearTimeout(killHandle);
    if (jobId && activeProcesses.get(jobId) === child) activeProcesses.delete(jobId);
  };
  const resolveOnce = (value) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(value);
  };
  const rejectOnce = (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(error);
  };
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-maxOutput); });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-maxOutput); });
  child.on('error', (error) => { rejectOnce(error); });
  child.on('close', (code, signal) => {
    if (timedOut) return rejectOnce(new Error(`Media command timed out after ${timeoutMs}ms.`));
    if (jobId && cancelledJobs.has(jobId)) return rejectOnce(new Error('Media processing cancelled by the owner.'));
    if (code === 0) return resolveOnce({ stdout, stderr });
    rejectOnce(new Error(stderr.trim() || `${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`));
  });
  const timeout = Number(timeoutMs);
  if (Number.isFinite(timeout) && timeout > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killHandle = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 2_000);
    }, timeout);
  }
});

export { run as runMediaCommand };

export const checkMediaRuntime = async ({ runCommand = run, includeProvider = process.env.NODE_ENV === 'production', providerConfig } = {}) => {
  const checks = [
    ['ffmpeg', 'ffmpeg', ['-version']],
    ['ffprobe', 'ffprobe', ['-version']],
  ];
  if (includeProvider) {
    const runtime = validateProviderRuntimeConfig(providerConfig);
    if (runtime.cookiesFile) {
      try { await access(runtime.cookiesFile, fsConstants.R_OK); } catch (error) { throw new Error(`Media runtime provider cookies are unavailable: ${error.message}`); }
    }
    checks.push(['provider extractor', ytdlpBinary, ['--version']]);
  }
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

export const mediaJobLeaseExpired = (job, now = Date.now()) => {
  const leaseUntil = Date.parse(job?.leaseUntil || '');
  return !Number.isFinite(leaseUntil) || leaseUntil <= now;
};

export const shouldClaimMediaJob = (job, claimantId, now = Date.now()) => {
  if (!job || ['cancelled', 'ready', 'failed'].includes(job.status)) return false;
  if (job.status === 'queued') return true;
  if (job.status !== 'processing') return false;
  return job.workerId === claimantId || mediaJobLeaseExpired(job, now);
};

export const shouldRecoverMediaJob = (job, now = Date.now()) => job?.status === 'queued' || (job?.status === 'processing' && mediaJobLeaseExpired(job, now));

export const resolveInput = async (job, { lookup } = {}) => {
  const sourceUrl = (await assertPublicUrl(parseSourceUrl(job.sourceUrl).toString(), { lookup })).toString();
  const mediaUrl = job.mediaUrl ? (await assertPublicUrl(parseSourceUrl(job.mediaUrl).toString(), { lookup })).toString() : '';
  // RSS/Atom enclosures often use signed or extensionless URLs. The source
  // resolver marks those jobs as the podcast provider path; after the same
  // public-URL validation, pass the enclosure directly to FFmpeg instead of
  // asking yt-dlp to interpret the feed URL again.
  if (mediaUrl && (directMediaUrl(mediaUrl) || (job.sourceType === 'podcast' && job.provider === 'podcast'))) return mediaUrl;
  if (directMediaUrl(sourceUrl)) return sourceUrl;
  if (job.provider === 'youtube' || job.provider === 'podcast' || job.sourceType === 'podcast' || /(?:youtube\.com|youtu\.be)/i.test(sourceUrl)) {
    const result = await run(ytdlpBinary, buildProviderArgs(job, sourceUrl), { jobId: job.id });
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

const claimMediaJob = async (job) => {
  let claimed = false;
  await updateStore((store) => {
    const current = (store.mediaJobs || []).find((item) => item.id === job.id);
    if (!shouldClaimMediaJob(current, workerId)) return store;
    claimed = true;
    return {
      ...store,
      mediaJobs: store.mediaJobs.map((item) => item.id === job.id ? { ...item, status: 'processing', workerId, leaseUntil: new Date(Date.now() + leaseMs).toISOString() } : item),
    };
  });
  return claimed;
};

const runJob = async (job) => {
  const current = await readStore();
  const annotation = current.annotations.find((item) => item.id === job.annotationId);
  if (!annotation || annotation.mediaStatus === 'cancelled') return;
  if (!await claimMediaJob(job)) return;
  await updateAnnotation(job.annotationId, { mediaStatus: 'processing', mediaError: null });
  const assetId = randomUUID();
  const output = outputFor(job.sourceType, assetId);
  const key = `clips/${output.fileName}`;
  const outputPath = path.join(mediaWorkDirectory, output.fileName);
  let storedAsset;
  let posterStored = null;
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
    // Podcast clips carry waveform peaks for the player; failure is cosmetic.
    const peaks = job.sourceType === 'podcast' ? await extractAudioPeaks(outputPath) : null;
    // Video clips carry a poster frame so cards never open on a black box.
    // Poster failure is cosmetic and never fails the clip.
    if (job.sourceType === 'video') {
      const posterId = randomUUID();
      const posterFileName = `${posterId}.jpg`;
      const posterPath = path.join(mediaWorkDirectory, posterFileName);
      try {
        await run('ffmpeg', buildPosterArgs(Number(job.clipEnd) - Number(job.clipStart), outputPath, posterPath), { jobId: job.id });
        const posterAsset = await storeMediaFile(posterPath, { id: posterId, key: `posters/${posterFileName}`, mimeType: 'image/jpeg' });
        posterStored = { id: posterId, key: `posters/${posterFileName}`, fileName: posterAsset.fileName || `posters/${posterFileName}`, mimeType: 'image/jpeg', bytes: posterAsset.bytes, kind: 'poster', createdAt: new Date().toISOString() };
      } catch (error) {
        console.error(JSON.stringify({ event: 'poster_extraction_failed', jobId: job.id, error: String(error?.message || error).slice(0, 300) }));
      } finally {
        await removeMediaFile(posterPath);
      }
    }
    const asset = await storeMediaFile(outputPath, { id: assetId, key, mimeType: output.mimeType });
    storedAsset = { id: assetId, key, fileName: asset.fileName || key, mimeType: output.mimeType };
    let published = false;
    await updateStore((store) => {
      if (shouldAbortMediaJob(job, store)) return store;
      published = true;
      return {
        ...store,
        media: [...(store.media || []), { id: assetId, key, fileName: asset.fileName, mimeType: output.mimeType, bytes: asset.bytes, peaks, kind: 'clip', createdAt: new Date().toISOString() }, ...(posterStored ? [posterStored] : [])],
        annotations: store.annotations.map((annotation) => annotation.id === job.annotationId ? { ...annotation, mediaAssetId: assetId, posterAssetId: posterStored?.id || null, mediaStatus: 'ready', mediaError: null } : annotation),
        mediaJobs: (store.mediaJobs || []).map((item) => item.id === job.id ? { ...item, status: 'ready', workerId: null, leaseUntil: null, completedAt: new Date().toISOString() } : item),
      };
    });
    if (!published) {
      await removeStoredMedia(storedAsset).catch(() => {});
      if (posterStored) await removeStoredMedia(posterStored).catch(() => {});
      await removeMediaFile(outputPath);
      cancelledJobs.delete(job.id);
      return;
    }
    await removeMediaFile(outputPath);
  } catch (error) {
    if (storedAsset) await removeStoredMedia(storedAsset).catch(() => {});
    if (posterStored) await removeStoredMedia(posterStored).catch(() => {});
    await removeMediaFile(outputPath);
    const boundedError = String(error?.message || 'Media processing failed.').slice(0, 500);
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
        annotations: store.annotations.map((item) => item.id === job.annotationId ? { ...item, mediaStatus: retry ? 'queued' : 'failed', mediaError: retry ? `Retrying media processing (${attempts}/${maxAttempts}).` : boundedError } : item),
        mediaJobs: (store.mediaJobs || []).map((item) => item.id === job.id ? { ...item, status: retry ? 'queued' : 'failed', workerId: null, leaseUntil: null, attempts, error: boundedError, retryAt: retry ? new Date(Date.now() + retryDelayMs * attempts).toISOString() : null, completedAt: retry ? null : new Date().toISOString() } : item),
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

export const canRetryMediaJob = (job, annotation, userId) => Boolean(
  job
  && annotation
  && job.annotationId === annotation.id
  && job.status === 'failed'
  && annotation.authorId === userId
);

export async function retryMediaJobForAnnotation(annotationId, userId) {
  let job = null;
  await updateStore((store) => {
    const annotation = (store.annotations || []).find((item) => item.id === annotationId);
    const failed = [...(store.mediaJobs || [])]
      .reverse()
      .find((item) => canRetryMediaJob(item, annotation, userId));
    if (!failed) return store;
    job = {
      id: randomUUID(),
      annotationId: failed.annotationId,
      sourceUrl: failed.sourceUrl,
      sourceType: failed.sourceType,
      sourceMediaUrl: failed.sourceMediaUrl,
      mediaUrl: failed.mediaUrl,
      provider: failed.provider,
      clipStart: failed.clipStart,
      clipEnd: failed.clipEnd,
      attempts: 0,
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
    return {
      ...store,
      annotations: store.annotations.map((item) => item.id === annotationId ? { ...item, mediaStatus: 'queued', mediaError: null } : item),
      mediaJobs: [...(store.mediaJobs || []).map((item) => item.id === failed.id ? { ...item, status: 'superseded', completedAt: new Date().toISOString() } : item), job],
    };
  });
  if (!job) return null;
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
      mediaJobs: (store.mediaJobs || []).map((item) => item.id === jobId ? { ...item, status: 'cancelled', workerId: null, leaseUntil: null, completedAt: new Date().toISOString() } : item),
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
    const job = (store.mediaJobs || []).find((item) => item.annotationId === annotation.id && shouldRecoverMediaJob(item) && Number(item.attempts || 0) < maxAttempts);
    if (!job) continue;
    const retryAt = Date.parse(job.retryAt || '');
    const delay = Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : 0;
    if (delay) setTimeout(() => { queue.push({ ...job, status: 'queued' }); drain(); }, delay);
    else queue.push({ ...job, status: 'queued' });
  }
  drain();
}
