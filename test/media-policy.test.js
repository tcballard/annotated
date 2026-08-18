import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { buildFfmpegArgs, buildPosterArgs, buildProviderArgs, canRetryMediaJob, checkMediaRuntime, mediaJobLeaseExpired, runMediaCommand, shouldAbortMediaJob, shouldClaimMediaJob, shouldRecoverMediaJob, validateMediaProbe, validateProviderRuntimeConfig } from '../server/media-worker.js';
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
  assert.equal(args[args.indexOf('-preset') + 1], 'superfast');
});

test('video transcode speed is configurable within bounded production settings', () => {
  const args = buildFfmpegArgs({ sourceType: 'video', clipStart: 0, clipEnd: 10 }, 'input.mp4', 'output.mp4', { preset: 'ultrafast', crf: 32 });
  assert.equal(args[args.indexOf('-preset') + 1], 'ultrafast');
  assert.equal(args[args.indexOf('-crf') + 1], '32');
  assert.throws(() => buildFfmpegArgs({ sourceType: 'video', clipStart: 0, clipEnd: 10 }, 'in', 'out', { preset: 'slow', crf: 30 }), /supported libx264 preset/);
  assert.throws(() => buildFfmpegArgs({ sourceType: 'video', clipStart: 0, clipEnd: 10 }, 'in', 'out', { preset: 'superfast', crf: 50 }), /18 to 40/);
});

test('podcast transcodes remove video and use the requested bounded duration', () => {
  const args = buildFfmpegArgs({ sourceType: 'podcast', clipStart: 12, clipEnd: 42 }, 'input.mp3', 'output.webm');
  assert.equal(args[args.indexOf('-t') + 1], '30');
  assert.ok(args.includes('-vn'));
});

test('poster extraction seeks a third in, bounded to three seconds, one frame', () => {
  const args = buildPosterArgs(48, 'clip.mp4', 'poster.jpg');
  assert.equal(args[args.indexOf('-ss') + 1], '3', 'long clips cap the seek at three seconds');
  assert.equal(args[args.indexOf('-frames:v') + 1], '1');
  assert.equal(args[args.length - 1], 'poster.jpg');
  assert.equal(buildPosterArgs(6, 'c.mp4', 'p.jpg')[1 + buildPosterArgs(6, 'c.mp4', 'p.jpg').indexOf('-ss')], '2', 'short clips seek a third of the way in');
  assert.equal(buildPosterArgs(0, 'c.mp4', 'p.jpg')[1 + buildPosterArgs(0, 'c.mp4', 'p.jpg').indexOf('-ss')], '0');
});

