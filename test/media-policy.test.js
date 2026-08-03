import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFfmpegArgs, shouldAbortMediaJob } from '../server/media-worker.js';

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
