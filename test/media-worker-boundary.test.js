import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const inspectExecution = (extraEnv = {}) => {
  const env = { ...process.env, NODE_ENV: 'production', ANNOTATED_STORAGE: 'file', ANNOTATED_ASSET_STORAGE: 'local', ...extraEnv };
  if (!Object.hasOwn(extraEnv, 'MEDIA_WORKER_CONCURRENCY')) delete env.MEDIA_WORKER_CONCURRENCY;
  if (!Object.hasOwn(extraEnv, 'MEDIA_WORKER_MAX_ATTEMPTS')) delete env.MEDIA_WORKER_MAX_ATTEMPTS;
  if (!extraEnv.ANNOTATED_PROCESS_ROLE) delete env.ANNOTATED_PROCESS_ROLE;
  return spawnSync(process.execPath, ['--input-type=module', '-e', "const { mediaWorkerExecution } = await import('./server/media-worker.js'); console.log(JSON.stringify(mediaWorkerExecution));"], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
};

const inspectRetryPolicy = (extraEnv = {}) => {
  const env = { ...process.env, NODE_ENV: 'production', ANNOTATED_STORAGE: 'file', ANNOTATED_ASSET_STORAGE: 'local', ...extraEnv };
  if (!Object.hasOwn(extraEnv, 'MEDIA_WORKER_MAX_ATTEMPTS')) delete env.MEDIA_WORKER_MAX_ATTEMPTS;
  return spawnSync(process.execPath, ['--input-type=module', '-e', "const { mediaWorkerRetryPolicy } = await import('./server/media-worker.js'); console.log(JSON.stringify(mediaWorkerRetryPolicy));"], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
};

test('the production API is queue-only by default', () => {
  const result = inspectExecution();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), { processRole: 'api', concurrency: 0, inProcess: false });
});

test('the standalone process owns production media concurrency', () => {
  const result = inspectExecution({ ANNOTATED_PROCESS_ROLE: 'media-worker' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout), { processRole: 'media-worker', concurrency: 2, inProcess: true });
});

test('the standalone process fails fast instead of silently disabling an invalid worker pool', () => {
  for (const concurrency of ['0', 'not-a-number', '1.5', '-1']) {
    const result = inspectExecution({ ANNOTATED_PROCESS_ROLE: 'media-worker', MEDIA_WORKER_CONCURRENCY: concurrency });
    assert.notEqual(result.status, 0, `worker concurrency ${concurrency} unexpectedly started`);
    assert.match(`${result.stdout}\n${result.stderr}`, /MEDIA_WORKER_CONCURRENCY/);
  }
});

test('the worker retry policy is explicit and rejects invalid attempt limits', () => {
  const defaultPolicy = inspectRetryPolicy();
  assert.equal(defaultPolicy.status, 0, `${defaultPolicy.stdout}\n${defaultPolicy.stderr}`);
  assert.deepEqual(JSON.parse(defaultPolicy.stdout), { maxAttempts: 3 });

  const authoritativePolicy = inspectRetryPolicy({ MEDIA_WORKER_MAX_ATTEMPTS: '1' });
  assert.equal(authoritativePolicy.status, 0, `${authoritativePolicy.stdout}\n${authoritativePolicy.stderr}`);
  assert.deepEqual(JSON.parse(authoritativePolicy.stdout), { maxAttempts: 1 });

  for (const maxAttempts of ['0', 'not-a-number', '1.5', '-1']) {
    const result = inspectRetryPolicy({ MEDIA_WORKER_MAX_ATTEMPTS: maxAttempts });
    assert.notEqual(result.status, 0, `worker max attempts ${maxAttempts} unexpectedly started`);
    assert.match(`${result.stdout}\n${result.stderr}`, /MEDIA_WORKER_MAX_ATTEMPTS/u);
  }
});