test('a background poster attaches only to the ready clip it was generated from', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'annotated-poster-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'store.json'), JSON.stringify({
    annotations: [{ id: 'annotation-1', mediaAssetId: 'clip-1', posterAssetId: null, mediaStatus: 'ready' }],
    media: [], mediaJobs: [], users: [], comments: [], follows: [], likes: [], claims: [], sessions: [], extensionTickets: [], moderationAudit: [],
  }));
  const script = `
    const { attachMediaPoster } = await import('./server/media-job-repository.js');
    const { readStore } = await import('./server/store.js');
    const stale = await attachMediaPoster('annotation-1', 'old-clip', { id: 'stale-poster' });
    const attached = await attachMediaPoster('annotation-1', 'clip-1', { id: 'poster-1', key: 'posters/poster-1.jpg' });
    console.log(JSON.stringify({ stale, attached, store: await readStore() }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, ANNOTATED_STORAGE: 'file', ANNOTATED_DATA_DIR: directory },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.stale, false);
  assert.equal(output.attached, true);
  assert.equal(output.store.annotations[0].posterAssetId, 'poster-1');
  assert.deepEqual(output.store.media.map((item) => item.id), ['poster-1']);
});

test('provider arguments make runtime egress configuration explicit', () => {
  const args = buildProviderArgs(
    { sourceType: 'video', provider: 'youtube' },
    'https://www.youtube.com/watch?v=example',
    { jsRuntime: 'node', proxy: 'socks5h://proxy.example:1080', cookiesFile: '/run/secrets/youtube.cookies', playerClient: 'web_safari' },
  );
  assert.deepEqual(args, [
    '--no-playlist',
    '--js-runtimes', 'node',
    '--proxy', 'socks5h://proxy.example:1080',
    '--cookies', '/run/secrets/youtube.cookies',
    '--extractor-args', 'youtube:player_client=web_safari',
    '--format', 'best[height<=240]/best',
    '--get-url', 'https://www.youtube.com/watch?v=example',
  ]);
  const podcastArgs = buildProviderArgs(
    { sourceType: 'podcast', provider: 'podcast' },
    'https://podcast.example/episode',
    { playerClient: 'web_safari' },
  );
  assert.equal(podcastArgs.includes('--extractor-args'), false);
});

test('YouTube provider arguments wire mweb to the pinned HTTP PO-token plugin', () => {
  const args = buildProviderArgs(
    { sourceType: 'video', provider: 'youtube' },
    'https://www.youtube.com/watch?v=example',
    { jsRuntime: 'node', pluginDir: '/opt/yt-dlp-plugins', potProviderUrl: 'http://pot-provider.railway.internal:4416' },
  );
  assert.deepEqual(args, [
    '--no-playlist',
    '--js-runtimes', 'node',
    '--plugin-dirs', '/opt/yt-dlp-plugins',
    '--extractor-args', 'youtube:player_client=mweb;fetch_pot=always',
    '--extractor-args', 'youtubepot-bgutilhttp:base_url=http://pot-provider.railway.internal:4416',
    '--format', 'best[height<=240]/best',
    '--get-url', 'https://www.youtube.com/watch?v=example',
  ]);
});

test('provider runtime configuration rejects unsafe or unusable deployment values', () => {
  assert.deepEqual(validateProviderRuntimeConfig({ proxy: 'https://proxy.example', cookiesFile: '/run/secrets/youtube.cookies', jsRuntime: 'node', playerClient: 'web_safari' }), {
    proxy: 'https://proxy.example', cookiesFile: '/run/secrets/youtube.cookies', jsRuntime: 'node', playerClient: 'web_safari', pluginDir: '', potProviderUrl: '',
  });
  assert.throws(() => validateProviderRuntimeConfig({ proxy: 'file:///tmp/proxy' }), /http, https, or socks/);
  assert.throws(() => validateProviderRuntimeConfig({ cookiesFile: 'relative.cookies' }), /absolute file path/);
  assert.throws(() => validateProviderRuntimeConfig({ jsRuntime: 'node --unsafe' }), /unsupported characters/);
  assert.throws(() => validateProviderRuntimeConfig({ playerClient: 'web;rm' }), /unsupported characters/);
  assert.throws(() => validateProviderRuntimeConfig({ pluginDir: 'relative/plugins' }), /absolute directory/);
  assert.throws(() => validateProviderRuntimeConfig({ potProviderUrl: 'file:///tmp/provider', pluginDir: '/plugins' }), /http or https/);
  assert.throws(() => validateProviderRuntimeConfig({ potProviderUrl: 'https://pot.example' }), /YTDLP_PLUGIN_DIR is required/);
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

test('production readiness proves the checksum-pinned PO-token plugin file is present', async (t) => {
  const pluginDir = await mkdtemp(path.join(tmpdir(), 'annotated-pot-plugin-'));
  t.after(() => rm(pluginDir, { recursive: true, force: true }));
  await writeFile(path.join(pluginDir, 'bgutil-ytdlp-pot-provider.zip'), 'checksum-pinned test plugin');
  const calls = [];
  const runtime = await checkMediaRuntime({
    includeProvider: true,
    providerConfig: { pluginDir, potProviderUrl: 'http://pot-provider.internal:4416' },
    runCommand: async (command, args) => {
      calls.push({ command, args });
      return { stdout: `${command} version test`, stderr: '' };
    },
  });
  assert.deepEqual(calls.map(({ command }) => command), ['ffmpeg', 'ffprobe', process.env.YTDLP_BIN || 'yt-dlp']);
  assert.deepEqual(runtime.checks, ['ffmpeg', 'ffprobe', 'provider extractor', 'PO token plugin']);
});

test('production readiness fails explicitly when a media runtime binary is unavailable', async () => {
  await assert.rejects(
    () => checkMediaRuntime({ includeProvider: true, runCommand: async (command) => { throw new Error(`${command} not found`); } }),
    /Media runtime ffmpeg is unavailable: ffmpeg not found/,
  );
});

test('production readiness fails when configured provider cookies are not mounted', async () => {
  await assert.rejects(
    () => checkMediaRuntime({ includeProvider: true, providerConfig: { cookiesFile: '/run/secrets/missing-youtube.cookies' }, runCommand: async () => ({ stdout: '', stderr: '' }) }),
    /provider cookies are unavailable/,
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

test('failed media jobs can only be retried by their annotation owner', () => {
  const annotation = { id: 'annotation-1', authorId: 'owner-1' };
  assert.equal(canRetryMediaJob({ id: 'job-1', annotationId: 'annotation-1', status: 'failed' }, annotation, 'owner-1'), true);
  assert.equal(canRetryMediaJob({ id: 'job-1', annotationId: 'annotation-1', status: 'ready' }, annotation, 'owner-1'), false);
  assert.equal(canRetryMediaJob({ id: 'job-1', annotationId: 'annotation-1', status: 'failed' }, annotation, 'owner-2'), false);
  assert.equal(canRetryMediaJob({ id: 'job-1', annotationId: 'other', status: 'failed' }, annotation, 'owner-1'), false);
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

  // the poster frame comes off the same artifact with the production args
  const posterPath = path.join(directory, 'poster.jpg');
  await runMediaCommand('ffmpeg', buildPosterArgs(1.5, outputPath, posterPath));
  const posterProbe = JSON.parse((await runMediaCommand('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,height', '-of', 'json', posterPath])).stdout);
  const posterStream = posterProbe.streams.find((stream) => stream.codec_name === 'mjpeg');
  assert.ok(posterStream, 'the poster is a jpeg frame');
  assert.ok(Number(posterStream.height) <= 240, 'the poster stays within the clip resolution');
});
