import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mediaWorkDirectory, removeMediaFile, removeStoredMedia, storeMediaFile } from './media-store.js';
import { extractAudioPeaks } from './audio-peaks.js';
import { assertPublicUrl } from './ssrf.js';
import { parseSourceUrl } from './source-resolver.js';
import {
  cancelMediaRecord,
  attachMediaPoster,
  claimMediaRecord,
  completeMediaRecord,
  deferMediaRecord,
  enqueueMediaRecord,
  failMediaRecord,
  mediaJobCancelled,
  recoverableMediaJobIds,
  retryMediaRecord,
} from './media-job-repository.js';

const processRole = process.env.ANNOTATED_PROCESS_ROLE || (process.env.NODE_ENV === 'production' ? 'api' : 'development');
const defaultConcurrency = processRole === 'media-worker' ? 2 : process.env.NODE_ENV === 'production' ? 0 : 2;
const maxConcurrentJobs = Number(process.env.MEDIA_WORKER_CONCURRENCY ?? defaultConcurrency);
if (!Number.isSafeInteger(maxConcurrentJobs) || maxConcurrentJobs < 0) throw new Error('MEDIA_WORKER_CONCURRENCY must be a non-negative integer.');
if (processRole === 'media-worker' && maxConcurrentJobs < 1) throw new Error('The standalone media worker requires MEDIA_WORKER_CONCURRENCY to be at least 1.');
if (process.env.NODE_ENV === 'production' && processRole !== 'media-worker' && maxConcurrentJobs !== 0) throw new Error('The production API is queue-only; MEDIA_WORKER_CONCURRENCY must be 0.');
export const mediaWorkerExecution = Object.freeze({ processRole, concurrency: maxConcurrentJobs, inProcess: maxConcurrentJobs > 0 });
const ytdlpBinary = process.env.YTDLP_BIN || 'yt-dlp';
const maxAttempts = Number(process.env.MEDIA_WORKER_MAX_ATTEMPTS || 3);
if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error('MEDIA_WORKER_MAX_ATTEMPTS must be a positive integer.');
export const mediaWorkerRetryPolicy = Object.freeze({ maxAttempts });
const positiveIntegerSetting = (name, fallback, minimum) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be an integer of at least ${minimum}.`);
  return value;
};
const retryDelayMs = positiveIntegerSetting('MEDIA_WORKER_RETRY_DELAY_MS', 1500, 100);
const workerId = process.env.MEDIA_WORKER_ID || randomUUID();
export const mediaWorkerId = workerId;
const leaseMs = positiveIntegerSetting('MEDIA_WORKER_LEASE_MS', 600_000, 30_000);
const processTimeoutMs = positiveIntegerSetting('MEDIA_WORKER_PROCESS_TIMEOUT_MS', 300_000, 10_000);
const providerConcurrency = positiveIntegerSetting('MEDIA_WORKER_PROVIDER_CONCURRENCY', 2, 1);
const breakerFailureThreshold = positiveIntegerSetting('MEDIA_WORKER_BREAKER_FAILURES', 5, 1);
const breakerCooldownMs = positiveIntegerSetting('MEDIA_WORKER_BREAKER_COOLDOWN_MS', 60_000, 1_000);
const ytdlpProxy = String(process.env.YTDLP_PROXY || '').trim();
const ytdlpCookiesFile = String(process.env.YTDLP_COOKIES_FILE || '').trim();
const ytdlpJsRuntime = String(process.env.YTDLP_JS_RUNTIME || 'node').trim();
const ytdlpPlayerClient = String(process.env.YTDLP_PLAYER_CLIENT || '').trim();
const ytdlpPluginDir = String(process.env.YTDLP_PLUGIN_DIR || '').trim();
const ytdlpPotProviderUrl = String(process.env.YTDLP_POT_PROVIDER_URL || '').trim();
const videoPreset = String(process.env.MEDIA_WORKER_VIDEO_PRESET || 'superfast').trim();
const videoCrf = Number(process.env.MEDIA_WORKER_VIDEO_CRF || 30);
const queue = [];
const posterQueue = [];
const activeProcesses = new Map();
const cancelledJobs = new Set();
let activeJobs = 0;
let activePosters = 0;

const mediaLog = (event, job, details = {}) => console.info(JSON.stringify({
  event,
  traceId: job?.traceId || job?.id || null,
  jobId: job?.id || null,
  annotationId: job?.annotationId || null,
  workerId: event === 'media_job_queued' ? null : workerId,
  provider: job?.provider || job?.sourceType || 'direct',
  ...details,
}));
const stageMs = (startedAt) => Math.max(0, Date.now() - startedAt);

const providerKey = (job) => String(job.provider || job.sourceType || 'direct').toLowerCase();
export const createProviderGate = ({ concurrency, failureThreshold, cooldownMs, now = () => Date.now() }) => {
  for (const [name, value] of Object.entries({ concurrency, failureThreshold, cooldownMs })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  }
  const states = new Map();
  const acquire = (job) => {
    const key = providerKey(job);
    const state = states.get(key) || { active: 0, failures: 0, openUntil: 0 };
    const currentTime = now();
    if (state.openUntil > currentTime) return { allowed: false, key, delayMs: state.openUntil - currentTime, reason: 'provider-circuit-open' };
    if (state.active >= concurrency) return { allowed: false, key, delayMs: 1_000, reason: 'provider-concurrency' };
    state.active += 1;
    if (state.openUntil && state.openUntil <= currentTime) state.openUntil = 0;
    states.set(key, state);
    return { allowed: true, key };
  };
  const release = (key, { succeeded = false, failed = false } = {}) => {
    if (!key) return;
    const state = states.get(key) || { active: 0, failures: 0, openUntil: 0 };
    state.active = Math.max(0, state.active - 1);
    if (succeeded) state.failures = 0;
    if (failed) {
      state.failures += 1;
      if (state.failures >= failureThreshold) state.openUntil = now() + cooldownMs;
    }
    states.set(key, state);
  };
  const snapshot = (key) => ({ ...(states.get(String(key).toLowerCase()) || { active: 0, failures: 0, openUntil: 0 }) });
  return Object.freeze({ acquire, release, snapshot });
};
const providerControl = createProviderGate({ concurrency: providerConcurrency, failureThreshold: breakerFailureThreshold, cooldownMs: breakerCooldownMs });
const providerGate = providerControl.acquire;
const releaseProvider = providerControl.release;

export const classifyMediaFailure = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('cancel')) return 'cancelled';
  if (message.includes('http error 429') || message.includes('too many requests') || message.includes('confirm you\'re not a bot') || message.includes('bot verification')) return 'provider-rate-limit';
  if (message.includes('missing required visitor data') || message.includes('po token') || message.includes('pot provider')) return 'provider-configuration';
  if (message.includes('timed out') && (message.includes('provider') || message.includes('yt-dlp'))) return 'provider-timeout';
  if (message.includes('timed out')) return 'transcode-timeout';
  if (message.includes('s3') || message.includes('object') || message.includes('bucket') || message.includes('upload')) return 'object-storage';
  if (message.includes('provider') || message.includes('playable stream') || message.includes('extractor')) return 'provider';
  if (message.includes('duration') || message.includes('stream') || message.includes('240p')) return 'media-validation';
  if (message.includes('ffmpeg') || message.includes('ffprobe') || message.includes('codec')) return 'transcode';
  return 'unknown';
};

const directMediaUrl = (value) => /\.(?:mp4|webm|mov|m3u8|mp3|m4a|wav|ogg|aac|flac)(?:$|\?)/i.test(value);
const outputFor = (sourceType, id) => sourceType === 'video'
  ? { fileName: `${id}.mp4`, mimeType: 'video/mp4' }
  : { fileName: `${id}.webm`, mimeType: 'audio/webm' };

const providerProtocols = new Set(['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:']);
const providerArgPattern = /^[A-Za-z0-9._,-]+$/;
const videoPresets = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium']);

export const validateProviderRuntimeConfig = ({ proxy = ytdlpProxy, cookiesFile = ytdlpCookiesFile, jsRuntime = ytdlpJsRuntime, playerClient = ytdlpPlayerClient, pluginDir = ytdlpPluginDir, potProviderUrl = ytdlpPotProviderUrl } = {}) => {
  const normalized = {
    proxy: String(proxy || '').trim(),
    cookiesFile: String(cookiesFile || '').trim(),
    jsRuntime: String(jsRuntime || '').trim(),
    playerClient: String(playerClient || '').trim(),
    pluginDir: String(pluginDir || '').trim(),
    potProviderUrl: String(potProviderUrl || '').trim(),
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
  if (normalized.pluginDir && (!path.isAbsolute(normalized.pluginDir) || normalized.pluginDir.includes('\0'))) throw new Error('YTDLP_PLUGIN_DIR must be an absolute directory path.');
  if (normalized.potProviderUrl) {
    let parsed;
    try { parsed = new URL(normalized.potProviderUrl); } catch { throw new Error('YTDLP_POT_PROVIDER_URL must be a valid URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('YTDLP_POT_PROVIDER_URL must use an http or https URL.');
    if (!normalized.pluginDir) throw new Error('YTDLP_PLUGIN_DIR is required when YTDLP_POT_PROVIDER_URL is configured.');
  }
  return normalized;
};

export const buildProviderArgs = (job, sourceUrl, config = {}) => {
  const runtime = validateProviderRuntimeConfig({
    proxy: config.proxy ?? ytdlpProxy,
    cookiesFile: config.cookiesFile ?? ytdlpCookiesFile,
    jsRuntime: config.jsRuntime ?? ytdlpJsRuntime,
    playerClient: config.playerClient ?? ytdlpPlayerClient,
    pluginDir: config.pluginDir ?? ytdlpPluginDir,
    potProviderUrl: config.potProviderUrl ?? ytdlpPotProviderUrl,
  });
  const format = job.sourceType === 'video' ? 'best[height<=240]/best' : 'bestaudio/best';
  const args = ['--no-playlist'];
  if (runtime.jsRuntime) args.push('--js-runtimes', runtime.jsRuntime);
  if (runtime.proxy) args.push('--proxy', runtime.proxy);
  if (runtime.cookiesFile) args.push('--cookies', runtime.cookiesFile);
  const youtube = job.provider === 'youtube' || /(?:youtube\.com|youtu\.be)/i.test(sourceUrl);
  if (youtube && runtime.potProviderUrl) args.push('--plugin-dirs', runtime.pluginDir);
  if (youtube && runtime.potProviderUrl) {
    args.push('--extractor-args', `youtube:player_client=${runtime.playerClient || 'mweb'};fetch_pot=always`);
    args.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${runtime.potProviderUrl}`);
  } else if (youtube && runtime.playerClient) {
    args.push('--extractor-args', `youtube:player_client=${runtime.playerClient}`);
  }
  args.push('--format', format, '--get-url', sourceUrl);
  return args;
};

