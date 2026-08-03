import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { buildFfmpegArgs, checkMediaRuntime, mediaJobLeaseExpired, runMediaCommand, shouldAbortMediaJob, shouldClaimMediaJob, shouldRecoverMediaJob, validateMediaProbe } from '../server/media-worker.js';
import { normalizeAudioMimeType } from '../server/media-store.js';

test('audio uploads accept recorder parameters but reject non-audio content types', () => {
  assert.equal(normalizeAudioMimeType('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(normalizeAudioMimeType(' AUDIO/MPEG '), 'audio/mpeg');
  assert.throws(() => normalizeAudioMimeType('video/mp4'), /Unsupported audio content type/);
  assert.throws(() => normalizeAudioMimeType('audio/x-unknown'), /Unsupported audio content type/);
});

test('video transcodes are capped at 90 seconds and 240p', () => {
  const args = buildFfmpegArgs({ sourceType: 'video', clipStart: 5, clipEnd: 200 }, 'input.mp4', 'output.mp4');
  assert.equal(args[args.indexOf('-t') + 1], '90');
  assert.equal(args[args.indexOf('-vf') + 1], 'scale=-2:240');
});

test('podcast transcodes remove video and use the requested bounded duration', () => {
  const args = buildFfmpegArgs({ sourceType: 'podcast', clipStart: 12, clipEnd: 42 }, 'input.mp3', 'output.webm');
  assert.equal(args[args.indexOf('-t') + 1], '30');
  assert.ok(args.includes('-vn'));
});

test('production readiness checks ffmpeg, ffprobe, and the configured provider extractor', async () => {
  const calls = [];
  const runtime = await checkMediaRuntime({
    includeProvider: true,
    runCommand: async (command, args) => {
      calls.push({ command, args });
      return { stdout: `${command} version test`, stderr: '' };
    },
  });
  assert.deepEqual(calls.map(({ command }) => command), ['ffmpeg', 'ffprobe', process.env.YTDLP_BIN || 'yt-dlp']);
  assert.deepEqual(runtime, { status: 'ready', checks: ['ffmpeg', 'ffprobe', 'provider extractor'] });
});

test('production readiness fails explicitly when a media runtime binary is unavailable', async () => {
  await assert.rejects(
    () => checkMediaRuntime({ includeProvider: true, runCommand: async (command) => { throw new Error(`${command} not found`); } }),
    /Media runtime ffmpeg is unavailable: ffmpeg not found/,
  );
});

test('media commands are killed when they exceed their execution deadline', async () => {
  await assert.rejects(
    () => runMediaCommand(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { timeoutMs: 50 }),
    /Media command timed out after 50ms/,
  );
});

test('zero-length media clips are rejected before spawning ffmpeg', () => {
  assert.throws(
    () => buildFfmpegArgs({ sourceType: 'video', clipStart: 10, clipEnd: 10 }, 'input.mp4', 'output.mp4'),
    /positive duration/,
  );
});

test('cancelled media jobs abort before a late worker completion can publish', () => {
  const job = { id: 'job-1' };
  assert.equal(shouldAbortMediaJob(job, { mediaJobs: [{ id: 'job-1', status: 'cancelled' }] }, new Set()), true);
  assert.equal(shouldAbortMediaJob(job, { mediaJobs: [{ id: 'job-1', status: 'processing' }] }, new Set(['job-1'])), true);
  assert.equal(shouldAbortMediaJob(job, { mediaJobs: [{ id: 'job-1', status: 'processing' }] }, new Set()), false);
});

test('media jobs use a persistent lease for restart recovery and multi-worker claims', () => {
  const now = Date.parse('2026-08-02T00:00:00.000Z');
  const activeLease = { id: 'job-lease', status: 'processing', workerId: 'worker-a', leaseUntil: new Date(now + 60_000).toISOString() };
  const expiredLease = { ...activeLease, leaseUntil: new Date(now - 1).toISOString() };
  assert.equal(mediaJobLeaseExpired(activeLease, now), false);
  assert.equal(mediaJobLeaseExpired(expiredLease, now), true);
  assert.equal(shouldClaimMediaJob({ id: 'queued', status: 'queued' }, 'worker-b', now), true);
  assert.equal(shouldClaimMediaJob(activeLease, 'worker-b', now), false);
  assert.equal(shouldClaimMediaJob(activeLease, 'worker-a', now), true);
  assert.equal(shouldClaimMediaJob(expiredLease, 'worker-b', now), true);
  assert.equal(shouldClaimMediaJob({ id: 'done', status: 'ready' }, 'worker-b', now), false);
  assert.equal(shouldRecoverMediaJob({ id: 'queued', status: 'queued' }, now), true);
  assert.equal(shouldRecoverMediaJob(activeLease, now), false);
  assert.equal(shouldRecoverMediaJob(expiredLease, now), true);
  assert.equal(shouldRecoverMediaJob({ id: 'legacy', status: 'processing' }, now), true);
});

test('media output inspection enforces duration, audio, and video height boundaries', () => {
  const video = validateMediaProbe('video', { format: { duration: '89.8' }, streams: [{ codec_type: 'video', height: 240 }, { codec_type: 'audio' }] });
  assert.equal(video.duration, 89.8);
  assert.throws(() => validateMediaProbe('video', { format: { duration: '90.1' }, streams: [{ codec_type: 'video', height: 240 }, { codec_type: 'audio' }] }), /90-second/);
  assert.throws(() => validateMediaProbe('video', { format: { duration: '12' }, streams: [{ codec_type: 'video', height: 480 }, { codec_type: 'audio' }] }), /240p/);
  assert.throws(() => validateMediaProbe('podcast', { format: { duration: '12' }, streams: [{ codec_type: 'video', height: 120 }, { codec_type: 'audio' }] }), /video stream/);
});

test('a generated video fixture is transcoded and passes the real FFprobe contract', { skip: !['ffmpeg', 'ffprobe'].every((command) => spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0) }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'annotated-media-fixture-'));
  const inputPath = path.join(directory, 'source.mp4');
  const outputPath = path.join(directory, 'clip.mp4');
  t.after(() => rm(directory, { recursive: true, force: true }));

  await runMediaCommand('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x2f4b4a:s=640x360:r=24:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', inputPath,
  ]);
  const args = buildFfmpegArgs({ sourceType: 'video', clipStart: 0.25, clipEnd: 1.75 }, inputPath, outputPath);
  await runMediaCommand('ffmpeg', args);
  const probeResult = await runMediaCommand('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,height,width', '-of', 'json', outputPath,
  ]);
  const probe = JSON.parse(probeResult.stdout);
  const inspected = validateMediaProbe('video', probe);
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  assert.ok(inspected.duration > 1);
  assert.ok(inspected.duration <= 90.05);
  assert.equal(video.height, 240);
  assert.ok(video.width <= 480);
});