test('provider concurrency and breaker settings fail fast when malformed', () => {
  for (const [name, value] of [
    ['MEDIA_WORKER_PROVIDER_CONCURRENCY', '0'],
    ['MEDIA_WORKER_BREAKER_FAILURES', '1.5'],
    ['MEDIA_WORKER_BREAKER_COOLDOWN_MS', 'not-a-number'],
  ]) {
    const result = inspectExecution({ [name]: value });
    assert.notEqual(result.status, 0, `${name}=${value} unexpectedly started`);
    assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(name));
  }
});

test('the worker executable establishes its role before loading media orchestration', async () => {
  const source = await readFile(new URL('../server/media-worker-main.js', import.meta.url), 'utf8');
  const role = source.indexOf("process.env.ANNOTATED_PROCESS_ROLE = 'media-worker'");
  const imported = source.indexOf("await import('./media-worker.js')");
  assert.ok(role >= 0 && imported > role);
  assert.match(source, /media_worker_started/);
  assert.match(source, /mediaWorkerExecution\.concurrency/);
  assert.match(source, /mediaWorkerRetryPolicy\.maxAttempts/);
  assert.match(source, /resolveS3MaxAttempts\(\)/);
  assert.match(source, /MEDIA_WORKER_POLL_MS \|\| 2_000/);
  assert.match(source, /if \(polling\) return/);
});

test('the production API cannot execute media binaries even through an imported helper', () => {
  const env = { ...process.env, NODE_ENV: 'production', ANNOTATED_STORAGE: 'file', ANNOTATED_ASSET_STORAGE: 'local', ANNOTATED_PROCESS_ROLE: 'api', MEDIA_WORKER_CONCURRENCY: '0' };
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "const { runMediaCommand } = await import('./server/media-worker.js'); try { await runMediaCommand(process.execPath,['--version']); process.exit(2); } catch(error) { console.log(error.message); }"], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /disabled in the production API process/);
});

test('API audio validation is in-process and waveform binary work stays worker-owned', async () => {
  const probe = await readFile(new URL('../server/media-probe.js', import.meta.url), 'utf8');
  const mediaStore = await readFile(new URL('../server/media-store.js', import.meta.url), 'utf8');
  assert.doesNotMatch(probe, /node:child_process|\bspawn\s*\(/);
  assert.match(probe, /parseFile/);
  assert.doesNotMatch(mediaStore, /extractAudioPeaks/);
});

test('worker failures are classified for bounded retry and provider circuit telemetry', async () => {
  const { classifyMediaFailure, createProviderGate } = await import('../server/media-worker.js');
  assert.equal(classifyMediaFailure(new Error('yt-dlp provider timed out')), 'provider-timeout');
  assert.equal(classifyMediaFailure(new Error('HTTP Error 429: Too Many Requests')), 'provider-rate-limit');
  assert.equal(classifyMediaFailure(new Error('Missing required Visitor Data; PO Token unavailable')), 'provider-configuration');
  assert.equal(classifyMediaFailure(new Error('S3 object upload failed')), 'object-storage');
  assert.equal(classifyMediaFailure(new Error('ffmpeg codec failed')), 'transcode');
  assert.equal(classifyMediaFailure(new Error('unclassified failure')), 'unknown');

  let clock = 1_000;
  const control = createProviderGate({ concurrency: 1, failureThreshold: 2, cooldownMs: 5_000, now: () => clock });
  const first = control.acquire({ provider: 'youtube' });
  assert.equal(first.allowed, true);
  assert.deepEqual(control.acquire({ provider: 'youtube' }), { allowed: false, key: 'youtube', delayMs: 1_000, reason: 'provider-concurrency' });
  control.release(first.key, { failed: true });
  const second = control.acquire({ provider: 'youtube' });
  assert.equal(second.allowed, true);
  control.release(second.key, { failed: true });
  assert.deepEqual(control.acquire({ provider: 'youtube' }), { allowed: false, key: 'youtube', delayMs: 5_000, reason: 'provider-circuit-open' });
  clock += 5_001;
  const recovered = control.acquire({ provider: 'youtube' });
  assert.equal(recovered.allowed, true);
  control.release(recovered.key, { succeeded: true });
  assert.deepEqual(control.snapshot('youtube'), { active: 0, failures: 0, openUntil: 0 });
});