export const buildFfmpegArgs = (job, input, outputPath, { preset = videoPreset, crf = videoCrf } = {}) => {
  const duration = Math.max(0, Math.min(90, Number(job.clipEnd) - Number(job.clipStart)));
  if (!duration) throw new Error('Media clips must have a positive duration.');
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, Number(job.clipStart) || 0)), '-i', input, '-t', String(duration)];
  if (job.sourceType === 'video') {
    if (!videoPresets.has(preset)) throw new Error('MEDIA_WORKER_VIDEO_PRESET must be a supported libx264 preset.');
    if (!Number.isInteger(crf) || crf < 18 || crf > 40) throw new Error('MEDIA_WORKER_VIDEO_CRF must be an integer from 18 to 40.');
    args.push('-vf', 'scale=-2:240', '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart');
  } else args.push('-vn', '-c:a', 'libopus', '-b:a', '64k');
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
  if (process.env.NODE_ENV === 'production' && processRole !== 'media-worker') {
    reject(new Error('Media binaries are disabled in the production API process.'));
    return;
  }
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
    if (runtime.potProviderUrl) {
      const pluginPath = path.join(runtime.pluginDir, 'bgutil-ytdlp-pot-provider.zip');
      try { await access(pluginPath, fsConstants.R_OK); } catch (error) { throw new Error(`Media runtime PO token plugin is unavailable: ${error.message}`); }
      checks.push(['PO token plugin', null, []]);
    }
  }
  for (const [label, command, args] of checks) {
    if (!command) continue;
    try {
      await runCommand(command, args, { maxOutput: 8_000 });
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

const claimMediaJob = async (job) => {
  return claimMediaRecord({ jobId: typeof job === 'string' ? job : job.id, workerId, leaseMs, maxAttempts });
};

const createAndAttachPoster = async ({ job, mediaAssetId, outputPath }) => {
  const startedAt = Date.now();
  const posterId = randomUUID();
  const posterFileName = `${posterId}.jpg`;
  const posterPath = path.join(mediaWorkDirectory, posterFileName);
  let storedPoster = null;
  try {
    await run('ffmpeg', buildPosterArgs(Number(job.clipEnd) - Number(job.clipStart), outputPath, posterPath));
    const posterAsset = await storeMediaFile(posterPath, { id: posterId, key: `posters/${posterFileName}`, mimeType: 'image/jpeg' });
    storedPoster = { id: posterId, key: `posters/${posterFileName}`, fileName: posterAsset.fileName || `posters/${posterFileName}`, mimeType: 'image/jpeg', bytes: posterAsset.bytes, kind: 'poster', createdAt: new Date().toISOString() };
    const attached = await attachMediaPoster(job.annotationId, mediaAssetId, storedPoster);
    if (!attached) {
      await removeStoredMedia(storedPoster).catch(() => {});
      return;
    }
    mediaLog('media_poster_attached', job, { posterAssetId: posterId, durationMs: stageMs(startedAt) });
  } catch (error) {
    if (storedPoster) await removeStoredMedia(storedPoster).catch(() => {});
    console.error(JSON.stringify({ event: 'poster_extraction_failed', traceId: job.traceId || job.id, jobId: job.id, annotationId: job.annotationId, durationMs: stageMs(startedAt), error: String(error?.message || error).slice(0, 300) }));
  } finally {
    await Promise.all([removeMediaFile(posterPath), removeMediaFile(outputPath)]);
  }
};

const drainPosterQueue = () => {
  while (activePosters < 1 && posterQueue.length) {
    const task = posterQueue.shift();
    activePosters += 1;
    void createAndAttachPoster(task).finally(() => { activePosters -= 1; drainPosterQueue(); });
  }
};

const schedulePosterAttachment = (task) => {
  posterQueue.push(task);
  drainPosterQueue();
};

const runJob = async (jobId) => {
  const job = await claimMediaJob(jobId);
  if (!job) return;
  mediaLog('media_job_claimed', job, { pickupMs: Math.max(0, Date.now() - Date.parse(job.createdAt || '')) });
  const gate = providerGate(job);
  if (!gate.allowed) {
    const retryAt = await deferMediaRecord(job, gate.delayMs, gate.reason);
    mediaLog('media_job_deferred', job, { reason: gate.reason, retryAt });
    setTimeout(() => { queue.push(job.id); drain(); }, Math.max(0, Date.parse(retryAt) - Date.now()));
    return;
  }
  let providerSucceeded = false;
  let providerFailed = false;
  const assetId = randomUUID();
  const output = outputFor(job.sourceType, assetId);
  const key = `clips/${output.fileName}`;
  const outputPath = path.join(mediaWorkDirectory, output.fileName);
  let storedAsset;
  try {
    await mkdir(mediaWorkDirectory, { recursive: true });
    let startedAt = Date.now();
    const input = await resolveInput(job);
    mediaLog('media_provider_resolved', job, { durationMs: stageMs(startedAt) });
    const args = buildFfmpegArgs(job, input, outputPath);
    startedAt = Date.now();
    await run('ffmpeg', args, { jobId: job.id });
    mediaLog('media_transcode_completed', job, { durationMs: stageMs(startedAt) });
    startedAt = Date.now();
    const probeResult = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', outputPath], { jobId: job.id });
    let probe;
    try { probe = JSON.parse(probeResult.stdout); } catch { throw new Error('Media output inspection returned invalid data.'); }
    validateMediaProbe(job.sourceType, probe);
    mediaLog('media_probe_validated', job, { durationMs: stageMs(startedAt) });
    if (cancelledJobs.has(job.id) || await mediaJobCancelled(job.id)) {
      await removeMediaFile(outputPath);
      cancelledJobs.delete(job.id);
      return;
    }
    // Podcast clips carry waveform peaks for the player; failure is cosmetic.
    const peaks = job.sourceType === 'podcast' ? await extractAudioPeaks(outputPath) : null;
    const sha256 = createHash('sha256').update(await readFile(outputPath)).digest('hex');
    const videoStream = (probe.streams || []).find((stream) => stream.codec_type === 'video');
    startedAt = Date.now();
    const asset = await storeMediaFile(outputPath, { id: assetId, key, mimeType: output.mimeType });
    mediaLog('media_object_stored', job, { assetId, bytes: asset.bytes, objectAttempts: asset.attempts || 1, durationMs: stageMs(startedAt) });
    storedAsset = { id: assetId, key, fileName: asset.fileName || key, mimeType: output.mimeType };
    startedAt = Date.now();
    const published = await completeMediaRecord(job, {
      asset: { id: assetId, key, fileName: asset.fileName, mimeType: output.mimeType, bytes: asset.bytes, peaks, kind: 'clip', sha256, width: Number(videoStream?.width) || null, height: Number(videoStream?.height) || null, probe, verifiedAt: new Date().toISOString(), rightsState: 'unreviewed', createdAt: new Date().toISOString() },
    });
    if (!published) {
      await removeStoredMedia(storedAsset).catch(() => {});
      await removeMediaFile(outputPath);
      cancelledJobs.delete(job.id);
      return;
    }
    providerSucceeded = true;
    mediaLog('media_record_published', job, { durationMs: stageMs(startedAt) });
    mediaLog('media_job_ready', job, { assetId, processingMs: Math.max(0, Date.now() - Date.parse(job.startedAt || job.createdAt || '')) });
    if (job.sourceType === 'video') schedulePosterAttachment({ job, mediaAssetId: assetId, outputPath });
    else await removeMediaFile(outputPath);
  } catch (error) {
    if (storedAsset) await removeStoredMedia(storedAsset).catch(() => {});
    await removeMediaFile(outputPath);
    const boundedError = String(error?.message || 'Media processing failed.').slice(0, 500);
    if (cancelledJobs.has(job.id) || await mediaJobCancelled(job.id)) {
      cancelledJobs.delete(job.id);
      return;
    }
    const failureClass = classifyMediaFailure(error);
    providerFailed = ['provider', 'provider-timeout', 'provider-rate-limit', 'provider-configuration'].includes(failureClass);
    const failureDelayMs = failureClass === 'provider-rate-limit' ? Math.max(retryDelayMs, 60_000) : retryDelayMs;
    const failure = await failMediaRecord(job, { error: boundedError, failureClass, maxAttempts, retryDelayMs: failureDelayMs });
    if (!failure.recorded) {
      cancelledJobs.delete(job.id);
      return;
    }
    mediaLog(failure.retry ? 'media_job_retry_scheduled' : 'media_job_dead_lettered', job, { failureClass, attempts: failure.attempts, retryAt: failure.retryAt || null });
    if (failure.retry) setTimeout(() => { queue.push(job.id); drain(); }, Math.max(0, Date.parse(failure.retryAt) - Date.now()));
  } finally {
    releaseProvider(gate.key, { succeeded: providerSucceeded, failed: providerFailed });
  }
};

const drain = () => {
  while (activeJobs < maxConcurrentJobs && queue.length) {
    const jobId = queue.shift();
    activeJobs += 1;
    void runJob(jobId).finally(() => { activeJobs -= 1; drain(); });
  }
};

export async function enqueueMediaJob(input) {
  const job = await enqueueMediaRecord(input);
  mediaLog('media_job_queued', job);
  if (maxConcurrentJobs > 0) {
    queue.push(job.id);
    drain();
  }
  return job;
}

export const canRetryMediaJob = (job, annotation, userId) => Boolean(
  job
  && annotation
  && job.annotationId === annotation.id
  && ['failed', 'dead-letter'].includes(job.status)
  && annotation.authorId === userId
);

export async function retryMediaJobForAnnotation(annotationId, userId) {
  const job = await retryMediaRecord(annotationId, userId);
  if (!job) return null;
  if (maxConcurrentJobs > 0) {
    queue.push(job.id);
    drain();
  }
  return job;
}

export async function cancelMediaJob(jobId, userId) {
  const cancelled = await cancelMediaRecord(jobId, userId);
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
  if (maxConcurrentJobs <= 0) return;
  for (const jobId of await recoverableMediaJobIds(Math.max(100, maxConcurrentJobs * 4))) if (!queue.includes(jobId)) queue.push(jobId);
  drain();
}
