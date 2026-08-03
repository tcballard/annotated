import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mediaWorkDirectory, removeMediaFile, storeMediaFile } from './media-store.js';
import { readStore, updateStore } from './store.js';

const maxConcurrentJobs = Number(process.env.MEDIA_WORKER_CONCURRENCY || 2);
const ytdlpBinary = process.env.YTDLP_BIN || 'yt-dlp';
const queue = [];
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

const run = (command, args, { maxOutput = 64_000 } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-maxOutput); });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-maxOutput); });
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr.trim() || `${command} exited with code ${code}.`)));
});

const resolveInput = async (job) => {
  if (job.mediaUrl && directMediaUrl(job.mediaUrl)) return job.mediaUrl;
  if (directMediaUrl(job.sourceUrl)) return job.sourceUrl;
  if (job.provider === 'youtube' || /(?:youtube\.com|youtu\.be)/i.test(job.sourceUrl)) {
    const format = job.sourceType === 'video' ? 'best[height<=240]/best' : 'bestaudio/best';
    const result = await run(ytdlpBinary, ['--no-playlist', '--format', format, '--get-url', job.sourceUrl]);
    const input = result.stdout.trim().split(/\s+/)[0];
    if (!input) throw new Error('The media provider returned no playable stream.');
    return input;
  }
  throw new Error('No playable media stream was found for this source.');
};

const updateAnnotation = (annotationId, changes) => updateStore((store) => ({
  ...store,
  annotations: store.annotations.map((annotation) => annotation.id === annotationId ? { ...annotation, ...changes } : annotation),
}));

const runJob = async (job) => {
  await updateAnnotation(job.annotationId, { mediaStatus: 'processing', mediaError: null });
  const assetId = randomUUID();
  const output = outputFor(job.sourceType, assetId);
  const key = `clips/${output.fileName}`;
  const outputPath = path.join(mediaWorkDirectory, output.fileName);
  try {
    await mkdir(mediaWorkDirectory, { recursive: true });
    const input = await resolveInput(job);
    const args = buildFfmpegArgs(job, input, outputPath);
    await run('ffmpeg', args);
    const asset = await storeMediaFile(outputPath, { id: assetId, key, mimeType: output.mimeType });
    await updateStore((store) => ({
      ...store,
      media: [...(store.media || []), { id: assetId, key, fileName: asset.fileName, mimeType: output.mimeType, bytes: asset.bytes, kind: 'clip', createdAt: new Date().toISOString() }],
      annotations: store.annotations.map((annotation) => annotation.id === job.annotationId ? { ...annotation, mediaAssetId: assetId, mediaStatus: 'ready', mediaError: null } : annotation),
      mediaJobs: (store.mediaJobs || []).map((item) => item.id === job.id ? { ...item, status: 'ready', completedAt: new Date().toISOString() } : item),
    }));
    await removeMediaFile(outputPath);
  } catch (error) {
    await removeMediaFile(outputPath);
    await updateStore((store) => ({
      ...store,
      annotations: store.annotations.map((annotation) => annotation.id === job.annotationId ? { ...annotation, mediaStatus: 'failed', mediaError: error.message } : annotation),
      mediaJobs: (store.mediaJobs || []).map((item) => item.id === job.id ? { ...item, status: 'failed', error: error.message, completedAt: new Date().toISOString() } : item),
    }));
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
  const job = { id: randomUUID(), ...input, status: 'queued', createdAt: new Date().toISOString() };
  await updateStore((store) => ({ ...store, mediaJobs: [...(store.mediaJobs || []), job], annotations: store.annotations.map((annotation) => annotation.id === input.annotationId ? { ...annotation, mediaStatus: 'queued', mediaError: null } : annotation) }));
  queue.push(job);
  drain();
  return job;
}

export async function recoverMediaJobs() {
  const store = await readStore();
  for (const annotation of store.annotations.filter((item) => item.status === 'published' && ['queued', 'processing'].includes(item.mediaStatus))) {
    const job = (store.mediaJobs || []).find((item) => item.annotationId === annotation.id && item.status !== 'ready');
    if (job) queue.push({ ...job, status: 'queued' });
  }
  drain();
}
